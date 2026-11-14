# Tray UI Stack: Preact + htm, Tailwind v4 and Basecoat in a Shadow Root

Status: accepted. Proven by a spike for [#15](https://github.com/kendrick/ux-punchlist/issues/15); the real tray in `src/tray/` has not adopted it yet.

## Context

The tray is injected into pages we don't control, inside a shadow root on a `<punchlist-tray>` element. The review UI inside it will grow past what plain DOM calls handle well, so we want a component layer and a utility-first stylesheet. A shadow root hides the tray's selectors from the page, but it doesn't make the tray immune to the page. Three traps decide the stack:

- `rem` follows the reviewed page. A page that sets `html { font-size: 62.5% }` shrinks every `rem` in the tray to 10px per unit. Tailwind and Basecoat size almost everything in `rem`.
- Tokens leak in two directions. Custom properties inherit through the shadow boundary, so the reviewed page's `:root { --color-primary: red; --spacing: 10px }` can reach the tray. Tailwind v4 and Basecoat also define their own tokens on `:root, :host`. Inside a shadow root `:root` matches nothing, and `:host` matches the tray's host element, which a page rule such as `punchlist-tray { --primary: red !important }` can override.
- `@property` is document-global. Tailwind v4 registers `--tw-*` initial values with `@property`. Browsers ignore those rules in a shadow root's stylesheet, so every `--tw-*` var starts out unset, and shadows, rings and transforms render as nothing.

Tailwind's own thread on the `@property` problem is [tailwindcss discussion #16772](https://github.com/tailwindlabs/tailwindcss/discussions/16772).

## Decision

Component layer: Preact through `htm` tagged templates, using the standalone build `htm/preact/standalone.module.js`. We vendor it byte for byte as `spikes/tray-stack/preact-htm.js` (source and hash in `VENDOR.md`). There's no JSX, so `node src/cli.ts start` keeps running straight from source with no bundler and no runtime build. When the real tray adopts the stack, the file moves to `src/tray/vendor/` with its `VENDOR.md` note.

Styling: Tailwind v4 utilities plus Basecoat's CSS (`basecoat-css@1.1.0`) for component classes such as `btn`. We don't use Basecoat's JS. Behavior comes from native `popover`. The popover itself uses Tailwind utilities on Basecoat's tokens, because Basecoat's `[data-popover]` classes assume its own JS-positioned absolute popover.

CSS build: `pnpm build:tray-css` runs the Tailwind CLI over `input.css`, which scans only the tray's source, and pipes the result through `postProcess`. The output is `tray-css.ts`, a committed file that exports one string. The tray adopts it as a constructable stylesheet, which the reviewed page's `style-src` can't block the way it can a `<style>` element. A second sheet, `:host { all: initial; }`, goes in first and lives in `tray.ts`, outside the built CSS, so the `:host` rewrite can't touch it.

Post-processing: `postProcess` in `spikes/tray-stack/post-process.ts` applies three rewrites, in this order.

1. Every `:root` and `:host` selector becomes `[data-pl-root]`, a marker attribute on a wrapper `<div>` at the top of the shadow root. The wrapper holds the tray bar and will hold the overlay, so the tokens declared on it override any the page passes down to both. A selector list that then names the target twice keeps one. We use a marker rather than `:host` because a page rule aimed at `punchlist-tray` can beat `:host` rules and turn the tray red, and rather than `!important` because it would escalate against page rules we can't see. `:host(...)` with parentheses is left alone.
2. Every `<number>rem` becomes `<number × 16>px`. Sizes in the tray then ignore the reviewed page's root font size.
3. Each `@property` block is removed and its `initial-value` becomes a plain declaration. Not-inherited properties go on `[data-pl-root],[data-pl-root] *,::before,::after`, inherited ones on `[data-pl-root]`. The rule is emitted inside `@layer properties` and writes a unitless `<length>` initial value of `0` as `0px`. Unlayered, the rule outranked every utility that sets a `--tw-*` var, so the focus ring painted nothing. Left as `0`, the value makes `calc(3px + 0)` invalid in the ring's offset math, which has the same result.

Serve path: `startServer` takes an optional `trayDir`, and `serveTray` serves `.ts` files with types stripped and `.js` files unchanged. It serves only names `readdirSync(trayDir)` lists, so no request path can leave the directory. The spike's entry file is named `tray.ts`, so the existing `injectTray` tag loads it when `trayDir` points at the spike.

Overlay: pins and the highlight render from the tray's shadow root, inside the `[data-pl-root]` wrapper, in a full-viewport layer with `pointer-events: none`. Each pin turns pointer events back on for itself, and every other click reaches the app. Nothing writes inline styles onto the reviewed page's elements, which pick mode does today with `style.outline`. The spike builds the wrapper but not the overlay.

No `prefix(pl)`: the build leaves Tailwind's class names and tokens unprefixed. Basecoat is written against shadcn's unprefixed tokens such as `--primary` and `--background`, and the wrapper already keeps page values out.

### How the Sizes Stay Fixed

Rewrite 2 leaves no `rem` in the built CSS, so `html { font-size: 62.5% }` has nothing to scale. The proof loads the fixture page twice, once at 62.5% and once at 100%, and the screenshots of the tray bar are byte-identical. It uses one page load per root size because WebKit doesn't restyle a shadow tree when the root font size changes after load, which would let `rem` slip past a test that changed it live. Skipping rewrite 2 fails that test in all five Playwright projects.

### How the Theme Stays Fixed

Rewrite 1 puts every Tailwind and Basecoat token on `[data-pl-root]`, an element inside the shadow tree, so the tokens win by being the nearest declaration. The fixture's `:root`, `*` and `punchlist-tray` rules set `--color-primary`, `--spacing`, `--primary` and `--background`, but none of them target an element inside the shadow root. The tray's computed button colors and `--primary` equal the values on the same page with the fixture's `<style>` removed. In the other direction, `--primary` on `document.documentElement` reads `red` before and after the tray loads. Rewriting to `:host` instead of `[data-pl-root]` fails the colors test, and the tray turns red under the `punchlist-tray` rule.

### Proof

The screenshot below shows the popover open on the fixture page, which sets `html { font-size: 62.5% }` and red tokens, at 1280×800 in desktop Chromium. The tray text stays at its fixed size while the page's own text shrinks.

![The tray bar and its open popover on the hostile fixture page](0001-tray-ui-stack.png)

The spike is [`spikes/tray-stack/`](../../spikes/tray-stack/). The checks are in [`tests/integration/tray-stack.spec.ts`](../../tests/integration/tray-stack.spec.ts), which runs in all five Playwright projects. Its focus-ring test asserts a painted ring (alpha above 0, a non-zero length), which is stronger than "box-shadow is not `none`". A separate test checks that `shadow-md`, `ring-1` and Basecoat's translate and scale utilities apply. The popover test checks that it opens and sits above the bar's `overflow: hidden`, because native popover renders in the top layer. `tests/unit/tray-stack-css.spec.ts` covers `postProcess` and the freshness check below.

## Consequences

- `spikes/tray-stack/tray-css.ts` is generated and committed, about 220 KB. A unit test rebuilds it and fails when the committed file differs, with a message that says to run `pnpm build:tray-css`. Hand edits fail `pnpm test`, and `pnpm build:tray-css` fixes them. Both oxlint and oxfmt ignore the file.
- `preact-htm.js` is vendored and also ignored by lint and format. Upgrading Preact means replacing the file and updating the hash in `VENDOR.md`.
- Tailwind and Basecoat output must go through `postProcess`. A new Tailwind release can emit a pattern the three rewrites don't cover, and the freshness test won't notice that. The browser checks will.
- The CSS build is an ahead-of-time step, so a developer who adds a utility class runs `pnpm build:tray-css` before the tray shows it.
- Tailwind and `@tailwindcss/cli` are pinned to the same exact version (4.3.5), and `@parcel/watcher`'s build script is blocked in `pnpm-workspace.yaml` because only watch mode needs it.
- Adopting the stack is a separate issue. It moves `spikes/tray-stack/` into `src/tray/`, ports the real tray's UI to Preact, and carries the proof's tests along.

## Alternatives Considered

- Lit handles shadow roots well, but it brings its own component model and decorator or build needs. It does nothing for the Tailwind and Basecoat traps above.
- Plain DOM needs no dependency, but the review UI's state and lists get long to write and easy to get wrong, and it gives us no component library to build on.
- shadcn-preact and real shadcn through `preact/compat` both pull in a React-shaped dependency tree and Radix-style runtime behavior, and the tray needs only a few components.
- Tailwind's `prefix(pl)` namespaces class names and theme variables, but leaves `rem` and `@property` alone and doesn't stop the reviewed page's `:root` or `punchlist-tray` rules from reaching the tray.
- Hoisting `@property` into the reviewed page's `<head>` would work, but it writes into a page we don't control, and the registrations would outlive the tray.
- `!important` on the tray's declarations escalates against page rules we can't see, and it still doesn't help with `rem` or `@property`.

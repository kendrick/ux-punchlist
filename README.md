# ux-punchlist

Review a running app one item at a time, with comments and approvals logged to an append-only file.

<img width="1280" height="720" alt="The review tray on the fixture app's home page, reading Item 1 of 2, Home page hero, with Previous disabled" src="https://github.com/user-attachments/assets/b50a659a-2a5c-4c8d-8134-ff192642093d" />

ux-punchlist is a Claude Code plugin. You list what needs review in `.review/manifest.yaml`, and it puts a small review tray on top of your running app. The tray walks you through those items in order. On each item you can pin a comment to an element or approve the item, and every action lands as one JSON line in `.review/events.jsonl`. The session state is rebuilt from that log, so you can stop the server and pick up later at the same item, with the same comments and approvals.

It answers "is this done, and is it right?" Design craft (how a single element should look) belongs to [Impeccable](https://github.com/pbakaus/impeccable).

## Install

You need Claude Code and Node.js 26 or newer.

In Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add kendrick/agent-plugins
/plugin install ux-punchlist@kendrick
```

The first time the `review` skill runs, it installs the plugin's runtime dependencies and the Chromium build Playwright uses for screenshots.

## Usage

Start your app, then write `.review/manifest.yaml` in your project:

```yaml
items:
  - id: home-hero
    title: Home page hero
    url: /
    question: Does the hero say what the product does?
  - id: pricing-table
    title: Pricing table
    url: /pricing.html
```

Each `id` is unique and uses lowercase letters, digits and hyphens. `url` is a path on your app and starts with `/`. `question` is optional.

Then ask Claude to start a review of your app. The `review` skill starts the review server pointed at your app and gives you its URL. You can also run the server yourself from a checkout:

```sh
pnpm review --target http://localhost:3000
```

```text
punchlist: listening on http://127.0.0.1:53817
```

Open that URL. The tray reads "Item 1 of 2" with the item's title and question. From there:

- **Previous** and **Next** move between items. When you're on a different page from the item, **Go to item** takes you there.
- **Comment** lets you pick an element on the page and type a note. **Pin comment** saves it with a screenshot under `.review/screenshots/`.
- **Approve** marks the item approved.

Add `--port <n>` to fix the port, and `--root <dir>` when the project isn't the current directory. To stop, end the server process. Starting it again resumes where you left off. If you edit the manifest after a session has started, the session keeps its original items and prints a warning.

Don't edit or delete `.review/events.jsonl`. It's append-only, and it's the only record of the session.

## Roadmap

Single-item review is the first slice of a bigger plan, described in [docs/plan.md](docs/plan.md) and tracked in the [issues](https://github.com/kendrick/ux-punchlist/issues):

- Claude writes the manifest from your branch's diff ([#3](https://github.com/kendrick/ux-punchlist/issues/3)).
- Feedback gets routed to a fix and verified ([#4](https://github.com/kendrick/ux-punchlist/issues/4)).
- Journeys review a whole flow step by step, with replay ([#6](https://github.com/kendrick/ux-punchlist/issues/6)).
- A sign-off report records what was approved and by whom ([#8](https://github.com/kendrick/ux-punchlist/issues/8)).
- Several reviewers can join one session ([#10](https://github.com/kendrick/ux-punchlist/issues/10)).

## Development

Set up once per checkout:

```sh
pnpm install
pnpm exec playwright install
```

Run the checks:

```sh
pnpm typecheck
pnpm lint
pnpm test       # unit and event-log tests (Vitest)
pnpm test:e2e   # browser tests against the fixture app (Playwright)
```

To try the tray by hand, serve the fixture app, then point a review at it from a scratch root:

```sh
node fixtures/serve.ts 0
mkdir -p /tmp/pl/.review && cp fixtures/manifest.yaml /tmp/pl/.review/
pnpm review --target <fixture URL> --root /tmp/pl
```

`src/core/` holds the event log, the reducer and the manifest parser. `src/server/` is the proxy that injects the tray and takes its commands. `src/tray/` is the tray itself. [AGENTS.md](AGENTS.md) has the conventions for coding agents working in this repo.

## License

[MIT](LICENSE)

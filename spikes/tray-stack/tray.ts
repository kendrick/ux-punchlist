// Proof for #15: a Preact + htm, Tailwind v4 and Basecoat tray inside a shadow root on a page we don't control.
import { html, render } from './preact-htm.js';
import { css } from './tray-css.ts';

// Kept out of the built CSS so postProcess's :host rewrite can't touch it: it stops the page's inherited styles at the host.
const reset = new CSSStyleSheet();
reset.replaceSync(':host { all: initial; }');
const built = new CSSStyleSheet();
built.replaceSync(css);

const host = document.createElement('punchlist-tray');
const root = host.attachShadow({ mode: 'open' });
// Constructable sheets, not <style>, so the target's style-src can't block them.
root.adoptedStyleSheets = [reset, built];
document.body.append(host);

// overflow-hidden on the bar is deliberate: the popover only escapes it because native popover renders in the top layer.
render(
	html`<div
		data-pl-root
		class="fixed inset-x-0 bottom-0 z-50 flex h-14 items-center gap-3 overflow-hidden border-t bg-background px-4 text-sm text-foreground"
	>
		<span class="font-semibold">Review tray</span>
		<button type="button" class="btn" popovertarget="pl-popover">Open</button>
		<div
			id="pl-popover"
			popover
			class="inset-auto bottom-10 left-4 m-0 w-64 rounded-md bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			Popover content renders above the bar.
		</div>
	</div>`,
	root,
);

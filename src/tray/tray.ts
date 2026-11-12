import type { Command, SessionState } from '../core/events.ts';
import { cssPath } from './selector.ts';

const CSS = `
:host { all: initial; }
.tray { position: fixed; inset: auto 0 0 0; z-index: 2147483647; box-sizing: border-box; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 10px 16px; background: #111; color: #fff; font: 14px/1.4 system-ui, sans-serif; }
.tray * { box-sizing: border-box; }
.title { font-weight: 600; }
button { font: inherit; padding: 6px 12px; border: 1px solid #fff; border-radius: 4px; background: #fff; color: #111; cursor: pointer; }
button[disabled] { opacity: 0.5; cursor: not-allowed; }
button[aria-pressed="true"] { background: #ffd23f; }
:focus-visible { outline: 3px solid #ffd23f; outline-offset: 2px; }
label { display: flex; gap: 6px; align-items: center; }
textarea { font: inherit; min-width: 240px; }
[role="status"] { color: #ff9b9b; }
`;

const OUTLINE = '2px solid #ffd23f';

let state: SessionState | null = null;
let picked: Element | null = null;
let picking = false;
let hovered: HTMLElement | SVGElement | null = null;
let error = '';
// render() rebuilds the textarea, so a rejected pin would otherwise drop what the reviewer typed.
let draft = '';
// Module-level so a mid-flight render() (e.g. hashchange) still builds Pin comment disabled.
let pinning = false;

// A constructable sheet isn't an inline <style>, so the target's style-src can't block it.
const sheet = new CSSStyleSheet();
sheet.replaceSync(CSS);

const host = document.createElement('punchlist-tray');
const root = host.attachShadow({ mode: 'open' });
root.adoptedStyleSheets = [sheet];
document.body.append(host);

const request = async (init?: { command: Command }): Promise<SessionState | null> => {
	const res = await fetch(
		'/__punchlist/' + (init ? 'commands' : 'state'),
		init && {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(init.command),
		},
	);
	const body = await res.json();
	if (!res.ok) {
		error = body.error ?? `request failed (${res.status})`;
		return null;
	}
	error = '';
	return body;
};

const send = async (command: Command) => {
	const next = await request({ command });
	if (next) state = next;
	render();
	return next;
};

const clearHover = () => {
	if (hovered) hovered.style.outline = '';
	hovered = null;
};

const setPicking = (on: boolean) => {
	picking = on;
	if (!on) clearHover();
	render();
};

function build<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]>,
	kids: (Node | string)[],
) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...kids);
	return node;
}

const button = (label: string, onClick: () => void, disabled = false) => {
	const b = build('button', { type: 'button', disabled }, [label]);
	b.addEventListener('click', onClick);
	return b;
};

// A fragment in the item URL must match (hash routes, anchors); without one, an in-page anchor jump still counts as here.
const isAt = (url: string) => {
	const u = new URL(url, location.href);
	return (
		u.pathname + u.search === location.pathname + location.search &&
		(!u.hash || u.hash === location.hash)
	);
};

function render() {
	const tray = build('div', { className: 'tray', role: 'region' }, []);
	tray.setAttribute('aria-label', 'Review tray');
	const status = build('div', { role: 'status' }, [error]);

	if (!state?.started) {
		tray.append(status);
		root.replaceChildren(tray);
		return;
	}

	const { items, position, approved, comments } = state;
	const item = items[position]!;
	const count = comments.filter((c) => c.itemId === item.id).length;
	// A restart restores the position but not the page. Auto-navigating would yank reviewers off pages they followed a link to, so Comment stays disabled until the reviewer is on the item's page.
	const here = isAt(item.url);
	// The capture-phase pick handler still fires off the item's URL and would pick another route's element.
	if (!here && picking) {
		picking = false;
		clearHover();
	}
	const go = async (to: number) => {
		const target = items[to]!;
		if (!(await send({ type: 'select', itemId: target.id }))) return;
		// A pending pick belongs to the item it started on; two items can share a URL.
		picked = null;
		draft = '';
		render();
		if (!isAt(target.url)) location.assign(target.url);
	};

	tray.append(
		build('span', {}, [`Item ${position + 1} of ${items.length}`]),
		build('span', { className: 'title' }, [item.title]),
	);
	if (item.question) tray.append(build('span', {}, [item.question]));
	tray.append(
		button('Previous', () => go(position - 1), position === 0),
		button('Next', () => go(position + 1), position === items.length - 1),
		approved.includes(item.id)
			? build('span', {}, ['Approved'])
			: button('Approve', () => send({ type: 'approve', itemId: item.id })),
	);

	if (!here) tray.append(button('Go to item', () => location.assign(item.url)));
	const pick = button('Comment', () => setPicking(!picking), !here);
	pick.setAttribute('aria-pressed', String(picking));
	tray.append(pick, build('span', {}, [`${count} comment${count === 1 ? '' : 's'}`]));

	if (picked) {
		const target = picked;
		const text = document.createElement('textarea');
		text.rows = 2;
		text.value = draft;
		text.addEventListener('input', () => (draft = text.value));
		const label = document.createElement('label');
		label.append('Comment', text);
		const pin = button(
			'Pin comment',
			async () => {
				if (pinning) return;
				// pageUrl is read at click time, and pushState fires no event to disable the button, so recheck here.
				if (!isAt(item.url)) {
					error = "Go back to the item's page to pin this comment.";
					return render();
				}
				// An SPA route change can detach the pick; cssPath on it would resolve to nothing.
				if (!target.isConnected) {
					picked = null;
					error = 'That element is gone. Pick it again.';
					return render();
				}
				pinning = true;
				render();
				const ok = await send({
					type: 'comment',
					itemId: item.id,
					selector: cssPath(target),
					text: text.value,
					// `Command` requires the field; the server overwrites it with its own capture path.
					screenshot: '',
					pageUrl: location.href,
				}).catch(() => {
					error = 'Could not reach the punchlist server.';
					return null;
				});
				pinning = false;
				// Next mid-send may have started a new pick; don't wipe it.
				if (ok && picked === target) {
					picked = null;
					draft = '';
				}
				render();
			},
			pinning || !here,
		);
		tray.append(label, pin);
	}

	tray.append(status);
	root.replaceChildren(tray);
}

const pickable = (target: EventTarget | null): HTMLElement | SVGElement | null => {
	let el = target;
	// SVG children often paint no outline and can have no box to screenshot, so pick the outermost <svg>.
	while (el instanceof SVGElement && el.ownerSVGElement) el = el.ownerSVGElement;
	return (el instanceof HTMLElement || el instanceof SVGElement) && !el.closest('punchlist-tray')
		? el
		: null;
};

document.addEventListener('mouseover', (e) => {
	const el = pickable(e.target);
	if (!picking || !el) return;
	clearHover();
	hovered = el;
	hovered.style.outline = OUTLINE;
});

// Capture phase so the page's own handlers never see the pick.
document.addEventListener(
	'click',
	(e) => {
		const el = pickable(e.target);
		if (!picking || !el) return;
		e.preventDefault();
		e.stopPropagation();
		picked = el;
		setPicking(false);
		root.querySelector('textarea')?.focus();
	},
	true,
);

// Hash-only navigation doesn't reload the page, so the tray has to re-check isAt itself.
window.addEventListener('hashchange', render);

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && picking) setPicking(false);
});

try {
	state = await request();
} catch {
	error = 'Could not reach the punchlist server.';
}
render();

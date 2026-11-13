import { posix } from 'node:path';
import type { Item } from '../core/events.ts';

const idFor = (path: string): string =>
	path
		.replace(/\.html$/, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'home';

export function planItems(changed: string[], appDir: string): Item[] {
	const pages = new Map<string, string>(); // url -> unencoded path used for the id
	for (const file of changed) {
		const rel = posix.relative(appDir, file);
		// shortcut: only .html files count, since assets can't be traced to the pages using them; upgrade when a framework route map exists.
		if (rel === '..' || rel.startsWith('../') || !rel.endsWith('.html')) continue;
		const path = rel.replace(/(^|\/)index\.html$/, '$1');
		pages.set('/' + path.split('/').map(encodeURIComponent).join('/'), path);
	}
	const used = new Set<string>();
	// tsconfig's lib predates toSorted; the spread is already a copy, so sort() mutates nothing shared.
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...pages.keys()].sort().map((url) => {
		const base = idFor(pages.get(url) ?? '');
		let id = base;
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return {
			id,
			title: url,
			url,
			question: `Does ${url} look and work as intended after this branch's changes?`,
		};
	});
}

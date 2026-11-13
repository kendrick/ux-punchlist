import { posix } from 'node:path';
import type { Item } from '../core/events.ts';

// Letters NFKD leaves whole; without these they'd be stripped and the name would collapse to a fallback.
const WHOLE_LETTERS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	ł: 'l',
	đ: 'd',
	ð: 'd',
	þ: 'th',
};

// shortcut: names with no Latin transliteration all become `home`, so several such pages collide with each other and with index.html (suffixed home-2, home-3, ...); upgrade if non-Latin page names show up in real projects.
const idFor = (path: string): string =>
	path
		.replace(/\.html$/, '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.replace(/[^\p{ASCII}]/gu, (c) => WHOLE_LETTERS[c] ?? c)
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

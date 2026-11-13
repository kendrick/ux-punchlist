// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseManifest, serializeManifest } from '../../src/core/manifest.ts';
import { planItems } from '../../src/plan/plan.ts';

const q = (url: string) => `Does ${url} look and work as intended after this branch's changes?`;

const idsOf = (changed: string[]) => planItems(changed, 'app').map((i) => i.id);
const wellFormed = (ids: string[]) => {
	for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
	expect(new Set(ids).size).toBe(ids.length);
};

describe('planItems', () => {
	it('two changed pages give two items', () => {
		const items = planItems(['app/index.html', 'app/pricing.html'], 'app');
		expect(items.map((i) => i.url)).toEqual(['/', '/pricing.html']);
		expect(items.map((i) => i.id)).toEqual(['home', 'pricing']);
		for (const i of items) expect(i.question).toBe(q(i.url));
		expect(parseManifest(serializeManifest(items))).toEqual(items);
	});

	it('tests and docs give no items', () => {
		expect(planItems(['tests/x.spec.ts', 'README.md', 'app/style.css'], 'app')).toEqual([]);
		expect(parseManifest(serializeManifest([]))).toEqual([]);
	});

	it('files outside the app dir are ignored', () => {
		expect(planItems(['other/index.html'], 'app')).toEqual([]);
	});

	it('maps a nested index.html to a trailing-slash url and a dir-name id', () => {
		const [item, ...rest] = planItems(['app/docs/index.html'], 'app');
		expect(rest).toEqual([]);
		expect(item?.url).toBe('/docs/');
		expect(item?.id).toBe('docs');
	});

	it('colliding ids get a suffix', () => {
		const items = planItems(['a_b.html', 'a-b.html'], '.');
		expect(items.map((i) => i.id)).toEqual(['a-b', 'a-b-2']);
		expect(parseManifest(serializeManifest(items))).toEqual(items);
	});

	it('percent-encodes spaces in the url and lowercases and hyphenates the id', () => {
		const items = planItems(['My Page.html'], '.');
		expect(items.map((i) => [i.url, i.id])).toEqual([['/My%20Page.html', 'my-page']]);
		expect(parseManifest(serializeManifest(items))).toEqual(items);
	});

	it('keeps a file whose name merely starts with two dots', () => {
		expect(planItems(['app/..draft.html'], 'app').map((i) => i.url)).toEqual(['/..draft.html']);
	});

	it('transliterates ü and keeps index.html as home', () => {
		const ids = idsOf(['app/ü.html', 'app/index.html']);
		expect(ids).toHaveLength(2);
		expect(ids).toEqual(expect.arrayContaining(['home', 'u']));
		wellFormed(ids);
	});

	it('transliterates a longer name', () => {
		const ids = idsOf(['app/ünd.html', 'app/Straße.html']);
		expect(ids).toHaveLength(2);
		expect(ids).toEqual(expect.arrayContaining(['strasse', 'und']));
		wellFormed(ids);
	});

	it('a name with no letters or digits still falls back', () => {
		const ids = idsOf(['app/_.html']);
		expect(ids).toEqual(['home']);
		wellFormed(ids);
	});

	it('composed and decomposed ü give the same id', () => {
		for (const name of ['ü', 'ü']) {
			const ids = idsOf([`app/${name}.html`]);
			expect(ids).toEqual(['u']);
			wellFormed(ids);
		}
	});

	it('has no options key', () => {
		expect(planItems(['index.html'], '.')[0]).not.toHaveProperty('options');
	});
});

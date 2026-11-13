// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseManifest, serializeManifest } from '../../src/core/manifest.ts';
import { planItems } from '../../src/plan/plan.ts';

const q = (url: string) => `Does ${url} look and work as intended after this branch's changes?`;

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
	});

	it('files outside the app dir are ignored', () => {
		expect(planItems(['other/index.html'], 'app')).toEqual([]);
	});

	it('nested index', () => {
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

	it('spaces and capitals', () => {
		const items = planItems(['My Page.html'], '.');
		expect(items.map((i) => [i.url, i.id])).toEqual([['/My%20Page.html', 'my-page']]);
		expect(parseManifest(serializeManifest(items))).toEqual(items);
	});

	it('has no options key', () => {
		expect(planItems(['index.html'], '.')[0]).not.toHaveProperty('options');
	});
});

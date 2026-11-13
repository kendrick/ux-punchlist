// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from '../../src/core/manifest.ts';

const item = (extra = '') => `  - id: a\n    title: A\n    url: /a\n${extra}`;
const bad = (text: string, prefix: string) => {
	const fn = () => parseManifest(text);
	expect(fn).toThrow(ManifestError);
	expect(fn).toThrow(new RegExp(`^${prefix.replace(/[[\].]/g, '\\$&')}`));
};

describe('parseManifest', () => {
	it('parses fixtures/manifest.yaml into two items', () => {
		const items = parseManifest(readFileSync('fixtures/manifest.yaml', 'utf8'));
		expect(items).toEqual([
			{
				id: 'home-hero',
				title: 'Home page hero',
				url: '/',
				question: 'Does the hero say what the product does?',
			},
			{ id: 'pricing-table', title: 'Pricing table', url: '/pricing.html' },
		]);
	});

	it('rejects a missing items list', () => bad('foo: 1', 'items: '));
	it('rejects an empty items list', () => bad('items: []', 'items: '));
	it('rejects an id that does not match the pattern', () =>
		bad('items:\n  - id: Bad_Id\n    title: A\n    url: /a', 'items[0].id: '));
	it('rejects a duplicate id', () =>
		bad(`items:\n${item()}${item()}`, 'items[1].id: duplicate id "a"'));
	it('rejects an empty title', () =>
		bad('items:\n  - id: a\n    title: " "\n    url: /a', 'items[0].title: '));
	it('rejects a url without a leading slash', () =>
		bad('items:\n  - id: a\n    title: A\n    url: a.html', 'items[0].url: '));
	it('rejects a non-string question', () =>
		bad(`items:\n${item('    question: 5')}`, 'items[0].question: '));
	it('rejects journey items', () =>
		bad(
			`items:\n${item('    type: journey')}`,
			'items[0].type: journey items are not supported yet',
		));
	it('rejects choice items', () =>
		bad(
			`items:\n${item('    type: choice')}`,
			'items[0].type: choice items are not supported yet',
		));
	it('accepts type: single', () => {
		expect(parseManifest(`items:\n${item('    type: single')}`)).toHaveLength(1);
	});
});

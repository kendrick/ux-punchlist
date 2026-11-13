// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest, serializeManifest } from '../../src/core/manifest.ts';

const item = (extra = '') => `  - id: a\n    title: A\n    url: /a\n${extra}`;
const nav = (options: string) =>
	`items:\n  - id: nav\n    title: Nav\n    url: /nav\n    options: ${options}\n`;
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
	it('parses an empty items list to []', () => expect(parseManifest('items: []')).toEqual([]));
	it('rejects a non-list items', () => bad('items: 1', 'items: '));
	it('rejects an id that does not match the pattern', () =>
		bad('items:\n  - id: Bad_Id\n    title: A\n    url: /a', 'items[0].id: '));
	it('rejects a duplicate id', () =>
		bad(`items:\n${item()}${item()}`, 'items[1].id: duplicate id "a"'));
	it('rejects an empty title', () =>
		bad('items:\n  - id: a\n    title: " "\n    url: /a', 'items[0].title: '));
	it('rejects a url without a leading slash', () =>
		bad('items:\n  - id: a\n    title: A\n    url: a.html', 'items[0].url: '));
	it.each([
		'//evil.example/',
		'/\\evil.example/',
		'/\t/evil.example/',
		'/\n/evil.example',
		'//',
		'/\\',
		'//[',
		'//a:b@',
		'//review.invalid/away',
		'/\\review.invalid/away',
		'/\t/review.invalid/away',
		'/\n/review.invalid/away',
	])('rejects a url %j that resolves off the review origin', (url) =>
		bad(`items:\n  - id: a\n    title: A\n    url: ${JSON.stringify(url)}`, 'items[0].url: '),
	);
	it.each(['/a//b', '/pricing.html#plans', '/%2F%2Fevil'])('accepts a same-origin url %j', (url) =>
		expect(
			parseManifest(`items:\n  - id: a\n    title: A\n    url: ${JSON.stringify(url)}`)[0]?.url,
		).toBe(url),
	);
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

	it('rejects five options and names the item', () => {
		bad(nav('[a, b, c, d, e]'), 'items[0].options: ');
		expect(() => parseManifest(nav('[a, b, c, d, e]'))).toThrow(/"nav".*\b4\b/);
	});
	it('accepts up to four options', () =>
		expect(parseManifest(nav('[a, b, c, d]'))[0]?.options).toEqual(['a', 'b', 'c', 'd']));
	it('an item without options has none', () => {
		const [parsed] = parseManifest(`items:\n${item()}`);
		expect('options' in parsed).toBe(false);
	});
	it.each(['[a, a]', '[A]'])('rejects duplicate or malformed option ids %s', (options) =>
		expect(() => parseManifest(nav(options))).toThrow(ManifestError),
	);
	it('round-trips a hand-edited manifest', () => {
		const text = [
			'# hand-edited by the owner',
			'items:',
			'  - id: home',
			'    title: Home',
			'    url: /',
			'    question: Is the hero clear?',
			'  - id: nav',
			'    title: Nav',
			'    url: /nav',
			'    options: [a, b]',
			'',
		].join('\n');
		expect(parseManifest(serializeManifest(parseManifest(text)))).toEqual(parseManifest(text));
	});
	it('serializes no items', () => expect(serializeManifest([])).toBe('items: []\n'));
});

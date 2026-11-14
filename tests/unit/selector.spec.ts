import { beforeEach, describe, expect, it } from 'vitest';
import { cssPath } from '../../src/tray/selector.ts';

const expectResolvesTo = (el: Element) => {
	expect([...document.querySelectorAll(cssPath(el))]).toEqual([el]);
};

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('cssPath', () => {
	it('uses the id when it is unique', () => {
		document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
		const el = document.getElementById('b')!;
		expect(cssPath(el)).toBe('[id="b"]');
		expectResolvesTo(el);
	});

	it('escapes quotes in an id', () => {
		document.body.innerHTML = '<div id=\'he said "hi"\\\'></div><div></div>';
		const el = document.body.firstElementChild!;
		expect(el.id).toBe('he said "hi"\\');
		expectResolvesTo(el);
	});

	it('falls back to nth-of-type among identical siblings', () => {
		document.body.innerHTML =
			'<ul><li>a</li><li>b</li><li>c</li></ul><ul><li>d</li><li>e</li></ul>';
		for (const li of document.querySelectorAll('li')) expectResolvesTo(li);
	});

	it('does not trust an id that is duplicated', () => {
		document.body.innerHTML = '<p id="x"></p><p id="x"></p>';
		for (const p of document.querySelectorAll('p')) expectResolvesTo(p);
	});

	it('anchors on the nearest ancestor with a unique id', () => {
		document.body.innerHTML =
			'<section><div id="outer"><div><span></span><span id="in"></span><span></span></div></div></section>';
		const el = document.querySelectorAll('span')[2];
		if (!el) throw new Error('third span missing');
		expect(cssPath(el).startsWith('[id="outer"] > ')).toBe(true);
		expectResolvesTo(el);
	});
});

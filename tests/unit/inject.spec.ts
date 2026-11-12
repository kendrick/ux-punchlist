import { describe, expect, test } from 'vitest';
import { injectTray, scriptNonce } from '../../src/server/inject.ts';

const TAG = '<script type="module" src="/__punchlist/tray.ts"></script>';

describe('injectTray', () => {
	test('inserts before </body>', () => {
		expect(injectTray('<html><body><p>hi</p></body></html>')).toBe(
			`<html><body><p>hi</p>${TAG}</body></html>`,
		);
	});

	test('matches </BODY> case-insensitively and uses the last one', () => {
		const html = '<body><pre>&lt;/body&gt; </body></pre></BODY>';
		expect(injectTray(html)).toBe(`<body><pre>&lt;/body&gt; </body></pre>${TAG}</BODY>`);
	});

	test('appends when there is no </body>', () => {
		expect(injectTray('<p>fragment</p>')).toBe(`<p>fragment</p>${TAG}`);
	});
});

describe('nonce', () => {
	test('injectTray puts the nonce on the tag', () => {
		expect(injectTray('<p>x</p>', 'abc')).toBe(
			'<p>x</p><script type="module" nonce="abc" src="/__punchlist/tray.ts"></script>',
		);
	});

	test.each([
		["script-src 'nonce-abc'", 'abc'],
		["default-src 'self'; script-src 'self' 'nonce-s'", 's'],
		["default-src 'nonce-d'", 'd'],
		["default-src 'nonce-d'; script-src 'self'", undefined],
		["img-src 'nonce-i'", undefined],
		["script-src 'self'", undefined],
		["SCRIPT-SRC 'NONCE-abc'", 'abc'],
		["script-src 'self', script-src 'nonce-n'", 'n'],
		["script-src-elem 'nonce-e'; script-src 'nonce-s'", 'e'],
		["script-src-elem 'nonce-e'", 'e'],
		[`script-src 'nonce-a"onload="x'`, undefined],
	])('scriptNonce(%s)', (csp, nonce) => {
		expect(scriptNonce(csp)).toBe(nonce);
	});

	test('scriptNonce handles an absent header', () => {
		expect(scriptNonce(undefined)).toBeUndefined();
	});
});

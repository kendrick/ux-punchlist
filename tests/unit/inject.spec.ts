import { describe, expect, test } from 'vitest';
import { injectTray } from '../../src/server/inject.ts';

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

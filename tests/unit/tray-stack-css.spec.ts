// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTrayCss } from '../../spikes/tray-stack/build-css.ts';
import { postProcess } from '../../spikes/tray-stack/post-process.ts';

describe('postProcess', () => {
	it('rewrites :root and :host to [data-pl-root]', () => {
		const out = postProcess(':root,:host{--a:1}:root{--b:2}');
		expect(out).toContain('[data-pl-root]{--a:1}');
		expect(out).toContain('[data-pl-root]{--b:2}');
		expect(out).not.toContain(':root');
		expect(out).not.toContain(':host');
	});

	it('collapses the spaced selector list Tailwind emits', () => {
		expect(postProcess(':root, :host{--a:1}')).toBe('[data-pl-root]{--a:1}');
	});

	it('leaves :host() alone', () => {
		expect(postProcess(':host(.x){color:red}')).toBe(':host(.x){color:red}');
	});

	it('converts rem to px', () => {
		const out = postProcess(
			'a{margin:.5rem;padding:calc(100% - 2rem);gap:-0.25rem;radius:.625rem}',
		);
		expect(out).toContain('8px');
		expect(out).toContain('calc(100% - 32px)');
		expect(out).toContain('-4px');
		expect(out).toContain('10px');
		expect(out).not.toContain('rem');
		expect(postProcess('a{content:"lorem"}')).toBe('a{content:"lorem"}');
	});

	it('turns @property initial values into declarations', () => {
		const out = postProcess(
			'@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}' +
				'@property --tw-x{syntax:"*";inherits:true;initial-value:1}' +
				'@property --tw-y{syntax:"*";inherits:false}',
		);
		expect(out).not.toContain('@property');
		expect(out).toContain(
			'[data-pl-root],[data-pl-root] *,::before,::after{--tw-ring-shadow:0 0 #0000}',
		);
		expect(out).toContain('[data-pl-root]{--tw-x:1}');
		expect(out).not.toContain('--tw-y');
	});
});

describe('tray-css.ts', () => {
	it('committed file matches a fresh build', async () => {
		// Read the committed bytes; never rebuild first or the check proves nothing.
		const committed = readFileSync(
			new URL('../../spikes/tray-stack/tray-css.ts', import.meta.url),
			'utf8',
		);
		expect(
			await buildTrayCss(),
			'tray-css.ts is stale or hand-edited: run pnpm build:tray-css',
		).toBe(committed);
	});
});

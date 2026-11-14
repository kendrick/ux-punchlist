// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

	it('layers the declarations so utilities that set --tw-* vars still win', () => {
		const out = postProcess(
			'@layer properties;@layer utilities{.ring{--tw-ring-shadow:0 0 0 3px red}}' +
				'@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}' +
				'@property --tw-x{syntax:"*";inherits:true;initial-value:1}',
		);
		expect(out).toMatch(
			/@layer properties\{\[data-pl-root\],\[data-pl-root\] \*,::before,::after\{--tw-ring-shadow:0 0 #0000\}\[data-pl-root\]\{--tw-x:1\}\}$/,
		);
		expect(postProcess('a{b:c}')).toBe('a{b:c}');
	});

	it('gives a unitless <length> initial value a unit', () => {
		const out = postProcess(
			'@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}' +
				'@property --tw-n{syntax:"*";inherits:false;initial-value:0}',
		);
		expect(out).toContain('--tw-ring-offset-width:0px');
		expect(out).toContain('--tw-n:0}');
	});
});

describe('built tray CSS', () => {
	it('declares the properties layer ahead of utilities, so it ranks lowest', async () => {
		const { css } = await import('../../spikes/tray-stack/tray-css.ts');
		// Cascade layers rank by first appearance.
		const first = css.indexOf('@layer properties');
		expect(first).toBeGreaterThanOrEqual(0);
		expect(first).toBeLessThan(css.indexOf('@layer utilities'));
		expect(css).toContain('--tw-ring-offset-width:0px');
		expect(css).not.toMatch(/--tw-ring-offset-width:0[;}]/);
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

describe('build-css.ts', () => {
	it('builds from a checkout path that contains a space', () => {
		// URL.pathname leaves "%20" in the path, so execFile hit ENOENT on a spaced checkout (66bc17f).
		const repo = fileURLToPath(new URL('../../', import.meta.url));
		const tmp = mkdtempSync(join(tmpdir(), 'tray-css-'));
		try {
			const copy = join(tmp, 'with space');
			const dir = join(copy, 'spikes/tray-stack');
			mkdirSync(dir, { recursive: true });
			for (const f of ['build-css.ts', 'post-process.ts', 'input.css', 'tray.ts']) {
				cpSync(join(repo, 'spikes/tray-stack', f), join(dir, f));
			}
			symlinkSync(join(repo, 'node_modules'), join(copy, 'node_modules'));
			execFileSync('node', [join(dir, 'build-css.ts')], { cwd: tmp });
			expect(readFileSync(join(dir, 'tray-css.ts'), 'utf8')).toBe(
				readFileSync(join(repo, 'spikes/tray-stack/tray-css.ts'), 'utf8'),
			);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}, 30_000);
});

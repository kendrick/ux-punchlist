import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/core/manifest.ts';
import { openSession } from '../../src/server/session-store.ts';

const cli = resolve('src/plan/cli.ts');
const fixture = resolve('fixtures/app');
let tmp: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });
const commit = (msg: string) => {
	git('add', '-A');
	git('commit', '-m', msg);
};
const plan = (...extra: string[]) =>
	spawnSync(process.execPath, [cli, '--app', 'app', '--root', tmp, ...extra], {
		encoding: 'utf8',
	});
const manifestPath = () => join(tmp, '.review', 'manifest.yaml');

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), 'plan-cli-'));
	git('init', '-b', 'main');
	git('config', 'user.email', 'a@b.c');
	git('config', 'user.name', 'T');
	cpSync(fixture, join(tmp, 'app'), { recursive: true });
	commit('base');
	git('switch', '-c', 'feature');
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const changeTwoPages = () => {
	for (const f of ['index.html', 'pricing.html'])
		writeFileSync(join(tmp, 'app', f), readFileSync(join(tmp, 'app', f), 'utf8') + '\n<!-- x -->');
	commit('change pages');
};

describe('plan cli', () => {
	it('writes an item per changed page', { timeout: 60_000 }, () => {
		changeTwoPages();
		const r = plan();
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('punchlist: plan: wrote 2 items to .review/manifest.yaml');
		expect(parseManifest(readFileSync(manifestPath(), 'utf8')).map((i) => i.url)).toEqual([
			'/',
			'/pricing.html',
		]);
	});

	it('writes no items for test and doc changes', { timeout: 60_000 }, () => {
		writeFileSync(join(tmp, 'README.md'), '# hi');
		execFileSync('mkdir', ['-p', join(tmp, 'tests')]);
		writeFileSync(join(tmp, 'tests', 'a.spec.ts'), '');
		commit('docs and tests');
		const r = plan();
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('no reviewable changes');
		expect(readFileSync(manifestPath(), 'utf8')).toBe('items: []\n');
	});

	it('a hand-deleted item is gone at the next session start', { timeout: 60_000 }, () => {
		changeTwoPages();
		expect(plan().status).toBe(0);
		const text = readFileSync(manifestPath(), 'utf8');
		// Hand edit: drop the pricing item's block from the YAML text.
		const blocks = text.split(/^(?=  - )/m);
		writeFileSync(manifestPath(), blocks.filter((b) => !b.includes('/pricing.html')).join(''));
		const session = openSession(tmp, () => 'now');
		try {
			expect(session.state().items).toHaveLength(1);
		} finally {
			session.close();
		}
	});

	it('refuses to overwrite', { timeout: 60_000 }, () => {
		changeTwoPages();
		expect(plan().status).toBe(0);
		const before = readFileSync(manifestPath());
		const r = plan();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain(
			'punchlist: plan: .review/manifest.yaml exists; delete it to re-plan',
		);
		expect(readFileSync(manifestPath()).equals(before)).toBe(true);
	});

	it('fails cleanly without a base', { timeout: 60_000 }, () => {
		const r = plan('--base', 'nope');
		expect(r.status).toBe(1);
		expect(r.stderr.startsWith('punchlist: plan:')).toBe(true);
		expect(existsSync(manifestPath())).toBe(false);
	});
});

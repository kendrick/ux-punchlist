import { execFileSync, spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
		mkdirSync(join(tmp, 'tests'));
		writeFileSync(join(tmp, 'tests', 'a.spec.ts'), '');
		commit('docs and tests');
		const r = plan();
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('no reviewable changes');
		expect(readFileSync(manifestPath(), 'utf8')).toBe('items: []\n');
		expect(parseManifest(readFileSync(manifestPath(), 'utf8'))).toEqual([]);
	});

	it('a hand-deleted item is gone at the next session start', { timeout: 60_000 }, () => {
		changeTwoPages();
		expect(plan().status).toBe(0);
		const text = readFileSync(manifestPath(), 'utf8');
		const blocks = text.split(/^(?=  - )/m);
		writeFileSync(manifestPath(), blocks.filter((b) => !b.includes('/pricing.html')).join(''));
		const session = openSession(tmp, () => 'now');
		try {
			expect(session.state().items).toHaveLength(1);
		} finally {
			session.close();
		}
	});

	it('finds changed pages when the project sits in a repo subfolder', { timeout: 60_000 }, () => {
		mkdirSync(join(tmp, 'web'));
		git('mv', 'app', 'web/app');
		commit('move into web');
		git('switch', '-c', 'sub');
		writeFileSync(join(tmp, 'web', 'app', 'index.html'), '<!-- x -->');
		commit('change page');
		const r = spawnSync(
			process.execPath,
			[cli, '--app', 'app', '--root', join(tmp, 'web'), '--base', 'feature'],
			{ encoding: 'utf8' },
		);
		expect(r.stdout).toContain('wrote 1 item to');
		expect(
			parseManifest(readFileSync(join(tmp, 'web', '.review', 'manifest.yaml'), 'utf8')).map(
				(i) => i.url,
			),
		).toEqual(['/']);
	});

	it('accepts an absolute --app path', { timeout: 60_000 }, () => {
		changeTwoPages();
		const r = plan('--app', join(tmp, 'app'));
		expect(r.stdout).toContain('wrote 2 items');
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

	it('fails in one line on a root that is not a git repo', { timeout: 60_000 }, () => {
		const dir = mkdtempSync(join(tmpdir(), 'plan-nogit-'));
		try {
			const r = spawnSync(process.execPath, [cli, '--root', dir], { encoding: 'utf8' });
			expect(r.status).toBe(1);
			expect(r.stderr).toMatch(/^punchlist: plan: fatal: not a git repository[^\n]*\n$/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('fails in one line on a root that does not exist', { timeout: 60_000 }, () => {
		const dir = join(tmp, 'missing');
		const r = spawnSync(process.execPath, [cli, '--root', dir], { encoding: 'utf8' });
		expect(r.status).toBe(1);
		expect(r.stderr).toBe(`punchlist: plan: --root ${dir} does not exist\n`);
	});
});

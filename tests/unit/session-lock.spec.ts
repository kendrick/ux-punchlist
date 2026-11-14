import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { lockSession, SessionLockedError } from '../../src/server/session-lock.ts';

// Pass-through spies, so a test can look at or interleave the lock's file steps as they happen.
vi.mock('node:fs', async (importOriginal) => {
	const real = await importOriginal<typeof import('node:fs')>();
	return { ...real, linkSync: vi.fn(real.linkSync), unlinkSync: vi.fn(real.unlinkSync) };
});

const { linkSync: realLinkSync, unlinkSync: realUnlinkSync } =
	await vi.importActual<typeof import('node:fs')>('node:fs');
const tmp = () => mkdtempSync(join(tmpdir(), 'punchlist-lock-'));

describe('lockSession', () => {
	test('takes the lock and writes this pid', () => {
		const dir = tmp();
		lockSession(dir);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe(String(process.pid));
	});

	test('a second lockSession on a held dir throws SessionLockedError naming the holder', () => {
		const dir = tmp();
		lockSession(dir);
		let err: unknown;
		try {
			lockSession(dir);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(SessionLockedError);
		expect(err).toMatchObject({
			pid: process.pid,
			message: `another punchlist server (pid ${process.pid}) is already running on this root`,
		});
	});

	test('release lets the dir be locked again, and a second release is a no-op', () => {
		const dir = tmp();
		const release = lockSession(dir);
		release();
		release();
		expect(() => lockSession(dir)).not.toThrow();
	});

	test('an old release called again after the dir is locked anew leaves the new lock in place', () => {
		const dir = tmp();
		const releaseA = lockSession(dir);
		releaseA();
		lockSession(dir);
		releaseA();
		expect(() => lockSession(dir)).toThrow(SessionLockedError);
	});

	test('a lock left by a dead pid is taken over', () => {
		const dir = tmp();
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(join(dir, 'session.lock'), String(dead));
		lockSession(dir);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe(String(process.pid));
	});

	test.each(['', 'nope'])('an empty or garbage lock file (%j) is taken over', (body) => {
		const dir = tmp();
		writeFileSync(join(dir, 'session.lock'), body);
		lockSession(dir);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe(String(process.pid));
	});

	test('release leaves a lock another process took over alone', () => {
		const dir = tmp();
		const release = lockSession(dir);
		writeFileSync(join(dir, 'session.lock'), '1234567');
		release();
		expect(existsSync(join(dir, 'session.lock'))).toBe(true);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe('1234567');
	});

	test('session.lock first appears already holding the pid, and lock plus release leave no temp file', () => {
		const dir = tmp();
		const path = join(dir, 'session.lock');
		const seen: { existed: boolean; body: string }[] = [];
		vi.mocked(fs.linkSync).mockImplementationOnce((src, dest) => {
			seen.push({ existed: existsSync(path), body: readFileSync(src, 'utf8') });
			realLinkSync(src, dest);
		});
		const release = lockSession(dir);
		expect(seen).toEqual([{ existed: false, body: String(process.pid) }]);
		expect(readdirSync(dir)).toEqual(['.gitignore', 'session.lock']);
		release();
		expect(readdirSync(dir)).toEqual(['.gitignore']);
	});

	test('losing a takeover race to a holder that is already gone names no pid', () => {
		const dir = tmp();
		const path = join(dir, 'session.lock');
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(path, String(dead));
		vi.mocked(fs.linkSync)
			.mockImplementationOnce(realLinkSync) // session.lock: EEXIST
			.mockImplementationOnce(realLinkSync) // session.lock.takeover
			.mockImplementationOnce(() => {
				// A fresh start takes the stale lock between our unlink and our link, then dies.
				writeFileSync(path, String(dead));
				throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
			});
		let err: unknown;
		try {
			lockSession(dir);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(SessionLockedError);
		expect(err).toMatchObject({
			pid: undefined,
			message: 'another punchlist server is already running on this root',
		});
	});

	test('two starts that both see the same dead holder: at most one ends up holding the lock', () => {
		const dir = tmp();
		const path = join(dir, 'session.lock');
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(path, String(dead));
		const results: string[] = [];
		const attempt = () => {
			try {
				lockSession(dir);
				results.push('locked');
			} catch (e) {
				if (!(e instanceof SessionLockedError)) throw e;
				results.push('refused');
			}
		};
		let hooked = false;
		vi.mocked(fs.unlinkSync).mockImplementation((p) => {
			// B has judged the lock stale and is about to remove it; A, which saw the same dead pid, runs to completion first.
			if (p === path && !hooked) {
				hooked = true;
				attempt();
			}
			realUnlinkSync(p);
		});
		try {
			attempt();
		} finally {
			vi.mocked(fs.unlinkSync).mockImplementation(realUnlinkSync);
		}
		expect(hooked).toBe(true);
		// lib is ES2022 (no toSorted); the spread is already a copy.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect([...results].sort()).toEqual(['locked', 'refused']);
		expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
		expect(readdirSync(dir)).toEqual(['.gitignore', 'session.lock']);
	});

	test('a takeover file left by a dead pid is cleared and the stale lock taken over', () => {
		const dir = tmp();
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(join(dir, 'session.lock'), String(dead));
		writeFileSync(join(dir, 'session.lock.takeover'), String(dead));
		lockSession(dir);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe(String(process.pid));
		expect(readdirSync(dir)).toEqual(['.gitignore', 'session.lock']);
	});

	test('a takeover file a live process holds refuses, and leaves both files alone', () => {
		const dir = tmp();
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(join(dir, 'session.lock'), String(dead));
		writeFileSync(join(dir, 'session.lock.takeover'), String(process.ppid));
		// No pid in the message: the session.lock holder is dead, and the takeover holder isn't the server.
		expect(() => lockSession(dir)).toThrow(
			'another punchlist server is already running on this root',
		);
		expect(readFileSync(join(dir, 'session.lock'), 'utf8')).toBe(String(dead));
		expect(readFileSync(join(dir, 'session.lock.takeover'), 'utf8')).toBe(String(process.ppid));
	});

	test('two dirs lock side by side', () => {
		const a = tmp();
		const b = tmp();
		lockSession(a);
		expect(() => lockSession(b)).not.toThrow();
	});
});

const git = (cwd: string, ...args: string[]) =>
	spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout;
const repo = () => {
	const root = tmp();
	git(root, 'init');
	const review = join(root, '.review');
	mkdirSync(review);
	return { root, review };
};
const status = (root: string) => git(root, 'status', '--porcelain', '--untracked-files=all');

describe('lockSession in a git repo', () => {
	test("a lock left by a crash doesn't show in git status", () => {
		const { root, review } = repo();
		lockSession(review); // never released: what a SIGKILL leaves behind
		writeFileSync(join(review, 'session.lock.takeover'), '1');
		writeFileSync(join(review, 'session.lock.123.tmp'), '1');
		const out = status(root);
		for (const name of [
			'session.lock',
			'session.lock.takeover',
			'session.lock.123.tmp',
			'.gitignore',
		])
			expect(out).not.toContain(name);
	});

	test('the review record still shows in git status', () => {
		const { root, review } = repo();
		lockSession(review);
		writeFileSync(join(review, 'events.jsonl'), '');
		writeFileSync(join(review, 'manifest.yaml'), '');
		mkdirSync(join(review, 'screenshots'));
		writeFileSync(join(review, 'screenshots', 'a.png'), '');
		const out = status(root);
		for (const f of ['events.jsonl', 'manifest.yaml', 'screenshots/a.png'])
			expect(out).toContain(`.review/${f}`);
	});

	test('an existing .review/.gitignore is left alone', () => {
		const { review } = repo();
		writeFileSync(join(review, '.gitignore'), 'keep-me\n');
		lockSession(review);
		expect(readFileSync(join(review, '.gitignore'), 'utf8')).toBe('keep-me\n');
	});

	test("the project's .gitignore is never written", () => {
		const a = repo();
		writeFileSync(join(a.root, '.gitignore'), 'node_modules/\n');
		lockSession(a.review);
		expect(readFileSync(join(a.root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
		const b = repo();
		lockSession(b.review);
		expect(existsSync(join(b.root, '.gitignore'))).toBe(false);
	});
});

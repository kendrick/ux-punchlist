import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { lockSession, SessionLockedError } from '../../src/server/session-lock.ts';

// Pass-through spy, so a test can look at the lock's source file at the moment it is linked into place.
vi.mock('node:fs', async (importOriginal) => {
	const real = await importOriginal<typeof import('node:fs')>();
	return { ...real, linkSync: vi.fn(real.linkSync) };
});

const { linkSync: realLinkSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
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
		expect(readdirSync(dir)).toEqual(['session.lock']);
		release();
		expect(readdirSync(dir)).toEqual([]);
	});

	test('losing a takeover race to a holder that is already gone names no pid', () => {
		const dir = tmp();
		const path = join(dir, 'session.lock');
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		writeFileSync(path, String(dead));
		vi.mocked(fs.linkSync)
			.mockImplementationOnce(realLinkSync)
			.mockImplementationOnce(() => {
				// Another start takes the stale lock between our unlink and our link, then dies.
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

	test('two dirs lock side by side', () => {
		const a = tmp();
		const b = tmp();
		lockSession(a);
		expect(() => lockSession(b)).not.toThrow();
	});
});

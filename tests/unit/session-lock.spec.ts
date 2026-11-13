import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { lockSession, SessionLockedError } from '../../src/server/session-lock.ts';

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
		expect(() => lockSession(dir)).toThrow(SessionLockedError);
		const err = (() => {
			try {
				lockSession(dir);
				return undefined;
			} catch (e) {
				return e;
			}
		})();
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

	test('two dirs lock side by side', () => {
		const a = tmp();
		const b = tmp();
		lockSession(a);
		expect(() => lockSession(b)).not.toThrow();
	});
});

// @vitest-environment node
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ReviewEvent } from '../../src/core/events.ts';
import { appendEvents, LogError, readLog } from '../../src/core/log.ts';

const ev = (seq: number): ReviewEvent => ({
	seq,
	at: '2026-01-01T00:00:00.000Z',
	type: 'item-approved',
	itemId: `i${seq}`,
});
const tmpLog = () => join(mkdtempSync(join(tmpdir(), 'punchlist-log-')), '.review', 'events.jsonl');

describe('log', () => {
	test('readLog returns [] for a missing file', () => {
		expect(readLog(tmpLog())).toEqual([]);
	});

	test('appendEvents then readLog round-trips events', () => {
		const path = tmpLog();
		appendEvents(path, [ev(1), ev(2)]);
		appendEvents(path, [ev(3)]);
		expect(readLog(path)).toEqual([ev(1), ev(2), ev(3)]);
	});

	test('the file only grows: after each of three appends, the previous bytes are a prefix of the new bytes', () => {
		const path = tmpLog();
		let before = Buffer.alloc(0);
		for (const n of [1, 2, 3]) {
			appendEvents(path, [ev(n)]);
			const after = readFileSync(path);
			expect(after.length).toBeGreaterThan(before.length);
			expect(after.subarray(0, before.length).equals(before)).toBe(true);
			before = after;
		}
	});

	test('readLog throws LogError naming the path and the byte offset when the last line has no trailing newline', () => {
		const path = tmpLog();
		appendEvents(path, [ev(1)]);
		const good = readFileSync(path).length;
		appendFileSync(path, '{"seq":2,"at"');
		const bytes = readFileSync(path);
		expect(() => readLog(path)).toThrow(LogError);
		expect(() => readLog(path)).toThrow(path);
		expect(() => readLog(path)).toThrow(`byte offset ${good}`);
		expect(readFileSync(path).equals(bytes)).toBe(true);
	});

	test('readLog throws LogError naming the line number when a line is not valid JSON', () => {
		const path = tmpLog();
		appendEvents(path, [ev(1)]);
		appendFileSync(path, 'not json\n');
		expect(() => readLog(path)).toThrow(LogError);
		expect(() => readLog(path)).toThrow('line 2');
	});
});

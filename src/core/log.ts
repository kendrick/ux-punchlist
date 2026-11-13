import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ReviewEvent } from './events.ts';

export class LogError extends Error {}

export function readLog(path: string): ReviewEvent[] {
	if (!existsSync(path)) return [];
	const bytes = readFileSync(path);
	if (bytes.length === 0) return [];

	// A crash mid-append leaves no trailing newline; refuse rather than repair, so the file is never rewritten.
	if (bytes[bytes.length - 1] !== 0x0a) {
		const tornAt = bytes.lastIndexOf(0x0a) + 1;
		throw new LogError(`${path}: torn last line starting at byte offset ${tornAt}`);
	}

	return bytes
		.toString('utf8')
		.slice(0, -1)
		.split('\n')
		.map((line, i) => {
			try {
				const event: ReviewEvent = JSON.parse(line);
				return event;
			} catch {
				throw new LogError(`${path}: line ${i + 1} is not valid JSON`);
			}
		});
}

export function appendEvents(path: string, events: readonly ReviewEvent[]): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, events.map((e) => JSON.stringify(e) + '\n').join(''), { flag: 'a' });
}

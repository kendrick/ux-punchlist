import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, ReviewEvent, SessionState } from '../core/events.ts';
import { appendEvents, readLog } from '../core/log.ts';
import { parseManifest } from '../core/manifest.ts';
import { decide, reduce } from '../core/session.ts';

const DIFFERS = "manifest.yaml differs from the running session; keeping the session's items";

export function openSession(root: string, now: () => string) {
	const logPath = join(root, '.review', 'events.jsonl');
	const manifestPath = join(root, '.review', 'manifest.yaml');
	const events: ReviewEvent[] = readLog(logPath);
	let state = reduce(events);
	let warning: string | null = null;

	const run = (command: Command): SessionState => {
		const next = decide(state, command, now());
		appendEvents(logPath, next);
		events.push(...next);
		state = reduce(events);
		return state;
	};

	if (events.length === 0) {
		run({ type: 'start', items: parseManifest(readFileSync(manifestPath, 'utf8')) });
	} else {
		// A broken or missing manifest mid-session shouldn't block resuming; the log is the source of truth.
		let current: unknown = null;
		try {
			current = parseManifest(readFileSync(manifestPath, 'utf8'));
		} catch {}
		if (JSON.stringify(current) !== JSON.stringify(state.items)) warning = DIFFERS;
	}

	return { state: () => state, run, warning };
}

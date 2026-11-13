import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export class SessionLockedError extends Error {
	readonly pid: number;
	constructor(pid: number) {
		super(`another punchlist server (pid ${pid}) is already running on this root`);
		this.pid = pid;
	}
}

const code = (err: unknown) => (err instanceof Error && 'code' in err ? err.code : undefined);

function tryCreate(path: string): boolean {
	let fd: number;
	try {
		fd = openSync(path, 'wx');
	} catch (err) {
		if (code(err) === 'EEXIST') return false;
		throw err;
	}
	try {
		writeSync(fd, String(process.pid));
	} finally {
		closeSync(fd);
	}
	return true;
}

/** The holder's PID when it is alive, else null. */
function liveHolder(path: string): number | null {
	let body: string;
	try {
		body = readFileSync(path, 'utf8');
	} catch (err) {
		if (code(err) === 'ENOENT') return null;
		throw err;
	}
	const pid = Number.parseInt(body, 10);
	if (!(pid > 0)) return null;
	try {
		process.kill(pid, 0);
		return pid;
	} catch (err) {
		// shortcut: a reused PID reads as alive and blocks the root until it exits; record a start time too if that bites.
		return code(err) === 'EPERM' ? pid : null;
	}
}

/** Takes `<dir>/session.lock`; the returned release only removes a lock that is still ours. */
export function lockSession(dir: string): () => void {
	const path = join(dir, 'session.lock');
	if (!tryCreate(path)) {
		const holder = liveHolder(path);
		if (holder !== null) throw new SessionLockedError(holder);
		try {
			unlinkSync(path);
		} catch (err) {
			if (code(err) !== 'ENOENT') throw err;
		}
		if (!tryCreate(path)) {
			// Lost the race to another process; no retry loop.
			throw new SessionLockedError(liveHolder(path) ?? 0);
		}
	}
	return () => {
		try {
			if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
		} catch (err) {
			if (code(err) !== 'ENOENT') throw err;
		}
	};
}

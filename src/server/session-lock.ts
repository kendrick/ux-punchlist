import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class SessionLockedError extends Error {
	readonly pid: number | undefined;
	constructor(pid?: number) {
		super(`another punchlist server${pid ? ` (pid ${pid})` : ''} is already running on this root`);
		this.pid = pid;
	}
}

const code = (err: unknown) => (err instanceof Error && 'code' in err ? err.code : undefined);

function ignoreENOENT<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch (err) {
		if (code(err) !== 'ENOENT') throw err;
		return undefined;
	}
}

function tryCreate(path: string): boolean {
	// Link a full temp file into place: with open('wx') then write, a racing start could read the lock empty, call it stale, and take it.
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, String(process.pid));
	try {
		linkSync(tmp, path);
		return true;
	} catch (err) {
		if (code(err) === 'EEXIST') return false;
		throw err;
	} finally {
		unlinkSync(tmp);
	}
}

/** The holder's PID when it is alive, else null. */
function liveHolder(path: string): number | null {
	const pid = Number.parseInt(ignoreENOENT(() => readFileSync(path, 'utf8')) ?? '', 10);
	if (!(pid > 0)) return null;
	try {
		process.kill(pid, 0);
		return pid;
	} catch (err) {
		// shortcut: a reused PID reads as alive and blocks the root until it exits; record a start time too if that bites.
		// EPERM: the process exists, it just isn't ours to signal.
		return code(err) === 'EPERM' ? pid : null;
	}
}

/** Removes `path` only while it still holds our PID, so we never delete a lock someone else took. */
const releaseIfOurs = (path: string) => () =>
	ignoreENOENT(() => {
		if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
	});

/** Replaces a stale session.lock; only the holder of `<lock>.takeover` may unlink it, so two restarts can't both win. */
function takeOver(path: string, retried = false): void {
	const guard = `${path}.takeover`;
	if (!tryCreate(guard)) {
		if (retried || liveHolder(guard) !== null)
			throw new SessionLockedError(liveHolder(path) ?? undefined);
		// shortcut: two starts that both find a takeover file left by a SIGKILLed takeover can both remove it (B unlinks A's fresh one), then race as before; needs a takeover keyed on more than a PID if crashes mid-takeover become real.
		ignoreENOENT(() => unlinkSync(guard));
		return takeOver(path, true);
	}
	try {
		// Re-check under the guard: a racing start may have taken the lock since we judged it stale.
		const holder = liveHolder(path);
		if (holder !== null) throw new SessionLockedError(holder);
		ignoreENOENT(() => unlinkSync(path));
		// A fresh start's plain create can still land between our unlink and link; it then holds the lock fairly.
		if (!tryCreate(path)) throw new SessionLockedError(liveHolder(path) ?? undefined);
	} finally {
		releaseIfOurs(guard)();
	}
}

/** Takes `<dir>/session.lock`; the returned release only removes a lock that is still ours. */
export function lockSession(dir: string): () => void {
	const path = join(dir, 'session.lock');
	if (!tryCreate(path)) {
		const holder = liveHolder(path);
		if (holder !== null) throw new SessionLockedError(holder);
		takeOver(path);
	}
	// Another server may have taken over a lock we were judged dead on; never remove theirs.
	return releaseIfOurs(path);
}

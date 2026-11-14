import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewEvent } from '../../src/core/events.ts';
import { readLog } from '../../src/core/log.ts';

const repo = join(import.meta.dirname, '..', '..');

export function portOf(server: Server): number {
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('server is not listening on a port');
	return address.port;
}

export const manifestPath = join(repo, 'fixtures', 'manifest.yaml');
export const appDir = join(repo, 'fixtures', 'app');

export function makeRoot(manifest?: string): string {
	const root = mkdtempSync(join(tmpdir(), 'punchlist-e2e-'));
	mkdirSync(join(root, '.review'));
	if (manifest) writeFileSync(join(root, '.review', 'manifest.yaml'), manifest);
	else cpSync(manifestPath, join(root, '.review', 'manifest.yaml'));
	return root;
}

export function startPunchlist(
	root: string,
	target: string,
): Promise<{ url: string; kill(): Promise<void> }> {
	const child = spawn(
		'node',
		[join(repo, 'src', 'cli.ts'), 'start', '--target', target, '--root', root],
		{ stdio: ['ignore', 'pipe', 'inherit'] },
	);
	return new Promise((resolve, reject) => {
		let out = '';
		child.once('exit', (code) => reject(new Error(`punchlist exited early (${code}): ${out}`)));
		child.stdout.on('data', (chunk) => {
			out += chunk;
			const m = out.match(/punchlist: listening on (\S+)/);
			if (m?.[1]) {
				child.removeAllListeners('exit');
				resolve({
					url: m[1],
					kill: () => {
						if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
						const exited = new Promise<void>((r) => child.once('exit', () => r()));
						child.kill('SIGKILL');
						return exited;
					},
				});
			}
		});
	});
}

export const readLogBytes = (root: string): string =>
	readFileSync(join(root, '.review', 'events.jsonl'), 'utf8');

export const readEvents = (root: string): ReviewEvent[] =>
	readLog(join(root, '.review', 'events.jsonl'));

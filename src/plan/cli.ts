import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { serializeManifest } from '../core/manifest.ts';
import { planItems } from './plan.ts';

const { values } = parseArgs({
	options: {
		app: { type: 'string', default: '.' },
		base: { type: 'string', default: 'main' },
		root: { type: 'string', default: process.cwd() },
	},
});

const fail = (reason: string): never => {
	console.error(`punchlist: plan: ${reason}`);
	process.exit(1);
};

try {
	const diff = execFileSync(
		'git',
		['diff', '--relative', '--name-only', '--diff-filter=d', `${values.base}...HEAD`],
		{ cwd: values.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	);
	const items = planItems(
		diff.split('\n').filter(Boolean),
		relative(values.root, resolve(values.root, values.app)) || '.',
	);
	const dir = join(values.root, '.review');
	mkdirSync(dir, { recursive: true });
	// Flag wx: never clobber a manifest the owner may have hand-edited.
	writeFileSync(join(dir, 'manifest.yaml'), serializeManifest(items), { flag: 'wx' });
	console.log(
		items.length === 0
			? 'punchlist: plan: no reviewable changes'
			: `punchlist: plan: wrote ${items.length} ${items.length === 1 ? 'item' : 'items'} to .review/manifest.yaml`,
	);
} catch (e) {
	const err = e instanceof Error ? e : new Error(String(e));
	if ('code' in err && err.code === 'EEXIST')
		fail('.review/manifest.yaml exists; delete it to re-plan');
	const stderr = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : '';
	fail((stderr || err.message).trim());
}

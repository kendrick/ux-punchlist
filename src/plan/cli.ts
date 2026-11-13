import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { serializeManifest } from '../core/manifest.ts';
import { planItems } from './plan.ts';

const fail = (reason: string): never => {
	console.error(`punchlist: plan: ${reason}`);
	process.exit(1);
};

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

// parseArgs throws on unknown flags, stray positionals and valueless flags; its message already names the flag.
const parse = () => {
	try {
		return parseArgs({
			options: {
				app: { type: 'string', default: '.' },
				base: { type: 'string', default: 'main' },
				root: { type: 'string', default: process.cwd() },
			},
		}).values;
	} catch (e) {
		return fail(asError(e).message.split('\n')[0] ?? '');
	}
};
const values = parse();

// `--base=` makes git diff read "...HEAD", which is valid and silently plans nothing.
if (!values.base) fail('--base must not be empty');

// Only a missing path is expected; anything else (EACCES, ELOOP) would otherwise surface as a stack trace.
const statDir = (flag: string, path: string) => {
	try {
		return statSync(path, { throwIfNoEntry: false });
	} catch (e) {
		const err = asError(e);
		return fail(
			`${flag} ${path}: ${'code' in err && typeof err.code === 'string' ? err.code : err.message}`,
		);
	}
};

// Without these, a bad cwd surfaces as "spawnSync git ENOENT/ENOTDIR" and a non-git dir as git diff's usage dump.
const rootStat = statDir('--root', values.root);
if (!rootStat) fail(`--root ${values.root} does not exist`);
if (!rootStat?.isDirectory()) fail(`--root ${values.root} is not a directory`);
// A mistyped --app would otherwise filter every path out and look like "no reviewable changes".
const appDir = relative(values.root, resolve(values.root, values.app)) || '.';
if (appDir === '..' || appDir.startsWith('../') || isAbsolute(appDir))
	fail(`--app ${values.app} is outside --root ${values.root}`);
if (!statDir('--app', resolve(values.root, appDir))?.isDirectory())
	fail(`--app ${values.app} is not a directory under --root ${values.root}`);
const git = (...args: string[]) =>
	execFileSync('git', args, {
		cwd: values.root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

try {
	git('rev-parse', '--git-dir');
	// -z: without it git quotes and octal-escapes non-ASCII paths, so "ü.html" fails the .html check.
	const diff = git(
		'diff',
		'-z',
		'--relative',
		'--name-only',
		'--diff-filter=d',
		`${values.base}...HEAD`,
	);
	const items = planItems(diff.split('\0').filter(Boolean), appDir);
	const dir = join(values.root, '.review');
	// A plain file here makes mkdirSync throw EEXIST, which the catch would misreport as an existing manifest.
	if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() === false)
		fail('.review exists and is not a directory');
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
	fail((stderr || err.message).trim().split('\n')[0] ?? '');
}

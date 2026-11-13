import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { postProcess } from './post-process.ts';

const here = new URL('.', import.meta.url);
const root = new URL('../../', import.meta.url);
const OUT = new URL('tray-css.ts', here);

export async function buildTrayCss(): Promise<string> {
	const bin = new URL('node_modules/.bin/tailwindcss', root).pathname;
	const { stdout } = await promisify(execFile)(
		bin,
		['-i', new URL('input.css', here).pathname, '--minify'],
		{ cwd: root.pathname, maxBuffer: 16 * 1024 * 1024 },
	);
	return `export const css = ${JSON.stringify(postProcess(stdout))};\n`;
}

if (import.meta.main) {
	const next = await buildTrayCss();
	// Skip identical writes so a no-op build leaves mtime alone.
	let prev = '';
	try {
		prev = readFileSync(OUT, 'utf8');
	} catch {}
	if (prev !== next) writeFileSync(OUT, next);
}

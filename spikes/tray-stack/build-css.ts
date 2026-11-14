import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { postProcess } from './post-process.ts';

const here = new URL('.', import.meta.url);
const root = new URL('../../', import.meta.url);

export async function buildTrayCss(): Promise<string> {
	const bin = new URL('node_modules/.bin/tailwindcss', root).pathname;
	const { stdout } = await promisify(execFile)(
		bin,
		['-i', new URL('input.css', here).pathname, '--minify'],
		{ cwd: root.pathname, maxBuffer: 16 * 1024 * 1024 },
	);
	return `export const css = ${JSON.stringify(postProcess(stdout))};\n`;
}

if (import.meta.main) writeFileSync(new URL('tray-css.ts', here), await buildTrayCss());

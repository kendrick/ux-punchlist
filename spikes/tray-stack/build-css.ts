import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { postProcess } from './post-process.ts';

const here = new URL('.', import.meta.url);
const root = new URL('../../', import.meta.url);

export async function buildTrayCss(): Promise<string> {
	const bin = fileURLToPath(new URL('node_modules/.bin/tailwindcss', root));
	const { stdout } = await promisify(execFile)(
		bin,
		['-i', fileURLToPath(new URL('input.css', here)), '--minify'],
		{ cwd: fileURLToPath(root), maxBuffer: 16 * 1024 * 1024 },
	);
	return `export const css = ${JSON.stringify(postProcess(stdout))};\n`;
}

if (import.meta.main) writeFileSync(new URL('tray-css.ts', here), await buildTrayCss());

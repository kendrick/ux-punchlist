import { parseArgs } from 'node:util';
import { LogError } from './core/log.ts';
import { ManifestError } from './core/manifest.ts';
import { createScreenshotter } from './server/screenshot.ts';
import { startServer } from './server/server.ts';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		target: { type: 'string' },
		port: { type: 'string', default: '0' },
		root: { type: 'string', default: process.cwd() },
	},
});

if (positionals[0] !== 'start' || !values.target) {
	console.error('usage: node src/cli.ts start --target <url> [--port <n>] [--root <dir>]');
	process.exit(1);
}

const screenshots = createScreenshotter();
try {
	const server = await startServer({
		root: values.root,
		target: values.target,
		port: Number(values.port),
		capture: screenshots.capture,
	});
	console.log(`punchlist: listening on ${server.url}`);
	if (server.warning) console.log(`punchlist: warning: ${server.warning}`);
	const stop = async () => {
		await Promise.all([server.close(), screenshots.close()]);
		process.exit(0);
	};
	process.once('SIGINT', stop);
	// Playwright adds its own SIGTERM listener once Chromium launches, which stops Node's default exit.
	process.once('SIGTERM', stop);
} catch (e) {
	if (!(e instanceof LogError || e instanceof ManifestError)) throw e;
	console.error(`punchlist: ${e.message}`);
	process.exit(1);
}

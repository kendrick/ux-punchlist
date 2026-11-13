import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import type { Command } from '../core/events.ts';
import { CommandError, decide } from '../core/session.ts';
import { allowTrayConnect, injectTray, scriptNonce } from './inject.ts';
import type { Screenshotter } from './screenshot.ts';
import { openSession } from './session-store.ts';

// The tray ships with the plugin, so resolve it from here, never from the reviewed project's root.
const TRAY_DIR = join(import.meta.dirname, '..', 'tray');

const send = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

const MAX_COMMAND_BYTES = 1024 * 1024;

class TooLarge extends Error {}

// Listeners, not for-await: breaking out of for-await destroys the socket before a 413 can go out.
const readBody = (req: IncomingMessage, limit = Infinity) =>
	new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const onData = (chunk: Buffer) => {
			size += chunk.length;
			if (size <= limit) {
				chunks.push(Buffer.from(chunk));
				return;
			}
			req.off('data', onData).pause();
			reject(new TooLarge());
		};
		req.on('data', onData);
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});

const FIELDS: Record<string, string[]> = {
	select: ['itemId'],
	approve: ['itemId'],
	comment: ['itemId', 'selector', 'text', 'pageUrl'],
};

const isCommand = (v: unknown): v is Command => {
	if (typeof v !== 'object' || v === null || !('type' in v)) return false;
	const fields = FIELDS[String(v.type)];
	return !!fields && fields.every((f) => f in v && typeof Reflect.get(v, f) === 'string');
};

// The tray is the only expected client, but the body still crosses a trust boundary; `start` is server-only.
function parseCommand(text: string): Command {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new CommandError('body is not valid JSON');
	}
	if (!isCommand(raw)) {
		throw new CommandError('body is not a select, comment or approve command');
	}
	return raw;
}

function serveTray(name: string, res: ServerResponse) {
	if (!readdirSync(TRAY_DIR).includes(name)) return send(res, 404, { error: 'not found' });
	const js = stripTypeScriptTypes(readFileSync(join(TRAY_DIR, name), 'utf8'));
	res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
}

type ServerOptions = { root: string; target: string; port: number; capture: Screenshotter };

export async function startServer(opts: ServerOptions) {
	const store = openSession(opts.root, () => new Date().toISOString());
	try {
		return await serve(opts, store);
	} catch (e) {
		// No handle reaches the caller, so nothing else would release the lock this live process holds.
		store.close();
		throw e;
	}
}

async function serve(opts: ServerOptions, store: ReturnType<typeof openSession>) {
	const target = new URL(opts.target);
	const client = target.protocol === 'https:' ? https : http;
	// Assign onto target rather than resolve: a "//host/x" or absolute path would resolve to another origin.
	const onTarget = (pathname: string, search: string, hash = '') => {
		const url = new URL(target);
		url.pathname = pathname;
		url.search = search;
		url.hash = hash;
		return url;
	};
	// Commands run one at a time so a slow screenshot can't let two commands claim the same seq.
	let queue: Promise<unknown> = Promise.resolve();

	const handleCommand = async (req: IncomingMessage, res: ServerResponse) => {
		// Any other type is a "simple" cross-site POST with no preflight; JSON forces one, and with no CORS headers the browser blocks it.
		if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
			return send(res, 400, { error: 'content-type must be application/json' });
		let text: string;
		try {
			text = await readBody(req, MAX_COMMAND_BYTES);
		} catch (e) {
			// The client hung up mid-upload; rethrowing would be an unhandled rejection that kills the server.
			if (!(e instanceof TooLarge)) return void res.destroy();
			// Close the socket after replying so the rest of the upload is never read.
			res.setHeader('connection', 'close');
			return send(res, 413, { error: 'body is larger than 1 MiB' });
		}
		const job = queue.then(async () => {
			let command = parseCommand(text);
			if (command.type === 'comment') {
				const page = URL.parse(command.pageUrl);
				// Without this, any pageUrl would send headless Chromium to an arbitrary URL.
				if (!page || !allowedHosts.has(page.host))
					throw new CommandError('pageUrl must be a page on this review server');
				const seq = store.state().lastSeq + 1;
				const screenshot = `.review/screenshots/${seq}.png`;
				// Log and capture the app's own URL: the proxy port dies on restart, and the proxied page has the tray over it.
				const pageUrl = onTarget(page.pathname, page.search, page.hash).href;
				// The server picks the screenshot path, so a client can't aim the capture outside `.review/screenshots/`.
				command = { ...command, screenshot, pageUrl };
				decide(store.state(), command, ''); // reject a bad comment before paying for a capture
				mkdirSync(join(opts.root, '.review', 'screenshots'), { recursive: true });
				await opts.capture(command.pageUrl, command.selector, join(opts.root, screenshot));
			}
			return store.run(command);
		});
		queue = job.catch(() => {});
		try {
			send(res, 200, await job);
		} catch (e) {
			if (e instanceof CommandError) send(res, 400, { error: e.message });
			else send(res, 500, { error: e instanceof Error ? e.message : String(e) });
		}
	};

	const proxy = (req: IncomingMessage, res: ServerResponse) => {
		const raw = req.url ?? '/';
		const q = raw.indexOf('?');
		const url = q < 0 ? onTarget(raw, '') : onTarget(raw.slice(0, q), raw.slice(q));
		const upstream = client.request(
			url,
			{
				method: req.method,
				headers: { ...req.headers, host: target.host, 'accept-encoding': 'identity' },
			},
			(up) => {
				const headers = { ...up.headers };
				const location = headers.location && URL.parse(headers.location, url);
				// A redirect straight to the target would leave the proxy and lose the tray; Host was vetted by the allowlist.
				if (location && location.origin === target.origin)
					headers.location = `http://${req.headers.host}${location.pathname}${location.search}${location.hash}`;
				const type = headers['content-type'] ?? '';
				const encoding = headers['content-encoding'];
				if (!type.startsWith('text/html') || (encoding && encoding !== 'identity')) {
					res.writeHead(up.statusCode ?? 502, headers);
					// pipe() leaves res open when the target drops mid-body; pipeline destroys it so the browser's request fails.
					pipeline(up, res, () => {});
					return;
				}
				const { 'content-length': _len, ...rest } = headers;
				// The tray's fetches to /__punchlist/ must pass the target's connect-src; its report-only policy never blocks, so it stays as sent.
				if (rest['content-security-policy'] !== undefined)
					rest['content-security-policy'] = allowTrayConnect(
						rest['content-security-policy'],
						`http://${req.headers.host}`,
					);
				readBody(up).then(
					(html) =>
						res
							.writeHead(up.statusCode ?? 502, rest)
							.end(injectTray(html, scriptNonce(up.headers['content-security-policy']))),
					() => res.destroy(), // target dropped mid-response; don't let it reject unhandled
				);
			},
		);
		upstream.on('error', (e) => {
			if (!res.headersSent) send(res, 502, { error: `target: ${e.message}` });
			else res.destroy();
		});
		req.pipe(upstream);
	};

	// Filled after listen, since port 0 binds a random port.
	let allowedHosts = new Set<string>();

	const server = http.createServer((req, res) => {
		// A DNS-rebound page is same-origin with us, so the browser's CORS and preflight rules don't apply; only Host gives it away.
		if (!allowedHosts.has(req.headers.host?.toLowerCase() ?? ''))
			return send(res, 403, { error: 'Host must be this review server on loopback' });
		// Raw req.url on purpose: URL parsing would collapse "/__punchlist/../x" and slip past the name check.
		const path = (req.url ?? '/').split('?')[0] ?? '/';
		// CSP decodes %2F before path-matching, so the connect-src source added for the tray also admits these; never proxy them.
		if (/^\/__punchlist%2f/i.test(path)) return send(res, 404, { error: 'not found' });
		if (path.startsWith('/__punchlist/')) {
			const name = path.slice('/__punchlist/'.length);
			if (req.method === 'GET' && name === 'state') return send(res, 200, store.state());
			if (req.method === 'POST' && name === 'commands')
				return void handleCommand(req, res).catch(() => res.destroy()); // an unhandled rejection would end the whole session
			if (req.method === 'GET' && name.endsWith('.ts')) return serveTray(name, res);
			return send(res, 404, { error: 'not found' });
		}
		proxy(req, res);
	});

	await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : opts.port;
	allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
	return {
		url: `http://127.0.0.1:${port}`,
		warning: store.warning,
		close: () =>
			new Promise<void>((resolve, reject) => {
				// server.close() on a closed server errors with ERR_SERVER_NOT_RUNNING; tests close early and again in afterEach.
				if (!server.listening) return resolve();
				server.closeAllConnections();
				server.close(async (e) => {
					// Closed sockets don't cancel a command mid-capture; hold the lock until it lands, or a new server could take the root and reuse its seq.
					await queue;
					// Release even on error, or this process's live pid keeps the root locked.
					store.close();
					if (e) reject(e);
					else resolve();
				});
			}),
	};
}

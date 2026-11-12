import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import type { Command } from '../core/events.ts';
import { CommandError, decide } from '../core/session.ts';
import { injectTray } from './inject.ts';
import type { Screenshotter } from './screenshot.ts';
import { openSession } from './session-store.ts';

// The tray ships with the plugin, so resolve it from here, never from the reviewed project's root.
const TRAY_DIR = join(import.meta.dirname, '..', 'tray');

const send = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage) => {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString('utf8');
};

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

export async function startServer(opts: {
	root: string;
	target: string;
	port: number;
	capture: Screenshotter;
}) {
	const store = openSession(opts.root, () => new Date().toISOString());
	const target = new URL(opts.target);
	const client = target.protocol === 'https:' ? https : http;
	// Commands run one at a time so a slow screenshot can't let two commands claim the same seq.
	let queue: Promise<unknown> = Promise.resolve();

	const handleCommand = async (req: IncomingMessage, res: ServerResponse) => {
		const text = await readBody(req);
		const job = queue.then(async () => {
			let command = parseCommand(text);
			if (command.type === 'comment') {
				const seq = store.state().lastSeq + 1;
				const screenshot = `.review/screenshots/${seq}.png`;
				// Never trust the client's screenshot value.
				command = { ...command, screenshot };
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
		const upstream = client.request(
			new URL(req.url ?? '/', target),
			{
				method: req.method,
				headers: { ...req.headers, host: target.host, 'accept-encoding': 'identity' },
			},
			async (up) => {
				const type = up.headers['content-type'] ?? '';
				const encoding = up.headers['content-encoding'];
				if (!type.startsWith('text/html') || (encoding && encoding !== 'identity')) {
					res.writeHead(up.statusCode ?? 502, up.headers);
					up.pipe(res);
					return;
				}
				const { 'content-length': _len, ...headers } = up.headers;
				res.writeHead(up.statusCode ?? 502, headers).end(injectTray(await readBody(up)));
			},
		);
		upstream.on('error', (e) => {
			if (!res.headersSent) send(res, 502, { error: `target: ${e.message}` });
			else res.destroy();
		});
		req.pipe(upstream);
	};

	const server = http.createServer((req, res) => {
		// Raw req.url on purpose: URL parsing would collapse "/__punchlist/../x" and slip past the name check.
		const path = (req.url ?? '/').split('?')[0] ?? '/';
		if (path.startsWith('/__punchlist/')) {
			const name = path.slice('/__punchlist/'.length);
			if (req.method === 'GET' && name === 'state') return send(res, 200, store.state());
			if (req.method === 'POST' && name === 'commands') return void handleCommand(req, res);
			if (req.method === 'GET' && name.endsWith('.ts')) return serveTray(name, res);
			return send(res, 404, { error: 'not found' });
		}
		proxy(req, res);
	});

	await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : opts.port;
	return {
		url: `http://127.0.0.1:${port}`,
		warning: store.warning,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((e) => (e ? reject(e) : resolve()));
			}),
	};
}

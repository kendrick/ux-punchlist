// @vitest-environment node
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http, { type IncomingHttpHeaders } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ReviewEvent } from '../../src/core/events.ts';
import { LogError } from '../../src/core/log.ts';
import { startServer } from '../../src/server/server.ts';
import { openSession } from '../../src/server/session-store.ts';

const HTML = '<html><body><h1>App</h1></body></html>';
const CSS = 'body { color: red; }\n';
const NOW = () => '2026-01-01T00:00:00.000Z';

let root: string;
let target: http.Server;
let targetUrl: string;
let seen: IncomingHttpHeaders[];
let captured: string[];
let app: Awaited<ReturnType<typeof startServer>>;

const logPath = () => join(root, '.review', 'events.jsonl');
const readEvents = (): ReviewEvent[] =>
	readFileSync(logPath(), 'utf8')
		.trimEnd()
		.split('\n')
		.map((l) => JSON.parse(l));

// Raw http.request, since fetch would normalise "/../" before it reaches the server.
const rawGet = (path: string) =>
	new Promise<{ status: number; body: string }>((resolve, reject) => {
		http
			.get({ host: new URL(app.url).hostname, port: new URL(app.url).port, path }, (res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
			})
			.on('error', reject);
	});

// Raw http.request: fetch won't let a test set Host, and it adds its own content-type.
const rawPost = (body: string, headers: Record<string, string>) =>
	new Promise<number>((resolve, reject) => {
		const { hostname, port } = new URL(app.url);
		http
			.request(
				{ host: hostname, port, path: '/__punchlist/commands', method: 'POST', headers },
				(res) => {
					res.resume();
					res.on('end', () => resolve(res.statusCode ?? 0));
				},
			)
			.on('error', reject)
			.end(body);
	});

const rawRequest = (method: string, path: string, headers: Record<string, string>, body = '') =>
	new Promise<number>((resolve, reject) => {
		const { hostname, port } = new URL(app.url);
		http
			.request({ host: hostname, port, path, method, headers }, (res) => {
				res.resume();
				res.on('end', () => resolve(res.statusCode ?? 0));
			})
			.on('error', reject)
			.end(body);
	});

const post = (command: unknown) =>
	fetch(`${app.url}/__punchlist/commands`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(command),
	});

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), 'punchlist-server-'));
	mkdirSync(join(root, '.review'));
	copyFileSync(
		join(import.meta.dirname, '../../fixtures/manifest.yaml'),
		join(root, '.review', 'manifest.yaml'),
	);
	seen = [];
	captured = [];
	target = http.createServer((req, res) => {
		seen.push(req.headers);
		if (req.url === '/style.css') res.writeHead(200, { 'content-type': 'text/css' }).end(CSS);
		else if (req.url === '/torn.html') {
			res.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' });
			res.write('<html>', () => res.destroy());
		} else if (req.url === '/redirect' || req.url === '/redirect.html') {
			const type = req.url.endsWith('.html') ? { 'content-type': 'text/html' } : {};
			res.writeHead(302, { location: `${targetUrl}/login`, ...type }).end();
		} else if (req.url === '/nonce.html') {
			res
				.writeHead(200, {
					'content-type': 'text/html',
					'content-security-policy': "script-src 'nonce-xyz'",
				})
				.end(HTML);
		} else if (req.url === '/away')
			res.writeHead(302, { location: 'http://elsewhere.example/' }).end();
		else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML);
	});
	await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
	targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
	app = await startServer({
		root,
		target: targetUrl,
		port: 0,
		capture: async (url, _selector, outPath) => {
			captured.push(url);
			writeFileSync(outPath, 'PNG');
		},
	});
});

afterEach(async () => {
	await app.close();
	target.closeAllConnections();
	await new Promise((r) => target.close(r));
});

describe('server', () => {
	test('html from the target gets the tray script, and a css response is byte-identical', async () => {
		const html = await (await fetch(`${app.url}/`)).text();
		expect(html).toBe(
			'<html><body><h1>App</h1><script type="module" src="/__punchlist/tray.ts"></script></body></html>',
		);
		const css = await fetch(`${app.url}/style.css`);
		expect(css.headers.get('content-type')).toBe('text/css');
		expect(Buffer.from(await css.arrayBuffer()).equals(Buffer.from(CSS))).toBe(true);
	});

	test('the proxied request carries accept-encoding: identity', async () => {
		await fetch(`${app.url}/`, { headers: { 'accept-encoding': 'gzip, br' } });
		expect(seen.at(-1)?.['accept-encoding']).toBe('identity');
	});

	test('GET /__punchlist/tray.ts returns JavaScript with no type annotations', async () => {
		const res = await fetch(`${app.url}/__punchlist/tray.ts`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/javascript');
		const body = await res.text();
		expect(body).toContain('/__punchlist/');
		expect(body).not.toContain('import type');

		const traversal = await rawGet('/__punchlist/../core/session.ts');
		expect(traversal.status).toBe(404);
		expect(traversal.body).not.toContain('decide');
		expect(seen).toHaveLength(0);
	});

	test('POST a comment appends one comment-pinned event whose screenshot file exists', async () => {
		const before = readEvents().length;
		const res = await post({
			type: 'comment',
			itemId: 'home-hero',
			selector: 'h1',
			text: 'Too vague',
			screenshot: 'client-supplied.png',
			pageUrl: `${app.url}/pricing.html?tab=2#plans`,
		});
		expect(res.status).toBe(200);
		const events = readEvents();
		expect(events).toHaveLength(before + 1);
		const last = events.at(-1);
		expect(last).toMatchObject({
			type: 'comment-pinned',
			itemId: 'home-hero',
			selector: 'h1',
			text: 'Too vague',
			pageUrl: `${targetUrl}/pricing.html?tab=2#plans`,
			screenshot: `.review/screenshots/${last?.seq}.png`,
		});
		expect(captured).toEqual([`${targetUrl}/pricing.html?tab=2#plans`]);
		expect(
			readFileSync(join(root, last?.type === 'comment-pinned' ? last.screenshot : ''), 'utf8'),
		).toBe('PNG');
	});

	test('POST approve twice returns 400 the second time and leaves events.jsonl byte-identical', async () => {
		expect((await post({ type: 'approve', itemId: 'home-hero' })).status).toBe(200);
		const before = readFileSync(logPath());
		const second = await post({ type: 'approve', itemId: 'home-hero' });
		expect(second.status).toBe(400);
		expect((await second.json()).error).toMatch(/already approved/);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
	});

	test('POST with bad JSON or an unknown item returns 400 and appends nothing', async () => {
		const before = readFileSync(logPath());
		const bad = await fetch(`${app.url}/__punchlist/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{nope',
		});
		expect(bad.status).toBe(400);
		expect((await post({ type: 'select', itemId: 'ghost' })).status).toBe(400);
		expect(existsSync(join(root, '.review', 'screenshots'))).toBe(false);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
	});

	test('POST without a JSON content-type, or a comment for another host, returns 400 and appends nothing', async () => {
		const before = readFileSync(logPath());
		const approve = JSON.stringify({ type: 'approve', itemId: 'home-hero' });
		expect(await rawPost(approve, { 'content-type': 'text/plain' })).toBe(400);
		expect(await rawPost(approve, {})).toBe(400);
		for (const pageUrl of ['http://evil.example/', 'http://10.0.0.1/admin', 'not a url'])
			expect(
				(
					await post({
						type: 'comment',
						itemId: 'home-hero',
						selector: 'h1',
						text: 'x',
						screenshot: '',
						pageUrl,
					})
				).status,
			).toBe(400);
		expect(captured).toEqual([]);
		expect(existsSync(join(root, '.review', 'screenshots'))).toBe(false);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
	});

	test('a pageUrl whose path starts with // is captured and logged on the target origin', async () => {
		const res = await post({
			type: 'comment',
			itemId: 'home-hero',
			selector: 'h1',
			text: 'x',
			screenshot: '',
			pageUrl: `${app.url}//example.com/private`,
		});
		expect(res.status).toBe(200);
		expect(captured).toEqual([`${targetUrl}//example.com/private`]);
		expect(readEvents().at(-1)).toMatchObject({ pageUrl: `${targetUrl}//example.com/private` });
	});

	test('a request path naming another host is still proxied to the target', async () => {
		const attacker = http.createServer((_req, res) => res.end('<script>attacker</script>'));
		await new Promise<void>((r) => attacker.listen(0, '127.0.0.1', r));
		try {
			const host = `127.0.0.1:${(attacker.address() as AddressInfo).port}`;
			for (const path of [`//${host}/payload`, `http://${host}/payload`]) {
				const res = await rawGet(path);
				expect(res.body).not.toContain('attacker');
				expect(res.body).toContain('<h1>App</h1>');
			}
		} finally {
			attacker.closeAllConnections();
			await new Promise((r) => attacker.close(r));
		}
	});

	test('a redirect to the target origin lands back on the proxy with the tray; an external one is untouched', async () => {
		for (const path of ['/redirect', '/redirect.html']) {
			const res = await fetch(`${app.url}${path}`);
			expect(res.url).toBe(`${app.url}/login`);
			expect(await res.text()).toContain('/__punchlist/tray.ts');
		}
		const away = await fetch(`${app.url}/away`, { redirect: 'manual' });
		expect(away.headers.get('location')).toBe('http://elsewhere.example/');
	});

	test('a target CSP nonce is copied to the tray script and the policy is forwarded unchanged', async () => {
		const res = await fetch(`${app.url}/nonce.html`);
		expect(res.headers.get('content-security-policy')).toBe("script-src 'nonce-xyz'");
		expect(await res.text()).toContain(
			'<script type="module" nonce="xyz" src="/__punchlist/tray.ts">',
		);
	});

	test('a command upload or target response cut off mid-body leaves no unhandled rejection and the server up', async () => {
		const rejections: unknown[] = [];
		const onRejection = (e: unknown) => rejections.push(e);
		process.on('unhandledRejection', onRejection);
		try {
			const { hostname, port } = new URL(app.url);
			const sock = connect(Number(port), hostname);
			await once(sock, 'connect');
			sock.write(
				`POST /__punchlist/commands HTTP/1.1\r\nHost: ${hostname}:${port}\r\n` +
					'Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"type":',
			);
			await new Promise((r) => setTimeout(r, 50));
			sock.destroy();
			await expect(
				fetch(`${app.url}/torn.html`, { signal: AbortSignal.timeout(2000) }),
			).rejects.toThrow();
			await new Promise((r) => setTimeout(r, 50));
			expect(rejections).toEqual([]);
			expect((await fetch(`${app.url}/__punchlist/state`)).status).toBe(200);
		} finally {
			process.off('unhandledRejection', onRejection);
		}
	});

	test('a comment sent through localhost is accepted when Host matches', async () => {
		const port = new URL(app.url).port;
		const body = JSON.stringify({
			type: 'comment',
			itemId: 'home-hero',
			selector: 'h1',
			text: 'x',
			screenshot: '',
			pageUrl: `http://localhost:${port}/`,
		});
		const headers = {
			'content-type': 'application/json; charset=utf-8',
			host: `localhost:${port}`,
		};
		expect(await rawPost(body, headers)).toBe(200);
		expect(readEvents().at(-1)).toMatchObject({ type: 'comment-pinned', pageUrl: `${targetUrl}/` });
	});
});

describe('host allowlist and body cap', () => {
	const approve = JSON.stringify({ type: 'approve', itemId: 'home-hero' });
	const json = { 'content-type': 'application/json' };

	test('a request whose Host is not loopback on our port gets 403 on every route and appends nothing', async () => {
		const port = new URL(app.url).port;
		const before = readFileSync(logPath());
		const evil = { host: `evil.example:${port}` };
		expect(await rawRequest('GET', '/__punchlist/state', evil)).toBe(403);
		expect(await rawRequest('POST', '/__punchlist/commands', { ...evil, ...json }, approve)).toBe(
			403,
		);
		expect(await rawRequest('GET', '/pricing.html', evil)).toBe(403);
		// Right name, wrong port: a rebound page on another port still isn't us.
		expect(await rawRequest('GET', '/__punchlist/state', { host: 'localhost:1' })).toBe(403);
		expect(seen).toHaveLength(0);
		expect(readFileSync(logPath()).equals(before)).toBe(true);

		for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
			expect(await rawRequest('GET', '/__punchlist/state', { host })).toBe(200);
		expect(await rawRequest('GET', '/pricing.html', { host: `localhost:${port}` })).toBe(200);
	});

	test('a comment whose pageUrl names the attacker host is refused even when Host matches it', async () => {
		const port = new URL(app.url).port;
		const before = readFileSync(logPath());
		const body = JSON.stringify({
			type: 'comment',
			itemId: 'home-hero',
			selector: 'h1',
			text: 'forged',
			screenshot: '',
			pageUrl: `http://evil.example:${port}/`,
		});
		expect(await rawPost(body, { ...json, host: `evil.example:${port}` })).toBe(403);
		expect(await rawPost(body, { ...json, host: `127.0.0.1:${port}` })).toBe(400);
		expect(captured).toEqual([]);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
	});

	test('a command body over 1 MiB gets 413 and appends nothing', async () => {
		const before = readFileSync(logPath());
		const huge = JSON.stringify({
			type: 'approve',
			itemId: 'home-hero',
			pad: 'x'.repeat(1024 * 1024),
		});
		const res = await post(JSON.parse(huge));
		expect(res.status).toBe(413);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
		// Just under the cap still goes through.
		expect(
			(await post({ type: 'approve', itemId: 'home-hero', pad: 'x'.repeat(1000) })).status,
		).toBe(200);
	});
});

describe('cli', () => {
	test(
		'SIGTERM after a screenshot capture stops the CLI with exit 0',
		{ timeout: 60_000 },
		async () => {
			const cliRoot = mkdtempSync(join(tmpdir(), 'punchlist-cli-'));
			mkdirSync(join(cliRoot, '.review'));
			copyFileSync(
				join(import.meta.dirname, '../../fixtures/manifest.yaml'),
				join(cliRoot, '.review', 'manifest.yaml'),
			);
			const cli = spawn(process.execPath, [
				join(import.meta.dirname, '../../src/cli.ts'),
				'start',
				'--target',
				targetUrl,
				'--root',
				cliRoot,
			]);
			try {
				let out = '';
				const url = await new Promise<string>((resolve, reject) => {
					cli.stdout.on('data', (c) => {
						out += c;
						const m = /listening on (\S+)/.exec(out);
						if (m?.[1]) resolve(m[1]);
					});
					cli.on('exit', () => reject(new Error(`cli exited early: ${out}`)));
				});
				// A comment launches Chromium, and that's what used to swallow SIGTERM.
				const res = await fetch(`${url}/__punchlist/commands`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						type: 'comment',
						itemId: 'home-hero',
						selector: 'h1',
						text: 'x',
						screenshot: '',
						pageUrl: `${url}/`,
					}),
				});
				expect(res.status).toBe(200);
				const exited = once(cli, 'exit');
				cli.kill('SIGTERM');
				const timeout = new Promise((r) => setTimeout(() => r('timeout'), 5000));
				expect(await Promise.race([exited, timeout])).toEqual([0, null]);
			} finally {
				cli.kill('SIGKILL');
			}
		},
	);
});

describe('openSession', () => {
	test("openSession on an existing log with an edited manifest keeps the log's items and sets warning", async () => {
		expect(app.warning).toBeNull();
		expect(readEvents()[0]).toMatchObject({ type: 'session-started' });
		writeFileSync(
			join(root, '.review', 'manifest.yaml'),
			'items:\n  - id: brand-new\n    title: New\n    url: /new\n',
		);
		const session = openSession(root, NOW);
		expect(session.state().items.map((i) => i.id)).toEqual(['home-hero', 'pricing-table']);
		expect(session.warning).toBe(
			"manifest.yaml differs from the running session; keeping the session's items",
		);
	});

	test('openSession on a log with a torn last line throws LogError', () => {
		appendFileSync(logPath(), '{"seq":2,"at":"x","type":"item-sel');
		expect(() => openSession(root, NOW)).toThrow(LogError);
	});
});

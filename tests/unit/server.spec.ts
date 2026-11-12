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
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
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
	target = http.createServer((req, res) => {
		seen.push(req.headers);
		if (req.url === '/style.css') res.writeHead(200, { 'content-type': 'text/css' }).end(CSS);
		else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML);
	});
	await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
	targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
	app = await startServer({
		root,
		target: targetUrl,
		port: 0,
		capture: async (_url, _selector, outPath) => writeFileSync(outPath, 'PNG'),
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
			pageUrl: `${app.url}/`,
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
			pageUrl: `${app.url}/`,
			screenshot: `.review/screenshots/${last?.seq}.png`,
		});
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
		const bad = await fetch(`${app.url}/__punchlist/commands`, { method: 'POST', body: '{nope' });
		expect(bad.status).toBe(400);
		expect((await post({ type: 'select', itemId: 'ghost' })).status).toBe(400);
		expect(existsSync(join(root, '.review', 'screenshots'))).toBe(false);
		expect(readFileSync(logPath()).equals(before)).toBe(true);
	});
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

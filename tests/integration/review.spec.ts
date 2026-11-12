import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parseManifest } from '../../src/core/manifest.ts';
import { serveStatic } from '../../fixtures/serve.ts';
import {
	appDir,
	makeRoot,
	manifestPath,
	readEvents,
	readLogBytes,
	startPunchlist,
} from './helpers.ts';

const total = parseManifest(readFileSync(manifestPath, 'utf8')).length;

// Every test gets its own root and servers on port 0: fullyParallel runs the five projects at once.
let cleanup: (() => void | Promise<void>)[] = [];
test.afterEach(async () => {
	for (const fn of cleanup.toReversed()) await fn();
	cleanup = [];
});

async function setup(manifest?: string) {
	const root = makeRoot(manifest);
	const app = await serveStatic(appDir, 0);
	cleanup.push(() => app.close());
	const start = async () => {
		const p = await startPunchlist(root, app.url);
		cleanup.push(() => p.kill());
		return p;
	};
	return { root, app, start, punchlist: await start() };
}

test('shows Item 1 of N', async ({ page }) => {
	const { punchlist } = await setup();
	await page.goto(punchlist.url + '/');
	const tray = page.getByRole('region', { name: 'Review tray' });
	await expect(tray.getByText(`Item 1 of ${total}`)).toBeVisible();
	await expect(tray.getByText('Home page hero')).toBeVisible();
	expect(total).toBe(2);
});

test('pinning a comment appends one event with item, selector, text, screenshot and page URL', async ({
	page,
}) => {
	const { root, app, punchlist } = await setup();
	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of')).toBeVisible();
	const before = readEvents(root).length;

	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('.feature').nth(1).click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Too vague');
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();

	const added = readEvents(root).slice(before);
	expect(added).toHaveLength(1);
	const ev = added[0];
	if (ev.type !== 'comment-pinned') throw new Error(`unexpected event ${ev.type}`);
	expect(ev.itemId).toBe('home-hero');
	expect(ev.text).toBe('Too vague');
	expect(ev.pageUrl).toBe(app.url + '/');
	// Same element, not just any .feature: the two siblings are identical, so compare by index.
	const index = await page
		.locator('.feature')
		.evaluateAll((els, sel) => els.indexOf(document.querySelector(sel)!), ev.selector);
	expect(index).toBe(1);
	await expect(page.locator(ev.selector)).toHaveCount(1);
	expect(readFileSync(join(root, ev.screenshot)).subarray(0, 4)).toEqual(
		Buffer.from([0x89, 0x50, 0x4e, 0x47]),
	);
});

test('approving appends one approval event and the tray shows Approved', async ({ page }) => {
	const { root, punchlist } = await setup();
	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of')).toBeVisible();
	const before = readEvents(root).length;
	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByText('Approved', { exact: true })).toBeVisible();
	const added = readEvents(root).slice(before);
	expect(added).toHaveLength(1);
	expect(added[0]).toMatchObject({ type: 'item-approved', itemId: 'home-hero' });
});

test('killing and restarting the plugin restores position, comments and approvals', async ({
	page,
}) => {
	const { root, start, punchlist } = await setup();
	const snapshots: string[] = [];
	const snap = () => snapshots.push(readLogBytes(root));

	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of')).toBeVisible();
	snap();
	await page.getByRole('button', { name: 'Next' }).click();
	await page.waitForURL('**/pricing.html');
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	snap();
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('table').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Prices unclear');
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();
	snap();
	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByText('Approved', { exact: true })).toBeVisible();
	snap();

	punchlist.kill();
	const restarted = await start();
	await page.goto(restarted.url + '/');
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Go to item' }).click();
	await page.waitForURL('**/pricing.html');
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Go to item' })).toHaveCount(0);
	await expect(page.getByText('Approved', { exact: true })).toBeVisible();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();
	snap();

	for (let i = 1; i < snapshots.length; i++)
		expect(snapshots[i].startsWith(snapshots[i - 1])).toBe(true);
	expect(snapshots.at(-1).length).toBeGreaterThan(snapshots[0].length);
});

test('a rejected comment keeps the typed text', async ({ page }) => {
	const { punchlist } = await setup();
	await page.route('**/__punchlist/commands', (route) =>
		route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
	);
	await page.goto(punchlist.url + '/');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('h1').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Keep me');
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('boom')).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Keep me');
});

test('the tray has no axe violations', async ({ page }) => {
	const { punchlist } = await setup();
	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of')).toBeVisible();
	const { violations } = await new AxeBuilder({ page }).include('punchlist-tray').analyze();
	expect(violations).toEqual([]);
});

test('items whose URLs carry a fragment can be reached and commented on', async ({ page }) => {
	const { root, app, punchlist } = await setup(
		'items:\n  - id: plans\n    title: Plans\n    url: /pricing.html#plans\n' +
			'  - id: faq\n    title: FAQ\n    url: /pricing.html#faq\n',
	);
	const comment = page.getByRole('button', { name: 'Comment', exact: true });
	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of 2')).toBeVisible();
	await page.getByRole('button', { name: 'Go to item' }).click();
	await page.waitForURL('**/pricing.html#plans');
	await expect(comment).toBeEnabled();

	// Same document, new fragment: no reload, so only hashchange can re-enable Comment.
	await page.getByRole('button', { name: 'Next' }).click();
	await page.waitForURL('**/pricing.html#faq');
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	await expect(comment).toBeEnabled();
	await comment.click();
	await page.locator('table').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('FAQ');
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();
	expect(readEvents(root).at(-1)).toMatchObject({
		type: 'comment-pinned',
		itemId: 'faq',
		pageUrl: app.url + '/pricing.html#faq',
	});
});

test('an unfinished comment is not carried to the next item that shares its URL', async ({
	page,
}) => {
	const { root, punchlist } = await setup(
		'items:\n  - id: one\n    title: One\n    url: /\n  - id: two\n    title: Two\n    url: /\n',
	);
	await page.goto(punchlist.url + '/');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('h1').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('For one');
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Pin comment' })).toHaveCount(0);
	expect(readEvents(root).filter((e) => e.type === 'comment-pinned')).toEqual([]);
});

test('a double-clicked Pin comment pins once and stays disabled in flight', async ({ page }) => {
	const { root, punchlist } = await setup();
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/__punchlist/commands', async (route) => {
		if (route.request().postDataJSON().type === 'comment') await held;
		await route.continue();
	});
	await page.goto(punchlist.url + '/');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('h1').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Once');
	const pin = page.getByRole('button', { name: 'Pin comment' });
	await pin.dblclick();
	await expect(pin).toBeDisabled();
	release();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();
	expect(readEvents(root).filter((e) => e.type === 'comment-pinned')).toHaveLength(1);
});

test('the tray shows and works on a target whose CSP allows scripts only by nonce', async ({
	page,
}) => {
	const root = makeRoot();
	const html = readFileSync(join(appDir, 'index.html'), 'utf8');
	const target = createServer((_req, res) =>
		res
			.writeHead(200, {
				'content-type': 'text/html',
				'content-security-policy': "script-src 'nonce-n0nce'",
			})
			.end(html),
	);
	await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
	cleanup.push(() => {
		target.closeAllConnections();
		target.close();
	});
	const p = await startPunchlist(
		root,
		`http://127.0.0.1:${(target.address() as AddressInfo).port}`,
	);
	cleanup.push(() => p.kill());
	await page.goto(p.url + '/');
	await expect(
		page.getByRole('region', { name: 'Review tray' }).getByText(`Item 1 of ${total}`),
	).toBeVisible();
});

async function startWithTarget(html: string, headers: Record<string, string> = {}) {
	const target = createServer((_req, res) =>
		res.writeHead(200, { 'content-type': 'text/html', ...headers }).end(html),
	);
	await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
	cleanup.push(() => {
		target.closeAllConnections();
		target.close();
	});
	const root = makeRoot();
	const p = await startPunchlist(
		root,
		`http://127.0.0.1:${(target.address() as AddressInfo).port}`,
	);
	cleanup.push(() => p.kill());
	return { ...p, root };
}

test('the tray is styled on a target whose CSP allows styles only from self', async ({ page }) => {
	const html = readFileSync(join(appDir, 'index.html'), 'utf8');
	const p = await startWithTarget(html, {
		'content-security-policy': "script-src 'nonce-n0nce'; style-src 'self'",
	});
	await page.goto(p.url + '/');
	const tray = page.getByRole('region', { name: 'Review tray' });
	await expect(tray.getByText(`Item 1 of ${total}`)).toBeVisible();
	await expect(tray).toHaveCSS('position', 'fixed');
});

test('Comment mode picks an inline SVG inside a link instead of following the link', async ({
	page,
}) => {
	const p = await startWithTarget(
		'<!doctype html><title>t</title><a href="/elsewhere"><svg width="60" height="60"><path d="M0 0h60v60H0z"/></svg></a>',
	);
	await page.goto(p.url + '/');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('svg path').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Icon');
	expect(new URL(page.url()).pathname).toBe('/');
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();

	const ev = readEvents(p.root).at(-1);
	if (ev?.type !== 'comment-pinned') throw new Error(`unexpected event ${ev?.type}`);
	expect(await page.locator(ev.selector).evaluate((el) => el.localName)).toBe('svg');
	expect(statSync(join(p.root, ev.screenshot)).size).toBeGreaterThan(0);
});

test('a pending pick is suspended, not pinned, while the browser is off the item URL', async ({
	page,
}) => {
	const { punchlist } = await setup(
		'items:\n  - id: plans\n    title: Plans\n    url: /pricing.html#plans\n',
	);
	await page.goto(punchlist.url + '/pricing.html#plans');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('table').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Plans');
	const pin = page.getByRole('button', { name: 'Pin comment' });
	await expect(pin).toBeEnabled();

	await page.evaluate(() => (location.hash = '#two'));
	await expect(pin).toBeDisabled();

	await page.evaluate(() => (location.hash = '#plans'));
	await expect(pin).toBeEnabled();
	await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Plans');
});

const onePlan = 'items:\n  - id: plans\n    title: Plans\n    url: /pricing.html#plans\n';

async function pickTable(page: Page, url: string) {
	await page.goto(url + '/pricing.html#plans');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.locator('table').click();
	await page.getByRole('textbox', { name: 'Comment' }).fill('Plans');
}

test('Pin comment refuses with a message after a pushState route change', async ({ page }) => {
	const { root, punchlist } = await setup(onePlan);
	await pickTable(page, punchlist.url);
	await page.evaluate(() => history.pushState(null, '', '/pricing.html#elsewhere'));
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText("Go back to the item's page")).toBeVisible();
	expect(readEvents(root).filter((e) => e.type === 'comment-pinned')).toEqual([]);
});

test('Comment mode turns off when the browser leaves the item URL', async ({ page }) => {
	const { punchlist } = await setup(onePlan);
	await page.goto(punchlist.url + '/pricing.html#plans');
	const comment = page.getByRole('button', { name: 'Comment', exact: true });
	await comment.click();
	await expect(comment).toHaveAttribute('aria-pressed', 'true');
	await page.evaluate(() => (location.hash = '#two'));
	await expect(comment).toHaveAttribute('aria-pressed', 'false');
});

test('Pin comment refuses a pick that was removed from the page', async ({ page }) => {
	const { root, punchlist } = await setup(onePlan);
	await pickTable(page, punchlist.url);
	await page.evaluate(() => document.querySelector('table')?.remove());
	await page.getByRole('button', { name: 'Pin comment' }).click();
	await expect(page.getByText('That element is gone')).toBeVisible();
	expect(readEvents(root).filter((e) => e.type === 'comment-pinned')).toEqual([]);
});

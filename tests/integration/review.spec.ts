import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

async function setup() {
	const root = makeRoot();
	const app = await serveStatic(appDir, 0);
	cleanup.push(() => app.close());
	const start = async () => {
		const p = await startPunchlist(root, app.url);
		cleanup.push(() => p.kill());
		return p;
	};
	return { root, start, punchlist: await start() };
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
	const { root, punchlist } = await setup();
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
	expect(ev.pageUrl).toBe(page.url());
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
	await page.goto(restarted.url + '/pricing.html');
	await expect(page.getByText('Item 2 of 2')).toBeVisible();
	await expect(page.getByText('Approved', { exact: true })).toBeVisible();
	await expect(page.getByText('1 comment', { exact: true })).toBeVisible();
	snap();

	for (let i = 1; i < snapshots.length; i++)
		expect(snapshots[i].startsWith(snapshots[i - 1])).toBe(true);
	expect(snapshots.at(-1).length).toBeGreaterThan(snapshots[0].length);
});

test('the tray has no axe violations', async ({ page }) => {
	const { punchlist } = await setup();
	await page.goto(punchlist.url + '/');
	await expect(page.getByText('Item 1 of')).toBeVisible();
	const { violations } = await new AxeBuilder({ page }).include('punchlist-tray').analyze();
	expect(violations).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { serveStatic } from '../../fixtures/serve.ts';
import { startServer } from '../../src/server/server.ts';
import { makeRoot } from './helpers.ts';

// Proof for #15: the spike tray in spikes/tray-stack, served through the real proxy and injectTray, on a hostile reviewed page.
const spike = join(import.meta.dirname, '..', '..', 'spikes', 'tray-stack');

let cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const fn of cleanup.toReversed()) await fn();
	cleanup = [];
});

async function setup() {
	const fixture = await serveStatic(join(spike, 'fixture'), 0);
	cleanup.push(() => fixture.close());
	const server = await startServer({
		root: makeRoot(),
		target: fixture.url,
		port: 0,
		capture: async () => {},
		trayDir: spike,
	});
	cleanup.push(() => server.close());
	return server.url;
}

const trayRoot = (page: Page) => page.locator('punchlist-tray [data-pl-root]');
const bar = (page: Page) => page.locator('punchlist-tray #pl-bar');
const popover = (page: Page) => page.locator('punchlist-tray #pl-popover');
const button = (page: Page) => page.locator('punchlist-tray').getByRole('button', { name: 'Open' });
const rootFontSize = (page: Page) =>
	page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

async function rewritePage(page: Page, url: string, edit: (html: string) => string) {
	await page.route(url + '/', async (route) => {
		const res = await route.fetch();
		await route.fulfill({ response: res, body: edit(await res.text()) });
	});
}

async function trayColors(page: Page) {
	await expect(button(page)).toBeVisible();
	return {
		...(await button(page).evaluate((el) => {
			const s = getComputedStyle(el);
			return { background: s.backgroundColor, color: s.color };
		})),
		primary: await trayRoot(page).evaluate((el) =>
			getComputedStyle(el).getPropertyValue('--primary'),
		),
	};
}

async function trayShot(page: Page, url: string, fontSize: string) {
	await page.goto(url + '/');
	await expect(button(page)).toBeVisible();
	expect(await rootFontSize(page)).toBe(fontSize);
	return bar(page).screenshot();
}

test("tray sizes ignore the reviewed page's root font size", async ({ page }) => {
	const url = await setup();
	const small = await trayShot(page, url, '10px');
	// Two loads, not a style tag added after load: WebKit doesn't restyle a shadow tree when the root font size changes later, so rem would slip past.
	await rewritePage(page, url, (html) => html.replace('font-size: 62.5%', 'font-size: 100%'));
	const full = await trayShot(page, url, '16px');
	expect(full.equals(small)).toBe(true);
});

test("the reviewed page's tokens and rules don't reach the tray's colors", async ({ page }) => {
	const url = await setup();
	await page.goto(url + '/');
	const hostile = await trayColors(page);

	// Same page with the fixture's hostile <style> removed: the baseline the tray should match.
	await rewritePage(page, url, (html) => html.replace(/<style>[\s\S]*?<\/style>/, ''));
	await page.goto(url + '/');
	expect(await rootFontSize(page)).toBe('16px');
	const clean = await trayColors(page);

	expect(hostile).toEqual(clean);
	// Equal-but-both-red would also pass the line above; the page's red must not be what the tray shows.
	expect(hostile.background).not.toBe('rgb(255, 0, 0)');
	expect(hostile.primary).not.toBe('red');
});

test("the page's own --primary is unchanged by the tray", async ({ page }) => {
	const url = await setup();
	const readPrimary = () =>
		page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));

	await page.route('**/__punchlist/tray.ts', (route) => route.abort());
	await page.goto(url + '/');
	const before = await readPrimary();
	expect(await page.locator('punchlist-tray').count()).toBe(0);

	await page.unroute('**/__punchlist/tray.ts');
	await page.goto(url + '/');
	await expect(button(page)).toBeVisible();
	expect(await readPrimary()).toBe(before);
	expect(before).toBe('red');
});

// Box-shadow layers that would paint: a non-zero length and a colour the canvas rasterizes with alpha > 0.
// `not none` alone passes on five transparent 0px layers, which is what an unlayered reset leaves behind.
function paintedShadows(el: Element) {
	const value = getComputedStyle(el).boxShadow;
	if (value === 'none') return [];
	const layers: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '(') depth++;
		else if (value[i] === ')') depth--;
		else if (value[i] === ',' && depth === 0) {
			layers.push(value.slice(start, i).trim());
			start = i + 1;
		}
	}
	layers.push(value.slice(start).trim());
	const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
	return layers.filter((layer) => {
		const color = /^[a-z-]+\([^)]*\)|^[a-z]+|^#\w+/i.exec(layer)?.[0] ?? '';
		const lengths = layer.slice(color.length).match(/-?[\d.]+px/g) ?? [];
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = 'transparent';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		return ctx.getImageData(0, 0, 1, 1).data[3] > 0 && lengths.some((l) => parseFloat(l) !== 0);
	});
}

test('focus ring renders in the shadow root', async ({ page }) => {
	await page.goto((await setup()) + '/');
	await expect(button(page)).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(button(page)).toBeFocused();
	// Basecoat's .btn transitions `all`, so the first read after Tab can land at the start of the box-shadow fade.
	await expect.poll(() => button(page).evaluate(paintedShadows)).toHaveLength(1);
});

test('shadow, ring and transform utilities apply in the shadow root', async ({ page }) => {
	await page.goto((await setup()) + '/');
	await button(page).click();
	await expect(popover(page)).toBeVisible();
	// shadow-md is two layers, ring-1 one.
	// Polled for the same reason as the focus ring: the popover's box-shadow can still be mid-transition.
	await expect.poll(() => popover(page).evaluate(paintedShadows)).toHaveLength(3);

	// The tray uses no transform utility yet, so borrow Basecoat's dialog panel, which sets --tw-translate-* and --tw-scale-*.
	const transform = await trayRoot(page).evaluate((root) => {
		const dialog = document.createElement('div');
		dialog.className = 'dialog';
		const panel = dialog.appendChild(document.createElement('div'));
		root.append(dialog);
		const s = getComputedStyle(panel);
		return { translate: s.translate, scale: s.scale };
	});
	expect(transform).toEqual({ translate: '-50% -50%', scale: '0.95' });
});

test("popover opens and isn't clipped by the tray bar", async ({ page }) => {
	await page.goto((await setup()) + '/');
	await button(page).click();
	await expect(popover(page)).toBeVisible();
	expect(await popover(page).evaluate((el) => el.matches(':popover-open'))).toBe(true);

	const box = (await popover(page).boundingBox())!;
	const barBox = (await bar(page).boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	// The popover reaches above the bar, whose overflow is hidden; only the top layer lets that part show.
	expect(box.y).toBeLessThan(barBox.y);

	const hit = await page.evaluate(
		({ x, y }) => {
			const root = document.querySelector('punchlist-tray')!.shadowRoot!;
			const el = root.elementFromPoint(x, y);
			return !!el?.closest('#pl-popover');
		},
		{ x: box.x + box.width / 2, y: box.y + box.height / 2 },
	);
	expect(hit).toBe(true);
});

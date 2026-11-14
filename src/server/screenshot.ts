import { chromium, type Browser } from 'playwright';

export type Screenshotter = (pageUrl: string, selector: string, outPath: string) => Promise<void>;

export function createScreenshotter(): {
	capture: Screenshotter;
	warm(): void;
	close(): Promise<void>;
} {
	let browser: Promise<Browser> | null = null;
	return {
		// shortcut: re-loads pageUrl, so client-side state at pick time isn't captured; upgrade to an in-page capture when a reviewer needs form or modal state.
		async capture(pageUrl, selector, outPath) {
			browser ??= chromium.launch();
			const page = await (await browser).newPage();
			try {
				await page.goto(pageUrl);
				await page.locator(selector).first().screenshot({ path: outPath });
			} finally {
				await page.close();
			}
		},
		// A failed launch stays on the shared promise for capture() to rethrow; the no-op catch only stops it being an unhandled rejection.
		warm() {
			(browser ??= chromium.launch()).catch(() => {});
		},
		async close() {
			// A launch that failed left no browser to close; only a failure of close() itself should surface.
			const launched = await browser?.catch(() => null);
			await launched?.close();
		},
	};
}

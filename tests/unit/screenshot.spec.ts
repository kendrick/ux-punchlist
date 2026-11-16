// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const goto = vi.fn(async () => undefined);
	const screenshot = vi.fn(async () => undefined);
	const pageClose = vi.fn(async () => undefined);
	const browserClose = vi.fn(async () => undefined);
	const browser = {
		newPage: async () => ({
			goto,
			locator: () => ({ first: () => ({ screenshot }) }),
			close: pageClose,
		}),
		close: browserClose,
	};
	return { goto, browser, browserClose, launch: vi.fn() };
});

vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));

const { createScreenshotter } = await import('../../src/server/screenshot.ts');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.launch.mockResolvedValue(mocks.browser);
});

describe('createScreenshotter', () => {
	test('warm launches Chromium once and capture reuses it', async () => {
		const s = createScreenshotter();
		s.warm();
		await s.capture('http://x/', 'h1', '/tmp/a.png');
		expect(mocks.launch).toHaveBeenCalledTimes(1);
		expect(mocks.goto).toHaveBeenCalledWith('http://x/');
	});

	test('a capture during warm-up reuses the in-flight launch', async () => {
		let resolveLaunch!: () => void;
		mocks.launch.mockReturnValue(
			new Promise((resolve) => {
				resolveLaunch = () => resolve(mocks.browser);
			}),
		);
		const s = createScreenshotter();
		s.warm();
		const pending = s.capture('http://x/', 'h1', '/tmp/a.png');
		resolveLaunch();
		await pending;
		expect(mocks.launch).toHaveBeenCalledTimes(1);
	});

	test('a failed warm-up surfaces at capture, not as an unhandled rejection', async () => {
		mocks.launch.mockRejectedValue(new Error('no chromium'));
		const spy = vi.fn();
		process.on('unhandledRejection', spy);
		try {
			const s = createScreenshotter();
			s.warm();
			await new Promise((r) => setTimeout(r, 0));
			expect(spy).not.toHaveBeenCalled();
			await expect(s.capture('http://x/', 'h1', '/tmp/a.png')).rejects.toThrow('no chromium');
		} finally {
			process.off('unhandledRejection', spy);
		}
	});

	test('close after warm closes the browser', async () => {
		const s = createScreenshotter();
		s.warm();
		await s.close();
		expect(mocks.browserClose).toHaveBeenCalledTimes(1);
	});

	test('close after a failed warm-up resolves', async () => {
		mocks.launch.mockRejectedValue(new Error('no chromium'));
		const s = createScreenshotter();
		s.warm();
		await expect(s.close()).resolves.toBeUndefined();
	});

	test('close without warm or capture launches nothing', async () => {
		await createScreenshotter().close();
		expect(mocks.launch).not.toHaveBeenCalled();
	});
});

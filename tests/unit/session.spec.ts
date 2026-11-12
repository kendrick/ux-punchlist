import { describe, expect, test } from 'vitest';
import type { Command, Item, ReviewEvent } from '../../src/core/events.ts';
import { CommandError, decide, initialState, reduce } from '../../src/core/session.ts';

const items: Item[] = [
	{ id: 'a', title: 'A', url: '/' },
	{ id: 'b', title: 'B', url: '/b.html' },
];
const NOW = '2026-01-01T00:00:00.000Z';
const comment: Command = {
	type: 'comment',
	itemId: 'b',
	selector: '[id="x"]',
	text: 'too small',
	screenshot: '.review/screenshots/3.png',
	pageUrl: 'http://localhost/b.html',
};

// Applies commands one at a time, the way the server does.
function run(...commands: Command[]): ReviewEvent[] {
	const events: ReviewEvent[] = [];
	for (const c of commands) events.push(...decide(reduce(events), c, NOW));
	return events;
}

describe('session', () => {
	test('start then reduce yields the items and position 0', () => {
		const state = reduce(run({ type: 'start', items }));
		expect(state).toMatchObject({ started: true, items, position: 0, lastSeq: 1 });
	});

	test("select moves position to that item's index", () => {
		const state = reduce(run({ type: 'start', items }, { type: 'select', itemId: 'b' }));
		expect(state.position).toBe(1);
	});

	test('comment appends one comment-pinned event holding itemId, selector, text, screenshot and pageUrl', () => {
		const started = run({ type: 'start', items });
		const added = decide(reduce(started), comment, NOW);
		expect(added).toEqual([
			{
				seq: 2,
				at: NOW,
				type: 'comment-pinned',
				itemId: 'b',
				selector: '[id="x"]',
				text: 'too small',
				screenshot: '.review/screenshots/3.png',
				pageUrl: 'http://localhost/b.html',
			},
		]);
		expect(reduce([...started, ...added]).comments).toEqual([
			{
				seq: 2,
				itemId: 'b',
				selector: '[id="x"]',
				text: 'too small',
				screenshot: '.review/screenshots/3.png',
				pageUrl: 'http://localhost/b.html',
			},
		]);
	});

	test('approve appends one item-approved event and reduce lists the item in approved', () => {
		const started = run({ type: 'start', items });
		const added = decide(reduce(started), { type: 'approve', itemId: 'a' }, NOW);
		expect(added).toEqual([{ seq: 2, at: NOW, type: 'item-approved', itemId: 'a' }]);
		expect(reduce([...started, ...added]).approved).toEqual(['a']);
	});

	test('approve twice throws CommandError', () => {
		const events = run({ type: 'start', items }, { type: 'approve', itemId: 'a' });
		expect(() => decide(reduce(events), { type: 'approve', itemId: 'a' }, NOW)).toThrow(
			CommandError,
		);
	});

	test('commands for an unknown itemId throw CommandError', () => {
		const state = reduce(run({ type: 'start', items }));
		for (const c of [
			{ type: 'select', itemId: 'zzz' },
			{ ...comment, itemId: 'zzz' },
			{ type: 'approve', itemId: 'zzz' },
		] as Command[]) {
			expect(() => decide(state, c, NOW)).toThrow(CommandError);
		}
	});

	test('commands before start throw CommandError', () => {
		for (const c of [
			{ type: 'select', itemId: 'a' },
			comment,
			{ type: 'approve', itemId: 'a' },
		] as Command[]) {
			expect(() => decide(initialState, c, NOW)).toThrow(CommandError);
		}
	});

	test('start twice or with no items throws CommandError', () => {
		expect(() => decide(initialState, { type: 'start', items: [] }, NOW)).toThrow(CommandError);
		const state = reduce(run({ type: 'start', items }));
		expect(() => decide(state, { type: 'start', items }, NOW)).toThrow(CommandError);
	});

	test('a comment whose text is blank after trimming throws CommandError', () => {
		const state = reduce(run({ type: 'start', items }));
		expect(() => decide(state, { ...comment, text: '  \n\t ' }, NOW)).toThrow(CommandError);
	});

	test('seq counts up from lastSeq and every at equals now', () => {
		const events = run({ type: 'start', items }, { type: 'select', itemId: 'b' }, comment, {
			type: 'approve',
			itemId: 'b',
		});
		expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		expect(events.every((e) => e.at === NOW)).toBe(true);
	});

	test('reduce is deterministic: reduce(JSON.parse(JSON.stringify(events))) deep-equals reduce(events)', () => {
		const events = run({ type: 'start', items }, { type: 'select', itemId: 'b' }, comment, {
			type: 'approve',
			itemId: 'b',
		});
		expect(reduce(JSON.parse(JSON.stringify(events)))).toEqual(reduce(events));
	});

	test('dropping the last event changes the state', () => {
		const events = run({ type: 'start', items }, { type: 'approve', itemId: 'a' });
		expect(reduce(events).approved).toContain('a');
		expect(reduce(events.slice(0, -1)).approved).not.toContain('a');
	});
});

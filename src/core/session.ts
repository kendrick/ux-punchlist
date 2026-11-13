import type { Command, ReviewEvent, SessionState } from './events.ts';

export class CommandError extends Error {}

export const initialState: SessionState = {
	started: false,
	items: [],
	position: 0,
	comments: [],
	approved: [],
	lastSeq: 0,
};

export function decide(state: SessionState, command: Command, now: string): ReviewEvent[] {
	const at = now;
	const seq = state.lastSeq + 1;

	if (command.type === 'start') {
		if (state.started) throw new CommandError('session already started');
		if (command.items.length === 0) throw new CommandError('a session needs at least one item');
		return [{ seq, at, type: 'session-started', items: command.items }];
	}

	if (!state.started) throw new CommandError('session not started');
	if (!state.items.some((item) => item.id === command.itemId)) {
		throw new CommandError(`unknown item "${command.itemId}"`);
	}

	switch (command.type) {
		case 'select':
			return [{ seq, at, type: 'item-selected', itemId: command.itemId }];
		case 'comment':
			if (command.text.trim() === '') throw new CommandError('comment text is blank');
			return [
				{
					seq,
					at,
					type: 'comment-pinned',
					itemId: command.itemId,
					selector: command.selector,
					text: command.text,
					screenshot: command.screenshot,
					pageUrl: command.pageUrl,
				},
			];
		default:
			if (state.approved.includes(command.itemId)) {
				throw new CommandError(`item "${command.itemId}" is already approved`);
			}
			return [{ seq, at, type: 'item-approved', itemId: command.itemId }];
	}
}

export function reduce(events: readonly ReviewEvent[]): SessionState {
	const state: SessionState = { ...initialState, items: [], comments: [], approved: [] };
	for (const event of events) {
		state.lastSeq = event.seq;
		switch (event.type) {
			case 'session-started':
				state.started = true;
				state.items = event.items;
				break;
			case 'item-selected':
				state.position = Math.max(
					0,
					state.items.findIndex((item) => item.id === event.itemId),
				);
				break;
			case 'comment-pinned': {
				const { type: _type, at: _at, ...comment } = event;
				state.comments.push(comment);
				break;
			}
			case 'item-approved':
				state.approved.push(event.itemId);
				break;
		}
	}
	return state;
}

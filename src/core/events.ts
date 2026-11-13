export type Item = {
	id: string;
	title: string;
	url: string;
	question?: string;
	options?: string[];
};

// seq starts at 1 and climbs by 1; at is an ISO 8601 string.
export type EventBase = { seq: number; at: string };

export type ReviewEvent = EventBase &
	(
		| { type: 'session-started'; items: Item[] }
		| { type: 'item-selected'; itemId: string }
		| {
				type: 'comment-pinned';
				itemId: string;
				selector: string;
				text: string;
				screenshot: string;
				pageUrl: string;
		  }
		| { type: 'item-approved'; itemId: string }
	);

export type Command =
	| { type: 'start'; items: Item[] }
	| { type: 'select'; itemId: string }
	| {
			type: 'comment';
			itemId: string;
			selector: string;
			text: string;
			screenshot: string;
			pageUrl: string;
	  }
	| { type: 'approve'; itemId: string };

export type Comment = {
	seq: number;
	itemId: string;
	selector: string;
	text: string;
	screenshot: string;
	pageUrl: string;
};

export type SessionState = {
	started: boolean;
	items: Item[];
	position: number;
	comments: Comment[];
	approved: string[];
	lastSeq: number;
};

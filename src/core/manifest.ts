import { parse } from 'yaml';
import type { Item } from './events.ts';

export class ManifestError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const PROBE_ORIGIN = 'http://review.invalid';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseManifest(text: string): Item[] {
	let doc: unknown;
	try {
		doc = parse(text);
	} catch (e) {
		throw new ManifestError(
			`manifest: invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	const list = isRecord(doc) ? doc['items'] : undefined;
	if (!Array.isArray(list) || list.length === 0) {
		throw new ManifestError('items: must be a non-empty list');
	}
	const seen = new Set<string>();
	return list.map((raw: unknown, i) => {
		const p = `items[${i}]`;
		if (!isRecord(raw)) {
			throw new ManifestError(`${p}: must be a mapping`);
		}
		const { id, title, url, question, type } = raw;
		if (typeof id !== 'string' || !ID.test(id)) {
			throw new ManifestError(`${p}.id: must match ${ID} (got ${JSON.stringify(id)})`);
		}
		if (seen.has(id)) throw new ManifestError(`${p}.id: duplicate id "${id}"`);
		seen.add(id);
		if (typeof title !== 'string' || title.trim() === '') {
			throw new ManifestError(`${p}.title: must be a non-empty string`);
		}
		// The tray location.assign()s this. The URL parser reads `//`, `/\` and `/<tab or newline>/` as another host,
		// and throws on a bare `//` or `/\`, so canParse covers those too.
		if (
			typeof url !== 'string' ||
			!url.startsWith('/') ||
			!URL.canParse(url, PROBE_ORIGIN) ||
			new URL(url, PROBE_ORIGIN).origin !== PROBE_ORIGIN
		) {
			throw new ManifestError(`${p}.url: must be a same-origin path starting with "/"`);
		}
		if (question !== undefined && typeof question !== 'string') {
			throw new ManifestError(`${p}.question: must be a string`);
		}
		if (type !== undefined && type !== 'single') {
			throw new ManifestError(
				`${p}.type: ${JSON.stringify(type).replace(/^"|"$/g, '')} items are not supported yet`,
			);
		}
		return question === undefined ? { id, title, url } : { id, title, url, question };
	});
}

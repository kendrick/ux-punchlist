const SRC = 'src="/__punchlist/tray.ts"';

// Without the target's nonce, its CSP blocks the tray. Browsers check <script> against script-src-elem, then script-src, then default-src.
// shortcut: takes the first policy's nonce, so several policies with different nonces still block the tray; upgrade if a real target does that.
export function scriptNonce(csp: string | string[] | undefined): string | undefined {
	for (const policy of [csp ?? ''].flat().join(',').split(',')) {
		const dirs = policy.split(';').map((d) => d.trim().split(/\s+/));
		const dir = ['script-src-elem', 'script-src', 'default-src']
			.map((name) => dirs.find((d) => d[0]?.toLowerCase() === name))
			.find(Boolean);
		// Base64 charset only: the value lands inside an HTML attribute.
		const hit = dir?.map((t) => /^'nonce-([A-Za-z0-9+/=_-]+)'$/i.exec(t)?.[1]).find(Boolean);
		if (hit) return hit;
	}
	return undefined;
}

// The tray fetches /__punchlist/*; a connect-src (or default-src fallback) that omits it breaks the tray. Widen to that path only, never 'self' or *.
export function allowTrayConnect(
	csp: string | string[] | undefined,
	origin: string,
): string | string[] | undefined {
	const src = `${origin}/__punchlist/`;
	const widen = (policy: string) => {
		const dirs = policy.split(';');
		const find = (name: string) =>
			dirs.findIndex((d) => d.trim().split(/\s+/)[0]?.toLowerCase() === name);
		const sources = (i: number) => dirs[i]!.trim().split(/\s+/).slice(1);
		const onlyNone = (i: number) =>
			sources(i).length === 1 && sources(i)[0]!.toLowerCase() === "'none'";
		const connect = find('connect-src');
		if (connect >= 0)
			dirs[connect] = onlyNone(connect)
				? dirs[connect]!.replace(/'none'/i, src)
				: `${dirs[connect]!.trimEnd()} ${src}`;
		else {
			const def = find('default-src');
			if (def >= 0)
				dirs.splice(
					def + 1,
					0,
					` connect-src ${onlyNone(def) ? src : [...sources(def), src].join(' ')}`,
				);
		}
		return dirs.join(';');
	};
	const widenHeader = (v: string) => v.split(',').map(widen).join(',');
	return Array.isArray(csp)
		? csp.map(widenHeader)
		: csp === undefined
			? undefined
			: widenHeader(csp);
}

export function injectTray(html: string, nonce?: string): string {
	const tag = `<script type="module" ${nonce ? `nonce="${nonce}" ` : ''}${SRC}></script>`;
	const at = html.toLowerCase().lastIndexOf('</body>');
	return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

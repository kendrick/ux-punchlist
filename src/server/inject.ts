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

export function injectTray(html: string, nonce?: string): string {
	const tag = `<script type="module" ${nonce ? `nonce="${nonce}" ` : ''}${SRC}></script>`;
	const at = html.toLowerCase().lastIndexOf('</body>');
	return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

const TAG = '<script type="module" src="/__punchlist/tray.ts"></script>';

export function injectTray(html: string): string {
	const at = html.toLowerCase().lastIndexOf('</body>');
	return at === -1 ? html + TAG : html.slice(0, at) + TAG + html.slice(at);
}

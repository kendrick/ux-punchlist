// Rewrites Tailwind/Basecoat output so it holds up inside the tray's shadow root.
// Each step exists because of a host-page trap; see docs/adr/0001-tray-ui-stack.md.

// `:root`/`:host` can't be targeted from a shadow root's sheet without also matching the
// host page's own :root rules, so the tray marks its own container instead.
function rewriteRoots(css: string): string {
	let out = css.replace(/:(?:root|host)(?![\w(-])/g, '[data-pl-root]');
	// `:root,:host` becomes a selector list naming the same target twice.
	const dup = /\[data-pl-root\]\s*,\s*\[data-pl-root\](?![\w-])/g;
	while (dup.test(out)) {
		dup.lastIndex = 0;
		out = out.replace(dup, '[data-pl-root]');
	}
	return out;
}

// A host's `html { font-size: 62.5% }` would shrink every rem; px is immune.
function remToPx(css: string): string {
	return css.replace(
		/(?<![\w.])(\d*\.?\d+)rem(?![\w-])/g,
		(_, n: string) => `${Number((Number(n) * 16).toFixed(4))}px`,
	);
}

// `@property` registrations are document-global and ignored in shadow-root sheets, so
// their initial values never apply; declare them as plain custom properties instead.
// They go in `@layer properties` (Tailwind declares it first, so it ranks lowest): unlayered,
// they'd beat every utility that sets a --tw-* var and no ring, shadow or transform would apply.
function propertiesToDeclarations(css: string): string {
	const notInherited: string[] = [];
	const inherited: string[] = [];
	const stripped = css.replace(
		/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g,
		(_, name: string, body: string) => {
			let initial = /initial-value\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
			if (initial === undefined) return '';
			// The minifier writes a <length> 0 unitless; untyped, `calc(3px + 0)` is invalid.
			if (initial === '0' && /syntax\s*:\s*["']<length/.test(body)) initial = '0px';
			const inherits = /inherits\s*:\s*true/.test(body);
			(inherits ? inherited : notInherited).push(`${name}:${initial}`);
			return '';
		},
	);
	const rules: string[] = [];
	if (notInherited.length) {
		rules.push(`[data-pl-root],[data-pl-root] *,::before,::after{${notInherited.join(';')}}`);
	}
	if (inherited.length) rules.push(`[data-pl-root]{${inherited.join(';')}}`);
	return rules.length ? `${stripped}@layer properties{${rules.join('')}}` : stripped;
}

export function postProcess(css: string): string {
	return propertiesToDeclarations(remToPx(rewriteRoots(css)));
}

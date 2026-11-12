const escapeAttr = (value: string): string => value.replace(/[\\"]/g, '\\$&');

const idSelector = (el: Element): string | null => {
	if (!el.id) return null;
	const selector = `[id="${escapeAttr(el.id)}"]`;
	return el.ownerDocument.querySelectorAll(selector).length === 1 ? selector : null;
};

const step = (el: Element): string => {
	const tag = el.localName;
	let n = 1;
	for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
		if (s.localName === tag) n++;
	}
	return `${tag}:nth-of-type(${n})`;
};

// Direct-child chain, so each step is unambiguous given its parent's uniquely-resolved path.
export function cssPath(el: Element): string {
	const steps: string[] = [];
	for (let node: Element | null = el; node; node = node.parentElement) {
		const anchor = idSelector(node);
		if (anchor) {
			steps.unshift(anchor);
			break;
		}
		steps.unshift(node === node.ownerDocument.documentElement ? 'html' : step(node));
	}
	return steps.join(' > ');
}

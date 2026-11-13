// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(root + rel, 'utf8');

// AGENTS.md's other sections, which must stay unchanged and ahead of `## Build and test`.
const ORIGINAL_AGENTS = `## Agent skills

### Issue tracker

GitHub Issues in \`kendrick/ux-punchlist\`. All writes go through \`gh api graphql\` mutations. See \`docs/agents/issue-tracker.md\`.

### Triage labels

Default vocabulary: \`needs-triage\`, \`needs-info\`, \`ready-for-agent\`, \`ready-for-human\`, \`wontfix\`. See \`docs/agents/triage-labels.md\`.

### Domain docs

Single-context: one \`GLOSSARY.md\` and \`docs/adr/\` at the repo root. See \`docs/agents/domain.md\`.
`;

function fencedBlocks(markdown: string): string[] {
	return [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe('plugin packaging', () => {
	it('plugin.json names the plugin and its license', () => {
		const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
		expect(manifest.name).toBe('ux-punchlist');
		expect(manifest.version).toBe('0.1.0');
		expect(manifest.license).toBe('MIT');
		expect(manifest.description).toEqual(expect.any(String));
		expect(manifest.description.length).toBeGreaterThan(0);
	});

	it('skills/review/SKILL.md has name and description frontmatter', () => {
		const text = read('skills/review/SKILL.md');
		const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
		expect(match).not.toBeNull();
		const frontmatter = parseYaml(match![1]);
		expect(frontmatter.name).toBe('review');
		expect(frontmatter.description).toMatch(/start.*review session/i);
	});

	it('SKILL.md shows a manifest the Task 2 parser shape accepts', () => {
		const yamlBlock = fencedBlocks(read('skills/review/SKILL.md')).find((b) =>
			b.startsWith('items:'),
		);
		expect(yamlBlock).toBeDefined();
		const { items } = parseYaml(yamlBlock!);
		expect(Array.isArray(items)).toBe(true);
		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			expect(item.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
			expect(item.title).toEqual(expect.any(String));
			expect(item.url.startsWith('/')).toBe(true);
		}
	});

	it('SKILL.md runs the Task 4 CLI contract', () => {
		const text = read('skills/review/SKILL.md');
		expect(text).toContain('node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" start --target');
		expect(text).toContain('.review/manifest.yaml');
		expect(text).toContain('src/plan/cli.ts');
		expect(text).toContain('npm install --omit=dev --prefix "${CLAUDE_PLUGIN_ROOT}"');
	});

	it('LICENSE is the MIT text for Kendrick Arnett', () => {
		const text = read('LICENSE');
		expect(text).toContain('MIT License');
		expect(text).toContain('Copyright (c) 2026 Kendrick Arnett');
		expect(text).toContain('Permission is hereby granted, free of charge');
	});

	it('AGENTS.md names the exact test commands pnpm test and pnpm test:e2e', () => {
		const text = read('AGENTS.md');
		const start = text.indexOf('## Build and test');
		expect(start).toBeGreaterThan(0);
		expect(text.slice(0, start).trimEnd()).toBe(ORIGINAL_AGENTS.trimEnd());

		const section = text.slice(start);
		const lines = fencedBlocks(section)
			.join('')
			.split('\n')
			.map((l) => l.trim());
		expect(lines).toContain('pnpm test');
		expect(lines).toContain('pnpm test:e2e');
		expect(lines.indexOf('pnpm test')).toBeLessThan(lines.indexOf('pnpm test:e2e'));
	});
});

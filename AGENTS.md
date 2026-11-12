## Agent skills

### Issue tracker

GitHub Issues in `kendrick/ux-punchlist`. All writes go through `gh api graphql` mutations. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Build and test

Setup, once per checkout:

```sh
pnpm install
pnpm exec playwright install
```

Unit tests, including the event-log tests (Vitest):

```sh
pnpm test
```

Browser tests (Playwright, runs the fixture app):

```sh
pnpm test:e2e
```

Type and lint checks:

```sh
pnpm typecheck
pnpm lint
```

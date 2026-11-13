---
name: review
description: Start a single-item review session on an app that is already running. Use when the user wants to step through review items one at a time, with comments and approvals logged to .review/events.jsonl.
---

# Review

This skill starts a review session on a running app. The reviewer steps through the items in `.review/manifest.yaml`. Each comment and approval is appended to `.review/events.jsonl`.

## Steps

1. Install the plugin's runtime dependencies once. Run this only when `${CLAUDE_PLUGIN_ROOT}/node_modules` is missing. If `pnpm` isn't on `PATH`, tell the user to install pnpm and stop.

   ```sh
   pnpm install --prod --frozen-lockfile --dir "${CLAUDE_PLUGIN_ROOT}"
   pnpm --dir "${CLAUDE_PLUGIN_ROOT}" exec playwright install chromium
   ```

2. Check that `.review/manifest.yaml` exists in the project. If it does not, run Plan to write one from the branch diff:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/src/plan/cli.ts" --app <app dir>
   ```

   `--app` is relative to `--root`. Add `--base <ref>` when the branch is not based on `main`. Add `--root <dir>` when the project is not the current directory. Then act on the result:

   - Exit 0 with `wrote N items`: show the user the manifest, let them edit it, then go to step 3.
   - Exit 0 with `no reviewable changes`: say so and stop.
   - Non-zero exit: show Plan's `punchlist: plan:` error line and stop.

3. Make sure the app under review is running. Then start the review server in the background:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" start --target <app url>
   ```

   Add `--port <n>` to fix the port. Add `--root <dir>` when the project is not the current directory. Without `--port`, the server picks a free port.

   Read the server output. If a line starts with `punchlist: warning:`, pass it to the user. If the process exits with a line starting with `punchlist:`, show that message to the user and stop.

4. When the output shows `punchlist: listening on <url>`, give the user that URL. Tell them the tray shows "Item 1 of N" in the app.

## Manifest shape

```yaml
items:
  - id: home-hero
    title: Home page hero
    url: /
    question: Does the hero say what the product does?
```

`items` is a list, and a session needs at least one item to start. Each `id` is unique and uses lowercase letters, digits and hyphens. `title` is a non-empty string. `url` starts with `/`. `question` is optional. `type` is optional, and only `single` is accepted. `options` is optional: a list of 1 to 4 option ids. An item without it has one option. Five or more is rejected, and the error names the item.

## Notes

- Do not edit or delete `.review/events.jsonl`. The log is append-only, and the session state is rebuilt from it.
- To stop the session, end the background process. Starting it again resumes at the same item, with the same comments and approvals.
- If the manifest changes after the session starts, the session keeps the items from its first start. The server prints a warning in that case.

# ux-punchlist: Journeys, Multiplayer & Sign-off

Nov 10, 2026 · @Kendrick Arnett

Build a review layer for Claude Code, not a design tool: Claude plans a review of whole journeys, several people review it together, and the session ends in a recorded sign-off. Design craft gets routed to Impeccable. Build it from scratch under a permissive license.

## Lane: review, not craft

Impeccable answers "how should this look?" This plugin answers "is this done, and is it right?" Impeccable's live mode already covers pick an element, get variants, accept one into source ([live mode docs](https://raw.githubusercontent.com/pbakaus/impeccable/ab524607fdea270c49da81076b87657c51f30f00/plugin/skills/impeccable/reference/live.md)), and its docs send anything bigger than one element elsewhere. Everything above the element is open ground.

|  | Impeccable | This plugin |
| --- | --- | --- |
| Question | How should this look? | Is this done, and is it right? |
| Unit | One element | A session: journeys across pages, states and roles |
| Who starts it | You pick an element | Claude plans what needs review |
| Reviewers | One | Several, at once or in turn |
| Feedback | Design direction | Anything: bugs, copy, behavior, accessibility, data, design |
| End state | Variant accepted into source | Verified, signed off and recorded |

The two work together: when feedback is about craft, the router hands it to `/impeccable live` with the element already picked.

## The three pillars

Journeys, multiplayer and sign-off are what make this a review tool. State coverage and drift watch support them.

### Journeys

A review item can be a sequence, not a single screen. Claude walks the app through a flow, such as sign-up, checkout or onboarding, and presents each step in order. Feedback can then land on transitions, validation and timing, not just on how each screen looks.

- **Defined in the manifest** as ordered steps, each with a route, the actions that reach it, and the question for that step.
- **Branches are steps too:** the error path, the empty cart, the expired session. A preview-only `?review-state=` switch in the app forces each one, so nobody has to reach them by hand. Claude scaffolds that switch for each app.
- **Feedback can target** a step, an element on a step, or the gap between two steps ("the jump from shipping to payment loses my cart summary").
- **Replay:** Claude keeps the action script, so the same journey replays after a fix and during Verify.
- **Authoring:** the YAML manifest is the one format every method writes to. v0 ships Claude-inferred manifests plus hand edits. Click-to-record and outside sources such as Figma or Jira come later, as importers that produce manifest diffs.

### Multiplayer

A session can have several reviewers, such as teammates or clients in a workshop, each on their own device.

- **One session, many seats:** reviewers join by invite link and see everyone's annotations pinned in place, each with its author's initials and a thread with one level of replies.
- **Async first:** hosted sessions are async in v0, with each reviewer moving at their own pace. Live mode, with everyone following the owner through items, comes later for client workshops.
- **Every feedback item carries its author,** so routing and sign-off know who said what.
- **Claude reconciles:** when the owner closes a round, it reads where each thread landed, then it merges duplicate comments, flags conflicts ("one reviewer wants the CTA bigger, another wants it quieter"), and asks the owner to break ties before anything routes. The owner can mark a thread settled mid-round so it skips the conflict queue.
- **Roles:** owner (plans, breaks ties, closes), reviewer (comments, approves), observer (watches only).
- **Targets and identity:** a session runs locally (solo, worktrees on ports), locally shared (a cloudflared tunnel per port, reachable while the laptop is awake), or hosted (preview deploys plus a small relay that buffers events). Identity in v0 is an invite link plus a display name, recorded as unverified. Real sign-in comes with client use.
- **Claude runs on the owner's machine:** Route and Fix happen in the owner's Claude Code session, and Claude posts its answers and "routed to fix" statuses as replies in each thread.

### Sign-off

The session ends in a record, not just closed tickets.

- **What gets recorded:** each item, its verdict (approved, approved with notes, rejected), who decided, the commit it was judged against, before/after screenshots, the vote tally with the owner's pick and reason, and the files and routes behind the item. Recording a verdict needs a clean commit.
- **Approval rule, set per session:** owner-only by default, plus optional required approvers whose approval also counts. Any reviewer, or every named reviewer, can be set instead.
- **Output:** a sign-off report in the repo as Markdown plus JSON, which a PR can link to. One renderer also turns it into a live session page that freezes at close, decision pins in the overlay, and a self-contained HTML file a client takes home after a workshop.
- **Issues only for open work:** items routed as big, approved with notes, or rejected and deferred become GitHub issues that link back to the report. Approved items and votes stay in the report.
- **Drift watch builds on it:** when a later commit touches code behind an approved item, Claude re-presents it as "changed since sign-off."

## The full cycle

Agentation's loop is annotate, send, fix. This one adds a planned review session at the front, several reviewers in the middle, and verification plus sign-off at the end.

&#91;embedded content: review loop · 7 steps, 1 reopen path\]

A fix that fails verification goes back to Capture with its history attached; only verified items reach Close. A fix can also return variants, which sends the item back to Present as a choice. Capture, Route and Fix are the commodity part that several tools already do.

The loop is the same on every target (local, locally shared or hosted); only where each step runs changes. Session state lives in the repo as append-only JSON events under `.review/`, and Plan starts from the branch's diff against `main`. On a hosted target a fix waits for its preview deploy, and Verify goes first to whoever raised the comment.

## Item types: single, journey and choice

Every review item is one of three types, and all three run through the same seven steps.

|  | Single | Journey | Choice |
| --- | --- | --- | --- |
| What you see | One screen or state | Ordered steps, branches included | 2–4 alternative approaches |
| What you do | Comment or approve | Comment on steps, elements and transitions | Cycle, pick one, comment on any |
| Scope | Any | A flow across pages | Page or flow level only |
| When Plan uses it | Default | Any flow worth walking | Only when the manifest flags exploration |

**Choice items stay above the element.** Element-level variants, like three takes on a pricing card, are Impeccable live's job, so the router sends them there. Choice items compare what Impeccable doesn't: two navigation models, two onboarding flows, two ways to structure a page.

**Where options enter the cycle**

- **Plan** flags what's worth exploring. It doesn't generate the options itself.
- **Present** shows the tray as "Item 3 of 7 · Option B of 3", with arrow keys to cycle.
- **Capture** accepts a pick, a comment on any option, or a comment across options ("B's navigation with A's landing page"). Picks count as votes: Claude tallies them, and the owner always makes the final choice.
- **Fix** can return options instead of one answer, which sends the item back to Present as a choice.
- **Verify** reuses the same compare UI: before/after is just a two-option set.

**Constraint:** options multiply the Fix work, so the manifest caps them at four per item and defaults to one unless exploration is flagged.

**Build implications**

1. **Rendering options:** page- and flow-level options run as worktrees on their own ports locally, or as branches with their own preview deploys when hosted, and the tray switches between them. No in-place element swapping is needed, since Impeccable owns that.
2. **Payload:** feedback carries its author, a `stepId` for journeys, and an `optionId` (several for cross-option comments). Selection is its own event type.
3. **Cleanup:** the losing options' branches are removed before the item can close.

## Routing

The router sends each feedback item to the handler that fits it, and craft goes to Impeccable.

```yaml
routes:
  craft:    { skill: impeccable, command: live }      # element look and feel, element pre-picked
  design:   { skill: impeccable, command: critique }  # page-level design review
  bug:      { action: direct-fix }
  copy:     { action: direct-fix, batch: true }
  behavior: { action: direct-fix }                    # journey transitions, validation
  question: { action: answer-only }
  big:      { skill: to-tickets }
```

- **Handoff to Impeccable live:** the router passes the selector, page URL, comment and screenshot, so live mode opens on the right element with no re-picking. Its live events already accept a comment and a screenshot ([live mode docs](https://raw.githubusercontent.com/pbakaus/impeccable/ab524607fdea270c49da81076b87657c51f30f00/plugin/skills/impeccable/reference/live.md)).
- **Impeccable's result still gets reviewed:** an accepted variant moves to Verify like any other fix, and it still needs sign-off.
- **Reconcile first:** conflicting feedback from several reviewers is settled before anything routes.
- **Craft from a hosted session:** the router opens a local worktree of that commit for Impeccable live, and the accepted variant deploys and enters Verify like any other fix.

## Licensing: context and caveats

This assumes Agentation is licensed under PolyForm Shield. That license wasn't verified here, so confirm it in the repo before relying on any of this. This is orientation, not legal advice.

## What PolyForm Shield means for this plan

Shield lets anyone use, change and redistribute the code, but not to compete with the licensor ([PolyForm licenses](https://polyformproject.org/licenses)). That limit sorts the plan into three cases:

| What you do | Risk | Why |
| --- | --- | --- |
| Use Agentation as-is on your own or client work | Low | Using a tool isn't competing with its maker |
| Fork it or build on its code, then publish the plugin | High | A published click-to-feedback tool for coding agents is Agentation's whole product |
| Build the same concept from scratch | Low | Copyright covers code, not ideas; other tools already implement the same idea independently |

Click an element, capture a payload, queue it, expose it over MCP, inject it with a hook: none of those patterns belong to anyone.

## How to keep it clean

The safe path is to build from your own spec and never let Agentation's code into the project or the agent's context.

1. **Don't fork, vendor or copy Agentation code.** Don't paste it into Claude Code as reference either; "do it like this file" is how derived code sneaks in.
2. **Work from your own spec.** The architecture and the decisions from a grill session are enough. Take ideas from other tools, then close the tab before writing code.
3. **License your plugin MIT or Apache-2.0,** so nobody downstream faces this uncertainty.
4. **Check every dependency's license before borrowing from it.** Browser Annotations' license is unknown; Playwright is Apache-2.0 and safe to build on.
5. **Ask legal before any commercial use.** It's a five-minute question.

## Next steps

1. **Write the spec and slice it** with `/to-spec`, then `/to-tickets`.
2. **Suggested build order:** single items and the review tray first, then journeys with replay, then the sign-off report, then multiplayer, with choice items and drift watch last. Sign-off works with one reviewer, and multiplayer adds authorship to it.
3. **List the plugin in the marketplace:** add `ux-punchlist` to `kendrick/agent-plugins` once its repo has a `plugin.json`.

# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `kendrick/ux-punchlist`. Use the `gh` CLI for all operations.

## Writes go through GraphQL only

A corporate firewall blocks `gh issue create`, `gh issue edit`, `gh issue comment`, `gh issue close`, `gh label create`, and every REST write (`gh api --method POST|PATCH|DELETE repos/...`). Don't try them first and don't retry one that failed. Make every write a `gh api graphql` mutation, and pass any body text as a file: `-F b=@body.md`. Reads (`gh issue view`, `gh issue list`, `gh api repos/...` GETs) are fine.

Mutations take node IDs, not `#numbers`:

- Repo ID: `gh api graphql -f query='{repository(owner:"kendrick",name:"ux-punchlist"){id}}' --jq .data.repository.id`
- Issue ID: `gh issue view <n> --json id --jq .id`
- Label IDs: `gh api graphql -f query='{repository(owner:"kendrick",name:"ux-punchlist"){labels(first:100){nodes{id name}}}}'`

## Conventions

- **Create an issue**: invoke the `file-issue` skill, once per issue, including when `to-tickets` or another skill is publishing slices. Don't run the mutation below yourself. It's here as the write that `file-issue` makes. Write the body to a file, then
  `gh api graphql -F repo=<repo-id> -F title='...' -F b=@body.md -f query='mutation($repo:ID!,$title:String!,$b:String){createIssue(input:{repositoryId:$repo,title:$title,body:$b}){issue{number url}}}'`.
  Add `labelIds:[...]` and `parentIssueId:` to the input as needed.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: pass `parentIssueId` to `createIssue`, or afterwards `mutation{addSubIssue(input:{issueId:"<parent-id>",subIssueId:"<child-id>"}){issue{number}}}`.
- **Blocking**: GitHub's native issue dependencies, the canonical, UI-visible representation. Add an edge with `mutation{addBlockedBy(input:{issueId:"<child-id>",blockingIssueId:"<blocker-id>"}){issue{number}}}`; remove one with `removeBlockedBy`. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: `gh api repos/kendrick/ux-punchlist/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable). `gh issue view <n> --json blockedBy` also lists closed blockers, so filter it: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment on an issue**: `gh api graphql -F id=<issue-id> -F b=@comment.md -f query='mutation($id:ID!,$b:String!){addComment(input:{subjectId:$id,body:$b}){commentEdge{node{url}}}}'`.
- **Apply / remove labels**: `addLabelsToLabelable(input:{labelableId:"<issue-id>",labelIds:["<label-id>"]})` / `removeLabelsFromLabelable(...)` with the same shape.
- **Close**: post the explanation with `addComment` first, then `closeIssue(input:{issueId:"<issue-id>",stateReason:COMPLETED})` (or `NOT_PLANNED`).

File issues only into this repo, `kendrick/ux-punchlist`. Never file into `mattpocock/skills` (the repo these skills come from).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues. Read with `gh pr view <number>`, `gh pr view <number> --comments`, and `gh pr diff <number>`. List external PRs with `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`. Comment, label, and close with the same GraphQL mutations as issues (`addComment`, `addLabelsToLabelable`, `closePullRequest`), using the PR's node ID from `gh pr view <n> --json id`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Invoke the `file-issue` skill once per issue, and let it do the creating. This holds for every skill that slices work into issues, `to-tickets` included: the slicing skill decides what the issues are, and `file-issue` files each one. Never call `createIssue` directly to file a ticket. When `file-issue` reaches the write, it still follows the GraphQL rules above.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create it with `createIssue` and the label's ID in `labelIds`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues), drop any with an open blocker (see **Count open blockers**) or an assignee; first in map order wins.
- **Claim**: `addAssigneesToAssignable(input:{assignableId:"<issue-id>",assigneeIds:["<your-user-id>"]})` (user ID from `gh api graphql -f query='{viewer{id}}'`), the session's first write.
- **Resolve**: `addComment` with the answer, then `closeIssue`, then append a context pointer (gist + link) to the map's Decisions-so-far by editing the map body with `updateIssue(input:{id:"<map-id>",body:$b})`.

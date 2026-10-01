# pr-review-radar

Local-first dashboard for driving AI code review across your team's open pull requests.

Today the loop is manual: prompt an AI for a summary of every open PR, request reviews on the ones
missing them, re-request on the ones that moved — then re-run the whole prompt to find out what
changed. This app keeps that board live instead.

- One board of every PR matching your GitHub search, grouped by what it needs next.
- Buttons to request an AI review or re-review, run locally through your own `claude` CLI.
- Preview and edit before anything is posted; nothing reaches GitHub without your click.
- Background polling re-evaluates only the PRs that actually changed.

Runs entirely on your machine with your own credentials. Teammates clone it and use theirs.

**Status**: the board and the review loop ship (User Stories 1 and 2). Background polling is
specified and next up. Built with [GitHub Spec Kit](https://github.com/github/spec-kit).

## Run it

Needs Node >= 24, an authenticated [`gh`](https://cli.github.com), and the
[Claude Code CLI](https://claude.com/claude-code) on PATH.

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4317
```

For development, `npm run dev` runs the server with reload plus Vite on
http://127.0.0.1:5317. `npm run doctor` reports what the app can see without starting it.

Set your GitHub search query in the UI — same syntax as GitHub search, e.g.
`org:YOUR_ORG is:pr is:open label:YOUR_LABEL`. It is stored **in your browser**
(`localStorage["pr-review-radar:query"]`) and sent to your local server with each request, so a
shared repository carries nobody's query and your teammates each keep their own. Server-side
settings live in `config/config.json`; that file and the `data/` cache are gitignored. The app
reads your token from `GITHUB_TOKEN` or `gh auth token` and keeps it in memory only.

### What works today

- Live board of every open PR matching your query, grouped: needs AI review, awaiting re-review,
  running, ready for human, error.
- Your query, customizable and remembered by your browser. Switching it drops the old results
  immediately; a blank or placeholder query never touches the GitHub API.
- **Request AI review / re-review** per PR. The run executes locally through your `claude` CLI
  against the PR's diff — no clone needed. Bounded concurrency, one run per PR, cancellable, with
  a timeout and captured output on failure.
- **Preview, edit, post or discard.** Nothing reaches GitHub until you click Post; the comment
  goes up under your own account. Posting twice is refused, and a review describing an older
  commit asks before it goes out.
- Already reviewed at this commit? The request is refused with the commit shown, not silently
  re-run. **Re-run** forces it.
- Status computed from GitHub facts on every read, so it cannot drift.
- Per-repo access failures reported without taking the board down; API quota and last-refresh
  time in the status bar.

### Not yet

Background polling and live updates (the board currently refreshes on a timer while open), and
bulk actions — see [tasks.md](specs/001-pr-review-radar/tasks.md) phases 5 onward.

## Specification

| Document | What's in it |
|---|---|
| [Constitution](.specify/memory/constitution.md) | Five non-negotiable principles |
| [Spec](specs/001-pr-review-radar/spec.md) | User stories, 45 functional requirements, success criteria |
| [Plan](specs/001-pr-review-radar/plan.md) | Stack, structure, constitution gate check |
| [Research](specs/001-pr-review-radar/research.md) | Ten technical decisions with rejected alternatives |
| [Data model](specs/001-pr-review-radar/data-model.md) | Entities, schema, derived status rules |
| [HTTP API](specs/001-pr-review-radar/contracts/http-api.md) | Routes and SSE event stream |
| [ChangeSource](specs/001-pr-review-radar/contracts/change-source.md) | The seam that makes webhooks additive |
| [Quickstart](specs/001-pr-review-radar/quickstart.md) | Prerequisites and the daily loop |
| [Tasks](specs/001-pr-review-radar/tasks.md) | 69 tasks, grouped by user story |

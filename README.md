# pr-review-radar

A local dashboard for driving AI code review across your team's open pull requests.

The manual version of this is: prompt an AI for a summary of every open PR, request reviews on the
ones missing them, re-request on the ones that moved — then re-run the whole prompt to find out
what changed. This keeps that board live instead.

![status: user stories 1–5 shipped](https://img.shields.io/badge/stories-1--5%20shipped-brightgreen)

- One board of every PR matching your GitHub search, grouped by what it needs next.
- Buttons to request an AI review or re-review — per PR, or a whole group at once.
- Preview and edit before anything is posted. Nothing reaches GitHub without your click.
- Background polling re-evaluates only the PRs that actually changed and pushes them to the
  browser, so you stop re-running a prompt to learn what moved.

Everything runs on your machine with your own credentials. Your teammates clone it and use theirs.

Built with [GitHub Spec Kit](https://github.com/github/spec-kit) — the specification is in
[`specs/001-pr-review-radar/`](specs/001-pr-review-radar/) and is kept in sync with the code.

## Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js >= 24 | Runtime; the app uses the built-in `node:sqlite` | `node -v` |
| [GitHub CLI](https://cli.github.com), authenticated | Supplies your GitHub token | `gh auth status` |
| [Claude Code CLI](https://claude.com/claude-code) | Runs the reviews locally | `claude --version` |

If one is missing, startup names it and how to install it rather than failing with a stack trace.

## Run it

```bash
git clone git@github.com:LucasOta/pr-review-radar.git
cd pr-review-radar
npm install
npm run build
npm start                # http://127.0.0.1:4317
```

For development: `npm run dev` runs the server with reload plus Vite on http://127.0.0.1:5317.
`npm run doctor` reports what the app can see — versions, account, paths, rate limit — without
starting anything.

On first open the app asks for a GitHub search query. Same syntax as GitHub search:

```
org:YOUR_ORG is:pr is:open label:YOUR_LABEL
```

## The loop

1. The board opens grouped by what each PR needs: **Needs AI review**, **Awaiting re-review**,
   **Review running**, **Ready for human**, **Error**.
2. **Request AI review** on a row, or **Review all (N)** on a group. Runs are bounded by your
   concurrency limit; skips are reported with reasons, never silent.
3. A finished run lands in the tray at the top. **Preview** it, edit if you want.
4. **Post** publishes it to the PR as a comment under your own GitHub account. **Discard** throws
   it away. Nothing reaches GitHub until you click Post.
5. Leave the board open. It polls on its own and moves rows as PRs change.

## Rules it follows

These are the ones worth knowing because they change what you see:

- **Re-review** means a reviewer requested changes *and* new commits landed after that. New
  commits with no changes-requested review put the PR back in **Needs AI review** instead.
- A PR already reviewed at its current commit is **skipped, not re-run** — the row shows which
  commit was covered. **Re-run** forces it.
- "Reviewed" means *posted to GitHub*. A draft you have not posted does not count, so the PR stays
  in **Needs AI review** with a Preview button.
- If the PR moves while a review is running, posting warns you that the text describes an older
  commit and asks before going out.
- A failed refresh keeps the last board and marks it stale rather than blanking. The status bar
  shows live/offline, your API quota, and the last successful refresh.

## What lives where

| | Where | Committed? |
|---|---|---|
| Your search query | your browser, `localStorage["pr-review-radar:query"]` | never — not even to disk |
| Your GitHub token | process memory, read from `GITHUB_TOKEN` or `gh auth token` | never |
| Server settings | `config/config.json` ([what the knobs do](config/README.md)) | no, gitignored |
| Cache + review history | `data/radar.sqlite` | no, gitignored |
| Review prompts | [`prompts/`](prompts/) | yes — edit them to taste |

Deleting `data/radar.sqlite` is safe: the board rebuilds from GitHub, and it still recognizes
reviews it posted earlier from a marker in the comment. Only local run history and unposted drafts
are lost.

A test enforces that nothing personal is committable, and another enforces that exactly one module
is allowed to write to GitHub.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gh auth token` failed at startup | Not logged in | `gh auth login` |
| Board empty, query looks right | Query matches nothing, or your token can't see those repos | Run the same query on github.com/search while signed in |
| App keeps asking for a query | Browser storage blocked (private window, extension) | Use a normal window; it works per-session but won't remember |
| One repository shows an error row | Token lacks access to it | The rest of the board still works |
| Run fails with "diff exceeds configured limit" | PR larger than `maxDiffBytes` | Raise it in `config/config.json`, or review that one by hand |
| Status bar says "offline" | The event stream dropped | It reconnects itself; the board also re-fetches every 2 minutes as a safety net |

## Not yet built

Webhook delivery — it is designed for
([ChangeSource](specs/001-pr-review-radar/contracts/change-source.md)) but not built. Adding it is
a new file implementing the same interface, not a refactor.

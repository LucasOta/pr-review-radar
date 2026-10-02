# Quickstart: PR Review Radar

Every operator runs their own copy with their own credentials. Nothing is shared but the code.

## Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js >= 24 | Runtime; `node:sqlite` needs 24+ | `node -v` |
| GitHub CLI, authenticated | Supplies the token the app reads | `gh auth status` |
| Claude Code CLI | Runs the reviews locally | `claude --version` |

Startup refuses to continue and names whichever is missing (FR-044) — it never fails with a stack
trace.

## Setup

```bash
git clone git@github.com:LucasOta/pr-review-radar.git
cd pr-review-radar
npm install
npm run dev          # or: npm run build && npm start
```

Open http://127.0.0.1:4317.

On first run the app asks for a search query. Type one in the UI — the same syntax as GitHub
search:

```
org:YOUR_ORG is:pr is:open label:YOUR_LABEL
```

It is stored in **your browser**, under `localStorage["pr-review-radar:query"]`, and sent to the
local server with each request. Nothing writes it to disk, so your query is yours even though the
code is shared. Clearing your browser data clears the query; the app asks for it again.

Server-side settings (refresh interval, concurrency, timeouts, port) live in `config/config.json`.
That file and `data/` are gitignored. Nothing you configure is committable.

## The loop

1. The board opens grouped by what each pull request needs: **Needs AI review**, **Running**,
   **Awaiting re-review**, **Ready for human**, **Error**.
2. Click **Request AI review** on a row, or **Review all** on a group. Runs are bounded by
   `maxConcurrentRuns`.
3. When a run finishes, the row offers **Preview**. Read it, edit if you want.
4. **Post** publishes it to the pull request as a comment under your own GitHub account.
   **Discard** throws it away. Nothing reaches GitHub until you click Post.
5. Leave the board open. It polls on its own and moves rows as pull requests change — no prompt to
   re-run.

## Things worth knowing

- **Re-review** means a reviewer requested changes *and* new commits landed after that. New commits
  with no changes-requested review put the pull request back in **Needs AI review** instead.
- A pull request already reviewed at its current commit is skipped rather than re-run; the row
  shows which commit was covered. **Re-run** forces it.
- If the pull request moves while a review is running, posting warns you that the text describes an
  older commit.
- Deleting `data/radar.sqlite` is safe. The board rebuilds from GitHub; only local run history and
  unposted drafts are lost.
- The status bar shows which GitHub account the app is acting as, remaining API quota, and when it
  last refreshed successfully.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gh auth token` failed at startup | Not logged in | `gh auth login` |
| Board empty, query looks right | Query matches nothing, or the token lacks access to those repos | Test the same query on github.com/search while signed in |
| App keeps asking for a query | Browser storage is blocked (private window, extension) | Use a normal window; the app still works per-session but will not remember |
| One repository shows an error row | Token lacks access to it | The rest of the board still works; request access or narrow the query |
| Run fails with "diff exceeds configured limit" | Pull request is larger than `maxDiffBytes` | Raise the limit, or review that pull request by hand |
| Board marked stale | Refresh failing | Check the status bar error; the app retries with backoff |

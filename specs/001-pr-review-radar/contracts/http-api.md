# Contract: Local HTTP API

Base URL `http://127.0.0.1:4317`. All responses JSON unless noted. No authentication — the server
is bound to loopback and acts as the operator (Principle I, FR-045).

Only the two routes marked **WRITES TO GITHUB** cause any outbound mutation (Principle III).

## Board

### `GET /api/board`

Returns the current board from cache, with status computed on read.

```jsonc
{
  "operator": { "login": "octocat", "avatarUrl": "..." },
  "query": "org:IntusCare is:pr is:open label:squad-x",
  "lastRefreshAt": "2026-10-01T18:04:12Z",
  "stale": false,
  "rateLimit": { "remaining": 4821, "resetAt": "2026-10-01T19:00:00Z" },
  "groups": {
    "needs_review":      [ /* PullRequestView */ ],
    "running":           [],
    "awaiting_rereview": [],
    "ready_for_human":   [],
    "error":             []
  },
  "repoErrors": [ { "repo": "org/private-thing", "message": "Not accessible" } ]
}
```

`PullRequestView`:

```jsonc
{
  "repo": "IntusCare/carehub",
  "number": 412,
  "title": "Fix eligibility recalculation",
  "author": "someone",
  "isDraft": false,
  "url": "https://github.com/...",
  "createdAt": "2026-09-28T10:00:00Z",
  "updatedAt": "2026-10-01T17:55:00Z",
  "headSha": "abc1234",
  "status": "awaiting_rereview",
  "commitsSinceChangesRequested": 3,
  "lastRun": { "id": "run_01J...", "status": "succeeded", "headSha": "def5678", "finishedAt": "..." },
  "lastPostedReview": { "url": "https://github.com/.../#issuecomment-123", "postedAt": "...", "headSha": "def5678" },
  "pendingDraftId": null
}
```

### `POST /api/refresh`

Triggers an immediate polling cycle (FR-037). `202 { "accepted": true }`. The result arrives on
the event stream, not in this response.

## Configuration

### `GET /api/config` → current `OperatorConfig` (never includes a token)

### `PUT /api/config`

Body: partial config. Validated by Zod; invalid bodies return `400` with field errors. Changing
`searchQuery` schedules an immediate refresh.

## Review runs

### `POST /api/pulls/:repo/:number/review`

```jsonc
{ "kind": "review" | "rereview", "force": false }
```

- `202 { "runId": "run_01J..." }` when enqueued.
- `409 { "error": "run_in_progress", "runId": "..." }` when one is already active for this pull
  request (FR-019).
- `409 { "error": "already_reviewed", "headSha": "abc1234" }` when a succeeded run already covers
  the current head SHA and `force` is false (FR-022). Resending with `"force": true` enqueues
  (FR-023).

### `POST /api/runs/:runId/cancel`

`200 { "status": "cancelled" }`. Idempotent; a finished run returns its terminal status (FR-016).

### `GET /api/runs/:runId`

Full run record including `stderrTail` and `error` when failed (FR-018).

### `POST /api/bulk/review`

```jsonc
{ "group": "needs_review" | "awaiting_rereview", "includeDrafts": false }
```

`202 { "enqueued": ["run_...", "run_..."], "skipped": [{ "repo": "...", "number": 1, "reason": "already_reviewed" }] }`.
Respects `maxConcurrentRuns`; skips are reported, never silent (FR-020, Principle V).

## Drafts

### `GET /api/drafts/:id` → draft with `body`, `headSha`, `status`, and `headShaIsCurrent`

### `PATCH /api/drafts/:id`

```jsonc
{ "body": "edited review text" }
```

`200` with the updated draft. Only allowed while `status === "ready"` (FR-025).

### `POST /api/drafts/:id/post` — **WRITES TO GITHUB**

```jsonc
{ "acknowledgeStaleHead": false }
```

- `201 { "commentUrl": "...", "commentId": 123, "postedAt": "..." }` on success (FR-027, FR-031).
- `409 { "error": "already_posted", "commentUrl": "..." }` (FR-029).
- `409 { "error": "stale_head", "draftHeadSha": "...", "currentHeadSha": "..." }` when the pull
  request moved on; the client must resend with `"acknowledgeStaleHead": true` (FR-028).
- `410 { "error": "pull_request_closed" }` when the pull request is no longer open.

This is the only route in the application that mutates GitHub state. An integration test asserts
that no module other than `server/github/post.ts` imports a mutating Octokit method (Principle III).

### `POST /api/drafts/:id/discard`

`200 { "status": "discarded" }`. Nothing is sent to GitHub (FR-026).

## Event stream

### `GET /api/events` — `text/event-stream`

Each message is `event: <name>` plus a JSON `data:` line. Clients apply updates in place; no event
requires a full board reload (FR-035).

| Event | Payload | Meaning |
|---|---|---|
| `pr.updated` | `PullRequestView` | One pull request changed; replace that row |
| `pr.removed` | `{ repo, number }` | Merged, closed, or no longer matching the query |
| `run.updated` | `{ runId, repo, number, status, error? }` | Run lifecycle transition |
| `draft.ready` | `{ draftId, runId, repo, number, headSha }` | A review is available to preview |
| `draft.resolved` | `{ draftId, status, commentUrl? }` | Posted or discarded |
| `refresh.completed` | `{ at, changedCount, rateLimit }` | A polling cycle finished (`changedCount: 0` is the normal quiet case) |
| `error` | `{ scope, message }` | Refresh or repository-level failure; board stays on last known state (FR-041, FR-042) |

The stream sends a comment heartbeat every 15s so proxies and sleeping laptops do not silently
drop it. Reconnection is the browser's native SSE retry; on reconnect the client calls
`GET /api/board` once to resynchronize.

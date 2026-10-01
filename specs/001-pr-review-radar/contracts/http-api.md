# Contract: Local HTTP API

Base URL `http://127.0.0.1:4317`. All responses JSON unless noted. No authentication — the server
is bound to loopback and acts as the operator (Principle I, FR-045).

Only the two routes marked **WRITES TO GITHUB** cause any outbound mutation (Principle III).

## Board

### `GET /api/board?q=<search query>`

Returns the current board from cache, with status computed on read.

`q` is the query the browser holds in local storage, URL-encoded. The server adopts it for the
session; when it differs from the query already in use, the cache is dropped and a refresh is
scheduled, so this first response may legitimately be empty while the new query loads. Omitting
`q` reads the board with whatever query the session already adopted — what a second tab or a
`curl` does. The response's `query` is `null` until a browser supplies one.

```jsonc
{
  "operator": { "login": "octocat", "avatarUrl": "..." },
  "query": "org:IntusCare is:pr is:open label:squad-x",  // null until a browser supplies one
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

```jsonc
{ "query": "org:acme is:pr is:open label:squad-x" }  // optional; adopts the query first
```

Triggers an immediate polling cycle (FR-037). `202 { "accepted": true }`. The result arrives on
the event stream, not in this response. Returns `409 { "error": "no_query" }` when no usable
query is set — a blank query, or one still carrying the example's placeholders (FR-002c).

## Configuration

### `GET /api/config` → current `OperatorConfig` (never includes a token or a query)

### `PUT /api/config`

Body: partial config — refresh interval, concurrency, timeouts, port, prompt paths. Validated by
Zod; invalid bodies return `400` with field errors. A `searchQuery` key sent here is stripped and
never persisted: the query belongs to the browser (FR-002).

### `GET /api/health`

```jsonc
{
  "ok": true,
  "hasQuery": true,
  "lastRefreshError": null,
  "activeRuns": 0,
  "queuedRuns": 0,
  "source": { "name": "polling", "healthy": true, "lastSuccessAt": "2026-10-01T19:18:45Z" },
  "streamClients": 1
}
```

Enough to tell a running server with nothing to watch from one that is failing to refresh.

## Review runs

### `POST /api/pulls/:owner/:name/:number/review`

Repository names carry a slash, so the owner and name are separate path segments:
`/api/pulls/IntusCare/carehub/5017/review`.

```jsonc
{ "kind": "review" | "rereview", "force": false }
```

- `202 { "runId": "run_01J..." }` when enqueued.
- `409 { "error": "run_in_progress", "runId": "..." }` when one is already active for this pull
  request (FR-019).
- `409 { "error": "already_reviewed", "headSha": "abc1234" }` when a succeeded run already covers
  the current head SHA and `force` is false (FR-022). Resending with `"force": true` enqueues
  (FR-023).
- `404 { "error": "unknown_pull_request" }` when the pull request is not on the board.

### `POST /api/runs/:runId/cancel`

`200 { "status": "cancelled" }`. Idempotent; a finished run returns its terminal status (FR-016).

### `GET /api/runs/:runId`

Full run record including `stderrTail` and `error` when failed (FR-018), plus `draftId` once a
draft exists.

### `GET /api/runs`

`{ "active": 1, "queued": 3 }` — queue depth for the UI's progress indicator.

### `POST /api/bulk/review`

```jsonc
{ "group": "needs_review" | "awaiting_rereview", "includeDrafts": false }
```

`202 { "enqueued": ["run_...", "run_..."], "skipped": [{ "repo": "...", "number": 1, "reason": "already_reviewed" }] }`.
Respects `maxConcurrentRuns`; skips are reported, never silent (FR-020, Principle V).

## Drafts

### `GET /api/drafts` → every draft awaiting a decision (the preview tray)

### `GET /api/drafts/:id` → draft with `body`, `headSha`, `status`, `headShaIsCurrent`, `currentHeadSha`, and `postedCommentUrl`

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

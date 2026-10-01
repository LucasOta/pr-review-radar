# Contract: ChangeSource

This interface is the seam that keeps Principle IV honest: polling ships now, webhooks land later,
and nothing downstream of the bus knows which one produced an event.

```ts
export type PullRequestChanged = {
  type: 'pull_request.changed'
  repo: string          // "owner/name"
  number: number
  headSha: string
  updatedAt: string     // ISO 8601, from GitHub
  source: 'polling' | 'webhook'
}

export type PullRequestRemoved = {
  type: 'pull_request.removed'
  repo: string
  number: number
  source: 'polling' | 'webhook'
}

export type ChangeEvent = PullRequestChanged | PullRequestRemoved

export interface ChangeSource {
  readonly name: 'polling' | 'webhook'
  /** Begin producing events. Resolves once the source is live. */
  start(emit: (event: ChangeEvent) => void, signal: AbortSignal): Promise<void>
  /** Force a production cycle now, if the source supports it. No-op otherwise. */
  refreshNow?(): Promise<void>
  /** Health for the status bar. */
  status(): { healthy: boolean; lastSuccessAt?: string; lastError?: string }
}
```

A pull request leaving the watched set is a change like any other, so removal is part of the same
union rather than a side channel — otherwise a future webhook source could report that a pull
request closed but have no way to say so.

## Rules for implementations

1. **Emit only on real change.** A source MUST NOT emit for a pull request whose `headSha` and
   `updatedAt` both match what it last emitted (FR-033, Principle V).
2. **Never post.** A source reads GitHub and emits. It has no access to the posting client.
3. **Survive failure.** A failed cycle MUST be reported through `status()` and MUST NOT throw out
   of `start`. The board keeps serving its last snapshot (FR-041).
4. **Honor the signal.** `start` MUST stop cleanly when the `AbortSignal` fires.
5. **No query, no traffic.** The watched query is supplied by the browser, so a source MUST idle
   — not poll, not error — until one is set, and MUST pick up a change of query without a
   restart.

## Rules for consumers

1. **Idempotent.** Handling the same event twice MUST produce one re-evaluation, one run at most,
   and never a second posted comment (FR-036).
2. **Source-blind.** No consumer may branch on `event.source` for anything but display.
3. **Survive each other.** A consumer that throws must not stop the others; the bus reports the
   failure and keeps fanning out.

## Implementations

### `PollingSource` (this feature)

Runs one batched GraphQL query every `refreshIntervalMs` against the session's active query,
diffs against the cached snapshots,
writes new snapshots, and emits one event per changed pull request. Also emits removals for pull
requests that dropped out of the result set. Implements `refreshNow()` for `POST /api/refresh`.

Deduplication lives in the bus, not the source: identity is `(repo, number, headSha, updatedAt)`
for a change and `(repo, number)` for a removal, with a bounded memory of recent identities. A
pull request that leaves and returns is not mistaken for a duplicate in either direction.

### `WebhookSource` (future, out of scope)

Receives `pull_request`, `pull_request_review`, and `issue_comment` deliveries, verifies the
signature, maps each to one `PullRequestChanged`, and emits it. Adding it means registering a
second source with the bus — no change to `domain/status.ts`, `review/queue.ts`, the HTTP routes,
or the UI. That property is the acceptance test for this contract.

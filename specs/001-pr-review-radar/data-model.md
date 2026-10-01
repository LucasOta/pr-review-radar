# Phase 1 Data Model: PR Review Radar

Two kinds of state live in `data/radar.sqlite`:

- **Cache** — a projection of GitHub facts. Rebuildable; deleting it costs nothing (Principle II).
- **App-owned** — review runs, drafts, and post records. These are the only rows whose loss is
  visible to the operator, and the spec accepts that loss (FR-043).

Status is **never stored**. It is computed on read by `domain/status.ts` from cached facts plus
app-owned rows, so the board can never disagree with GitHub about something GitHub knows.

## Entities

### PullRequestSnapshot (cache)

The latest known facts about one open pull request matching the operator's query.

| Field | Type | Notes |
|---|---|---|
| `repo` | text | `owner/name`; with `number` forms the identity |
| `number` | integer | |
| `node_id` | text | GitHub GraphQL id |
| `title` | text | |
| `author` | text | login |
| `is_draft` | integer | 0/1 |
| `url` | text | |
| `created_at` | text | ISO 8601 |
| `updated_at` | text | ISO 8601; change signal |
| `head_sha` | text | change signal |
| `base_ref` | text | |
| `reviews_json` | text | array of `{author, state, submittedAt}` |
| `commits_json` | text | array of `{sha, committedAt}` for commits after the oldest tracked review |
| `ai_comment_markers_json` | text | markers found in comments, used to recover review history after a DB wipe |
| `fetched_at` | text | when this snapshot was written |

Primary key `(repo, number)`. Rows are deleted when a pull request stops matching the query, is
merged, or is closed.

### ReviewRun (app-owned)

One local AI review attempt against one pull request at one head SHA.

| Field | Type | Notes |
|---|---|---|
| `id` | text | ULID-style identifier |
| `repo`, `number` | text, integer | target pull request |
| `head_sha` | text | the commit this run covered (FR-021) |
| `kind` | text | `review` \| `re-review` |
| `status` | text | `queued` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| `forced` | integer | 1 when the operator overrode the already-reviewed skip (FR-023) |
| `started_at`, `finished_at` | text | nullable |
| `exit_code` | integer | nullable |
| `stderr_tail` | text | captured on failure (FR-018) |
| `error` | text | human-readable failure reason, e.g. timeout or diff too large |

Index on `(repo, number, head_sha, status)` — this is what the "already reviewed this SHA" skip
(FR-022) reads.

### ReviewDraft (app-owned)

The reviewable product of a succeeded run. Exactly one draft per succeeded run.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `run_id` | text | unique; foreign key to `review_runs` |
| `repo`, `number` | text, integer | denormalized for querying |
| `head_sha` | text | commit the text describes; compared to current head before posting (FR-028) |
| `body` | text | editable by the operator (FR-025) |
| `status` | text | `ready` \| `posted` \| `discarded` |
| `created_at`, `updated_at` | text | |

### PostedReview (app-owned)

Written only by `github/post.ts`, only after an explicit confirmation.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `draft_id` | text | unique — the database-level guarantee against double posting (FR-029) |
| `repo`, `number` | text, integer | |
| `head_sha` | text | |
| `comment_id` | integer | GitHub comment id |
| `comment_url` | text | shown on the row (FR-031) |
| `posted_at` | text | |
| `posted_as` | text | operator login |

### ChangeEvent (in-memory, not persisted)

```ts
type PullRequestChanged = {
  type: 'pull_request.changed'
  repo: string
  number: number
  headSha: string
  updatedAt: string
  source: 'polling' | 'webhook'
}
```

Deduplicated on `(repo, number, headSha, updatedAt)` by `events/bus.ts` (FR-036). Not stored —
events are a transport concern, and persisting them would invite treating them as truth.

### OperatorConfig (local file, gitignored)

`config/config.json`, validated by Zod:

| Key | Default | Notes |
|---|---|---|
| `searchQuery` | `org:YOUR_ORG is:pr is:open label:YOUR_LABEL` | FR-001 |
| `refreshIntervalMs` | `60000` | |
| `maxConcurrentRuns` | `3` | FR-020 |
| `runTimeoutMs` | `600000` | FR-017 |
| `maxDiffBytes` | `400000` | spec edge case |
| `reviewPromptPath` | `prompts/review.md` | FR default prompt, overridable |
| `rereviewPromptPath` | `prompts/re-review.md` | |
| `port` | `4317` | bound to `127.0.0.1` (FR-045) |
| `includeDraftsInBulk` | `false` | spec assumption |

## Derived status

`domain/status.ts` is pure, takes `(snapshot, runs, drafts, posts)`, and returns exactly one of:

| Status | Condition |
|---|---|
| `running` | A run for this pull request is `queued` or `running` |
| `error` | The most recent run for the current head SHA is `failed` and nothing newer succeeded |
| `awaiting_rereview` | A `CHANGES_REQUESTED` review exists **and** ≥1 commit is dated after its `submittedAt` (FR-007) |
| `ready_for_human` | Current head SHA has a posted review and no `CHANGES_REQUESTED` review covers it (FR-008) |
| `needs_review` | Anything else, including a new head SHA with no review covering it |

Precedence is top to bottom; the first match wins, which guarantees FR-006's "exactly one status".
`staleness.ts` separately returns the count of commits after the changes-requested review for
display (FR-009).

## Lifecycle invariants

1. A draft may transition `ready → posted` or `ready → discarded`, never out of a terminal state.
2. A `PostedReview` row may only be inserted by `github/post.ts`, and only for a draft in `ready`.
3. Cancelling a run leaves no draft.
4. Deleting every cache row and restarting reproduces the same board; app-owned rows survive
   because they are keyed by `(repo, number, head_sha)`, not by cache row ids.

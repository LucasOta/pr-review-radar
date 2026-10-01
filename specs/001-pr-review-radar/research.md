# Phase 0 Research: PR Review Radar

Each decision below resolves an unknown in the Technical Context. No `NEEDS CLARIFICATION`
remains.

## 1. GitHub read path: GraphQL search vs REST search + per-PR REST

**Decision**: One batched GraphQL `search` query per polling cycle, returning for each pull
request the fields status classification needs: `number`, `title`, `author`, `isDraft`,
`updatedAt`, `headRefOid`, `reviews(last: 30)` with `state`/`submittedAt`/`author`, `comments`
filtered client-side for the app's marker, and `commits(last: 1)` plus commit history timestamps.

**Rationale**: REST would cost one search call plus three calls per pull request per cycle
(reviews, commits, comments) — ~150 requests per cycle at 50 pull requests, which blows the
5000/hour limit in under an hour. The GraphQL equivalent is a single request costing roughly 1–3
points. Principle V (incremental work) is satisfied structurally rather than by optimization.

**Alternatives rejected**:
- *REST + aggressive ETag caching*: 304s are free against the REST limit, but the request count
  still dominates wall time and complicates the "only re-evaluate what changed" rule.
- *GitHub Checks/Events API*: does not carry review state; still needs a second source.

## 2. Change detection: polling now, webhooks later

**Decision**: `PollingSource` runs every `refreshIntervalMs` (default 60000), diffs the fetched
facts against the cached snapshot, and emits `PullRequestChanged` only when `updatedAt` or
`headSha` moved. A future `WebhookSource` implements the same interface. The bus deduplicates on
`(repo, number, headSha, updatedAt)` with a short-lived seen-set.

**Rationale**: A local app has no public URL; webhooks require a tunnel plus repo-admin rights per
teammate, which conflicts with "clone and run". Polling at 60s meets SC-002 (one minute) and costs
~480 GraphQL requests per working day. Keeping the interface narrow (one event type, four fields)
means the webhook addition is a new file, not a refactor — Principle IV.

**Alternatives rejected**:
- *smee.io relay in v1*: adds a third-party hop for private repo metadata and a per-teammate setup
  step.
- *Polling without an event abstraction*: fastest to write, but hard-wires the staleness logic to
  the poller and makes the later webhook work a rewrite.

## 3. Review execution: `claude -p` over a fetched diff

**Decision**: Fetch the unified diff over REST with `Accept: application/vnd.github.v3.diff` and
an `If-None-Match` ETag, then spawn `claude -p <prompt> --output-format json` with the diff and
pull request metadata on stdin. No local clone of the target repository.

**Rationale**: Cloning every teammate's repository is slow, needs disk, and breaks for repos the
operator has not checked out. The diff plus title/body/base is what a review of a pull request
actually needs. Headless `-p` gives a single deterministic invocation with a capturable exit code,
satisfying FR-015 through FR-018.

**Trade-off accepted**: Without a worktree the reviewer sees no surrounding file context. A
configurable `diffContextLines` and a documented future option to review inside a clone are noted
in the spec's assumptions rather than built now.

**Size cap**: diffs above `maxDiffBytes` (default 400 KB) fail the run with an explicit
"diff exceeds configured limit" message instead of silently truncating — the spec's edge case.

## 4. Storage: `node:sqlite`

**Decision**: The built-in `node:sqlite` module, requiring Node >= 24, with a tiny hand-rolled
migration runner.

**Rationale**: `better-sqlite3` is faster but is a native addon — a compile step or prebuilt
binary per platform, which pushes against "clone and run" and the constitution's "no additional
runtime". JSON files would make the run/draft history awkward to query. `node:sqlite` is zero
dependencies and ships with the Node the operator already needs.

**Risk**: `node:sqlite` is still stabilizing across Node releases. Mitigated by pinning the
engine range in `package.json` and keeping all database access behind `store/repos.ts`, so a swap
is one module.

## 5. Live updates to the browser: SSE

**Decision**: Server-Sent Events on `GET /api/events`, one stream per open board, carrying typed
`pr.updated`, `run.updated`, `draft.ready`, `refresh.completed`, and `error` events. Actions use
ordinary `POST` routes.

**Rationale**: The data flow is one-way server-to-client; WebSockets add reconnection and framing
complexity for no gain. SSE reconnects natively, survives the server restarting during
development, and is trivially debuggable with `curl`.

## 6. Credentials

**Decision**: At startup, read `GITHUB_TOKEN` if present, otherwise shell out to `gh auth token`.
Keep the value in process memory only; never log it, never write it to the database or config
file, never send it to the browser. The UI shows only the resolved login from `viewer { login }`.

**Rationale**: Principle I. Every teammate already has an authenticated `gh`; reusing it means
nothing to issue, rotate, or leak.

## 7. Posting format and duplicate protection

**Decision**: Post as an issue comment on the pull request, with a trailing HTML marker
`<!-- pr-review-radar:draft:<draftId>:sha:<headSha> -->`. Before posting, the service re-checks
that the draft's status is `ready` and that it has no `posted_at`; after a successful post it
records the comment id and URL and flips the draft to `posted`.

**Rationale**: FR-029 (no double post) and FR-031 (link to the posted comment). The marker also
lets a future cycle recognize the app's own comments as AI reviews when rebuilding from GitHub
after a database wipe (FR-043), rather than relying on local history.

**Alternatives rejected**:
- *Formal pull request review (`POST /pulls/:n/reviews`) with `REQUEST_CHANGES`*: carries approval
  semantics the operator may not intend and cannot be edited after the fact.

## 8. Re-review semantics

**Decision**: `awaiting re-review` requires both a review in `CHANGES_REQUESTED` state and at
least one commit authored after that review's `submittedAt`. New commits alone move a pull request
back to `needs AI review` only if no review covers the new head SHA; they never alone produce
`awaiting re-review`.

**Rationale**: FR-007, chosen explicitly by the operator. Keeping this rule in one pure function
(`domain/status.ts`) makes it the single place to change if the team's convention shifts.

## 9. Concurrency and single-flight

**Decision**: An in-process queue with `maxConcurrentRuns` (default 3) and a per-pull-request
single-flight guard keyed on `repo#number`. Group actions enqueue; they never bypass the limit.

**Rationale**: FR-019, FR-020. Each `claude -p` is a real subprocess with real cost; unbounded
fan-out on a 50-pull-request board would be both slow and expensive.

## 10. Rate limits and degradation

**Decision**: Install `@octokit/plugin-throttling` with handlers that log and back off rather than
throw. Surface `rateLimit { remaining, resetAt }` from the same GraphQL query in the status bar.
On a failed cycle, keep serving the last snapshot and mark the board stale with the last success
time.

**Rationale**: FR-040, FR-041, and the spec's "GitHub unreachable" edge case.

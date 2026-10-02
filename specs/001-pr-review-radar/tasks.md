---
description: "Task list for PR Review Radar implementation"
---

# Tasks: PR Review Radar

**Input**: Design documents from `/specs/001-pr-review-radar/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The constitution (Development Workflow) requires tests covering status
classification, event idempotency, and the "never post without confirmation" boundary.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Owning user story (US1–US5); `-` for shared infrastructure

## Path Conventions

Single project at repository root: `src/server/`, `src/web/`, `src/shared/`, `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A runnable skeleton with the toolchain in place.

- [x] T001 Initialize `package.json` (ESM, `"engines": { "node": ">=24" }`) with scripts `dev`, `build`, `start`, `test`, `lint`; add dependencies fastify, @octokit/graphql, @octokit/rest, @octokit/plugin-throttling, zod, react, react-dom; dev dependencies typescript, tsx, vite, @vitejs/plugin-react, vitest, eslint, prettier
- [x] T002 [P] Add `tsconfig.json` (strict, `moduleResolution: "bundler"`, paths for `@shared/*`) and `tsconfig.server.json` for the server build
- [x] T003 [P] Add `vite.config.ts` building `src/web` into `dist/web` with a dev proxy for `/api`
- [x] T004 [P] Add ESLint + Prettier config and `.editorconfig`
- [x] T005 [P] Add `vitest.config.ts` with `tests/unit` and `tests/integration` projects
- [x] T006 Extend `.gitignore` with `config/`, `data/`, `dist/` and verify `git status` is clean after a local run
- [x] T007 [P] Create `src/shared/types.ts` and `src/shared/events.ts` from contracts/http-api.md (PullRequestView, ReviewRun, ReviewDraft, Status, SSE payloads)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Everything every story needs. **No story work starts until this phase is done.**

- [x] T008 Implement `src/server/config/schema.ts` — Zod schema and defaults for OperatorConfig per data-model.md
- [x] T009 Implement `src/server/config/store.ts` — load/create/save `config/config.json`, never containing a token
- [x] T010 Implement `src/server/store/schema.sql` — tables `pull_request_snapshots`, `review_runs`, `review_drafts`, `posted_reviews` with the indexes and the unique constraint on `posted_reviews.draft_id`
- [x] T011 Implement `src/server/store/db.ts` — open `data/radar.sqlite` via `node:sqlite`, run migrations idempotently, create `data/` if absent
- [x] T012 Implement `src/server/store/repos.ts` — typed accessors for snapshots, runs, drafts, posts; the only module touching SQL
- [x] T013 Implement `src/server/preflight.ts` — verify Node >= 24, `gh` authenticated, `claude` present; resolve token from `GITHUB_TOKEN` or `gh auth token`; exit with a named, actionable message per missing tool (FR-044)
- [x] T014 Implement `src/server/github/client.ts` — Octokit GraphQL + REST factories with `@octokit/plugin-throttling`, in-memory token, `viewer { login }` lookup, rate-limit accessor (FR-003, FR-004, FR-040)
- [x] T015 Implement `src/server/http/static.ts` and `src/server/index.ts` — Fastify bound to `127.0.0.1` on the configured port, serving `dist/web`, wiring preflight and shutdown (FR-045)
- [x] T016 [P] Add `tests/fixtures/` with recorded GraphQL search payloads covering each status case
- [x] T017 [P] Write `tests/unit/config.test.ts` — schema defaults, rejection of invalid config, token never serialized

**Checkpoint**: `npm run dev` starts, refuses clearly when a prerequisite is missing, and serves an empty shell.

---

## Phase 3: User Story 1 — See the review board at a glance (P1) 🎯 MVP

**Goal**: A correct, grouped, read-only board from the configured query.

**Independent test**: Set a query, open the app, confirm every matching pull request appears in the right group.

- [x] T018 [US1] Write `src/server/github/queries.ts` — GraphQL `search` document returning number, title, author, isDraft, updatedAt, headRefOid, reviews(last:30), recent commits, comments for marker detection (FR-043: review history recoverable after a database wipe), plus `rateLimit`
- [x] T019 [US1] Implement `src/server/github/fetchBoard.ts` — paginate the search, map nodes to snapshot rows, surface per-repository access failures as `repoErrors` rather than throwing (FR-042)
- [x] T020 [US1] Implement `src/server/domain/status.ts` — pure classifier with the precedence table from data-model.md (FR-006, FR-007, FR-008)
- [x] T021 [US1] Implement `src/server/domain/staleness.ts` — count commits dated after the changes-requested review (FR-009)
- [x] T022 [US1] Implement `GET /api/board` in `src/server/http/routes.ts` — compose snapshots + runs + drafts + posts into `PullRequestView` groups with operator, query, rate limit, lastRefreshAt, stale flag
- [x] T023 [P] [US1] Implement `GET /api/config` and `PUT /api/config` routes with Zod validation and 400 field errors
- [x] T024 [US1] Build `src/web/main.tsx`, `src/web/App.tsx`, `src/web/api.ts` — fetch and render the board
- [x] T025 [P] [US1] Build `src/web/components/StatusGroup.tsx` and `PullRequestRow.tsx` — group counts, repo/number/title/author/age/head SHA/last review time, draft badge, link to GitHub (FR-005, FR-010, FR-011)
- [x] T026 [P] [US1] Build `src/web/components/StatusBar.tsx` — operator login, rate limit, last refresh, stale indicator
- [x] T027 [P] [US1] Build the empty state offering to edit the query, and a query editor bound to `PUT /api/config`
- [x] T028 [US1] Write `tests/unit/status.test.ts` — every status path, with the FR-007 negative case: new commits without a changes-requested review MUST NOT yield `awaiting_rereview` **(constitution-required)**
- [x] T029 [P] [US1] Write `tests/unit/staleness.test.ts` — commit counting boundaries, including commits exactly at the review timestamp
- [x] T030 [P] [US1] Write `tests/integration/board.test.ts` — fixtures in, grouped board out, including the partial-access case

**Checkpoint**: US1 is independently shippable — the board replaces the manual summary prompt.

### US1 amendment — the query lives in the browser

Applied after the board shipped: the query moved out of `config/config.json` into the operator's
browser so a shared repository carries nobody's query (FR-002, FR-002a–c).

- [x] T030a [US1] Remove `searchQuery` from the config schema and strip it from any config file or
      request body, so the server cannot persist a query
- [x] T030b [US1] Add `src/web/queryStorage.ts` — the only module touching `localStorage`,
      degrading to "no query" when storage is blocked
- [x] T030c [US1] Hold the active query in `BoardService` memory, dropping the snapshot cache when
      it changes (FR-002b) and refusing to call GitHub for a blank or placeholder query (FR-002c)
- [x] T030d [US1] Carry the query on `GET /api/board?q=` and `POST /api/refresh`; return
      `409 no_query` when none is usable; expose `hasQuery` on `/api/health`
- [x] T030e [US1] Restore the query from storage on load, adopt a change made in another tab, and
      offer Save / Cancel / Clear in the query editor
- [x] T030f [US1] Write `tests/unit/queryStorage.test.ts` and extend the board and config tests:
      query switch drops the cache, app-owned rows survive, no query means no GitHub call, and a
      `searchQuery` sent to `PUT /api/config` is never written to disk

---

## Phase 4: User Story 2 — Request, preview, post (P1)

**Goal**: The full manual review loop, with posting gated on explicit confirmation.

**Independent test**: Review one pull request, read the output, post it, see it on GitHub under your account.

- [x] T031 [US2] Implement `src/server/github/diff.ts` — REST diff fetch with `If-None-Match` ETag cache and `maxDiffBytes` enforcement returning an explicit oversize error (FR-034, edge case)
- [x] T032 [P] [US2] Author `prompts/review.md` and `prompts/re-review.md`, and `src/server/review/prompt.ts` to render them with pull request metadata and diff
- [x] T033 [US2] Implement `src/server/review/runner.ts` — spawn `claude -p ... --output-format json`, stream stdin, enforce `runTimeoutMs`, support cancel via AbortSignal, capture exit code and stderr tail (FR-014, FR-016, FR-017, FR-018)
- [x] T034 [US2] Implement `src/server/review/queue.ts` — bounded concurrency, per-pull-request single-flight, already-reviewed-SHA skip with `force` override, run state transitions persisted (FR-019, FR-020, FR-021, FR-022, FR-023)
- [x] T035 [US2] Implement `POST /api/pulls/:owner/:name/:number/review` (FR-012, FR-013), `POST /api/runs/:runId/cancel`, `GET /api/runs/:runId` per contracts/http-api.md, including the 409 bodies
- [x] T036 [US2] Create a `ReviewDraft` on run success and expose `GET /api/drafts/:id` with `headShaIsCurrent`
- [x] T037 [US2] Implement `PATCH /api/drafts/:id` (body edit, `ready` only) and `POST /api/drafts/:id/discard` (FR-025, FR-026)
- [x] T038 [US2] Implement `src/server/github/post.ts` — the **only** module importing a mutating Octokit method; appends the `<!-- pr-review-radar:draft:<id>:sha:<sha> -->` marker, inserts `posted_reviews`, returns comment id and URL (FR-027, FR-029, FR-031)
- [x] T039 [US2] Implement `POST /api/drafts/:id/post` — requires `status === "ready"`, 409 `already_posted`, 409 `stale_head` unless `acknowledgeStaleHead`, 410 when the pull request is closed (FR-024, FR-028, FR-030)
- [x] T040 [US2] Build `src/web/components/ReviewPreview.tsx` — rendered review, edit, Post, Discard, stale-head warning, failure view with captured output and Retry
- [x] T041 [P] [US2] Add per-row run controls to `PullRequestRow.tsx` — Request AI review, Cancel, Re-run, with in-progress state
- [x] T042 [US2] Write `tests/integration/posting-guard.test.ts` — no draft posts without an explicit call; double post returns 409 and creates one comment; stale head requires acknowledgment; a static check asserts no module outside `github/post.ts` imports a mutating client **(constitution-required)**
- [x] T043 [P] [US2] Write `tests/unit/queue.test.ts` — concurrency cap, single-flight rejection, already-reviewed skip, force override
- [x] T044 [P] [US2] Write `tests/unit/runner.test.ts` with a fake subprocess — timeout, non-zero exit, cancellation, oversize diff

**Checkpoint**: US1 + US2 deliver the complete manual workflow the operator runs today.

---

## Phase 5: User Story 3 — Updates without re-running anything (P1)

**Goal**: The board keeps itself current; only changed pull requests are re-evaluated.

**Independent test**: Push a commit to a watched pull request from elsewhere; the row moves within one interval.

- [x] T045 [US3] Implement `src/server/events/ChangeSource.ts` — interface plus the `ChangeEvent` union (changed + removed) as in contracts/change-source.md, the seam that makes webhook delivery additive (FR-039)
- [x] T046 [US3] Implement `src/server/events/bus.ts` — dedupe on `(repo, number, headSha, updatedAt)`, fan-out, consumer error isolation (FR-036)
- [x] T047 [US3] Implement `src/server/events/PollingSource.ts` — interval cycle, snapshot diffing, emit only on changed `updatedAt`/`headSha`, emit removals for disappeared pull requests, `refreshNow()`, `status()` with lastSuccessAt/lastError (FR-032, FR-033, FR-041)
- [x] T048 [US3] Implement `src/server/http/sse.ts` — `GET /api/events` with `pr.updated`, `pr.removed`, `run.updated`, `draft.ready`, `draft.resolved`, `refresh.completed`, `error`, plus a 15s heartbeat
- [x] T049 [US3] Emit run and draft lifecycle events from the queue and draft services into the SSE hub, so the board shows live run state (FR-015)
- [x] T050 [US3] Implement `POST /api/refresh` delegating to `refreshNow()` (FR-037) — landed early because US1 needs a way to populate the cache; US3 repoints it at `PollingSource.refreshNow()`
- [x] T051 [US3] Build `src/web/useEventStream.ts` — subscribe, apply updates in place, resynchronize via `GET /api/board` on reconnect (FR-035)
- [x] T052 [P] [US3] Wire staleness and last-refresh display plus a manual Refresh button into `StatusBar.tsx` (FR-038)
- [x] T053 [US3] Write `tests/unit/bus.test.ts` — the same event twice yields one re-evaluation and no duplicate run **(constitution-required)**
- [x] T054 [P] [US3] Write `tests/integration/polling.test.ts` — unchanged cycle emits nothing and performs no deep re-evaluation (FR-033, Principle V); changed head emits exactly one event; merged pull request emits a removal
- [x] T055 [P] [US3] Write `tests/integration/degradation.test.ts` — GitHub failure keeps the last board, marks stale, and backs off (FR-040, FR-041)

**Checkpoint**: The original problem is solved — no prompt re-runs to learn what changed.

---

## Phase 6: User Story 4 — Clear the backlog in one pass (P2)

**Goal**: Group actions that still require per-review confirmation.

**Independent test**: Trigger the group action with several pull requests needing review; each yields its own preview and nothing posts automatically.

- [x] T056 [US4] Implement `POST /api/bulk/review` in `src/server/review/bulk.ts` — enqueue a group, honor `includeDraftsInBulk`, return `enqueued` and `skipped` with reasons (FR-020, no silent caps)
- [x] T057 [P] [US4] Add group-level action buttons and a queue progress indicator to `StatusGroup.tsx`
- [x] T058 [P] [US4] Build a drafts tray listing every pending preview so bulk results are reachable one by one
- [x] T059 [P] [US4] Write `tests/integration/bulk.test.ts` — concurrency respected, one failure does not stop the rest, zero drafts auto-posted, skips reported

---

## Phase 7: User Story 5 — Make it the team's tool (P2)

**Goal**: A teammate goes from clone to posted review in under ten minutes with their own credentials.

**Independent test**: Fresh clone on a second machine with a different GitHub account completes the loop touching no committed file.

- [x] T060 [US5] Write `README.md` — what it does, prerequisites, clone/install/run, the review loop, troubleshooting, derived from quickstart.md
- [x] T061 [P] [US5] Ship `config/config.example.json` for server-side settings and document the query example (placeholder org and label) shown in the UI (FR-001, FR-002)
- [x] T062 [P] [US5] Make every preflight failure message name the missing tool and its install command (FR-044)
- [x] T063 [P] [US5] Add `npm run doctor` — report Node version, `gh` login, `claude` version, config/database/bundle/prompt paths, port, concurrency, and current rate limit, naming anything missing
- [x] T064 [US5] Verify on a clean clone that no credential or personal configuration is ever staged; add `tests/integration/no-secrets.test.ts` asserting the config loader writes only outside the repository's tracked paths and that no file on disk ever contains the search query

---

## Phase 8: Polish

- [x] T065 [P] Keyboard navigation and focus management on the board and preview
- [x] T066 [P] Loading, empty, and error states for every group and the preview pane
- [x] T067 [P] Structured server logging with run ids, with the token redacted everywhere
- [x] T068 [P] Performance pass: 50 pull requests render without jank; one polling cycle issues one GraphQL request
- [x] T069 Run `/speckit-analyze` and resolve any spec/plan/tasks drift before merge — found plan-tree drift (8 files), 7 requirements with no task reference, no success-criteria mapping, and a constitution rule contradicted by the branch-per-story workflow; all four fixed

---

## Success criteria verification

Where each measurable outcome from spec.md is actually checked.

| Criterion | Verified by |
|---|---|
| SC-001 board readable in under 15s with no typing | Manual: board loads grouped from cache on open |
| SC-002 a changed PR visible within one minute | `refreshIntervalMs` default 60000; `tests/integration/polling.test.ts` emits on a moved head |
| SC-003 a quiet cycle does no review work | `tests/integration/polling.test.ts` (no events), `tests/integration/performance.test.ts` (one request, no rewrites) |
| SC-004 ten PRs in under five actions before preview | One group action enqueues the whole group: `tests/integration/bulk.test.ts` |
| SC-005 zero unconfirmed posts | `tests/integration/posting-guard.test.ts`, including the static write-surface scan |
| SC-006 clone to posted review in ten minutes | Verified by a clean clone: install, build, start, doctor, suite green |
| SC-007 50 PRs without exhausting quota | `tests/integration/performance.test.ts` — one GraphQL request per page per cycle |
| SC-008 correct board after deleting local storage | Comment markers restore coverage: `tests/unit/status.test.ts`, `tests/integration/board.test.ts` |
| SC-009 the manual summary prompt is retired | Operator judgement once US3 is in daily use |

## Dependencies

| Phase | Depends on |
|---|---|
| 1 Setup | — |
| 2 Foundational | Phase 1 |
| 3 US1 | Phase 2 |
| 4 US2 | Phase 2 (reads US1's status module; buildable in parallel with US1's UI) |
| 5 US3 | Phase 2; emits events consumed by US1's board and US2's runs |
| 6 US4 | US2 |
| 7 US5 | US1–US3 complete enough to demonstrate |
| 8 Polish | All |

## Parallel execution notes

- T002–T005 and T016–T017 are independent files — run together.
- US1's server work (T018–T023) and UI work (T024–T027) split cleanly between two people.
- US2's `runner.ts` (T033) and `diff.ts` (T031) are independent; the queue (T034) needs both.
- Every task marked [P] within a phase touches a distinct file.

## Implementation strategy

Ship **US1 alone first** — a correct board already retires the summary prompt. Add **US2** for the
review loop, then **US3** to remove the last manual re-run. US4 and US5 are convenience and
adoption, not capability. The constitution-required tests (T028, T042, T053) are the regression
surface: they encode Principles II, III, IV, and V and must stay green.

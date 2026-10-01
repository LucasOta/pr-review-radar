# Implementation Plan: PR Review Radar

**Branch**: `001-pr-review-radar` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-pr-review-radar/spec.md`

## Summary

A local-only web app that keeps a live board of the team's open pull requests and drives AI
reviews over them. A Node server queries GitHub's GraphQL API on an interval for the operator's
configured search, computes each pull request's review status from authoritative GitHub facts,
and emits normalized change events. Changed pull requests — and only those — are re-evaluated and
pushed to an open React board over Server-Sent Events. Review actions enqueue a local
`claude -p` subprocess against the pull request diff; the finished text lands in a preview pane
and reaches GitHub only when the operator confirms, posted as a comment under their own identity.
Polling sits behind a `ChangeSource` interface so a webhook receiver can be added later as a
second source without touching status logic, the review queue, or the UI.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js >= 24 (ESM throughout)

**Primary Dependencies**: Fastify (HTTP + SSE), Octokit (`@octokit/graphql`, `@octokit/rest`,
`@octokit/plugin-throttling`), React 19 + Vite (board UI), Zod (config and API payload
validation). Review execution shells out to the operator's `claude` CLI; credentials come from
`gh auth token` or `GITHUB_TOKEN`.

**Storage**: SQLite via the built-in `node:sqlite` module — no native build step, no extra
runtime. Database file lives outside version control at `data/radar.sqlite` (gitignored) and is
disposable by design.

**Testing**: Vitest. Unit tests for status classification, event dedupe, and the posting guard;
integration tests against a faked GitHub transport and a faked review runner.

**Target Platform**: macOS and Linux developer machines; browser is the operator's own, UI served
from `127.0.0.1`.

**Project Type**: Local web application — single Node process serving an API, an SSE stream, and
the built React bundle.

**Performance Goals**: Board first paint under 2s from cached state. A changed pull request is
visible on an open board within one polling interval (default 60s). A no-change polling cycle
costs one GraphQL request and zero review work.

**Constraints**: Must bind to localhost by default. Must stay inside the operator's GitHub rate
limit across an 8-hour day at the default interval (~480 GraphQL requests). Must never write to
GitHub without an explicit user action. Must run with `npm install` plus one command given Node,
`gh`, and `claude`.

**Scale/Scope**: One operator per process, one active search query, tens of open pull requests
(design target 50, hard-stop warning past 100), a handful of concurrent review runs (default 3).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | How this plan satisfies it |
|---|---|---|
| I. Local-first, credentials local | No stored secrets; no shared server | Token read at startup from `gh auth token`/`GITHUB_TOKEN`, held in memory only; `data/` and `config/` gitignored; server binds `127.0.0.1`; reviews run through the operator's own `claude` |
| II. GitHub is source of truth | Local DB must be disposable | SQLite holds a cache table (rebuildable) plus app-owned rows (runs, drafts, posts); status is computed on read from GitHub facts, never persisted as truth; deleting the DB loses only run history |
| III. No unapproved writes | Exactly one write path | A single `postDraft` service is the only module importing a GitHub mutation client; it requires a draft in `ready` state and an explicit `POST /api/drafts/:id/post`; a unit test asserts no other module imports the mutating client |
| IV. Event-driven, pluggable sources | Polling must be replaceable | `ChangeSource` emits `PullRequestChanged{repo, number, headSha, updatedAt}`; `PollingSource` implements it; the bus dedupes on `(repo, number, headSha, updatedAt)`; consumers are idempotent so a future `WebhookSource` is additive |
| V. Incremental work only | No redundant work per cycle | One batched GraphQL query per cycle; a pull request whose `updatedAt` and `headSha` are unchanged emits no event and is not re-evaluated; REST diff fetches use `If-None-Match`; a review run is skipped when a succeeded run already covers that head SHA unless forced, and the skip is shown as "reviewed at `abc123`" |

**Result**: PASS — no violations, Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-pr-review-radar/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 entities and schema
├── quickstart.md        # Phase 1 operator setup
├── contracts/
│   ├── http-api.md      # REST endpoints + SSE event stream
│   └── change-source.md # ChangeSource interface for polling/webhooks
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── shared/                   # Types shared by server and web
│   ├── types.ts              # PullRequestView, ReviewRun, ReviewDraft, Status
│   └── events.ts             # SSE event payload types
├── server/
│   ├── index.ts              # Entry: preflight, wire, listen on 127.0.0.1
│   ├── config/
│   │   ├── schema.ts         # Zod config schema + defaults
│   │   └── store.ts          # Load/save config/config.json (gitignored)
│   ├── preflight.ts          # Verify node/gh/claude, resolve token, identify operator
│   ├── github/
│   │   ├── client.ts         # Octokit factory, throttling, rate-limit reporting
│   │   ├── queries.ts        # GraphQL search + PR detail documents
│   │   ├── fetchBoard.ts     # Query -> raw PR facts
│   │   ├── diff.ts           # REST diff fetch with ETag caching + size cap
│   │   └── post.ts           # ONLY module that writes to GitHub
│   ├── domain/
│   │   ├── status.ts         # Pure classifier (needs/running/awaiting/ready/error)
│   │   └── staleness.ts      # Commits-since-changes-requested computation
│   ├── events/
│   │   ├── ChangeSource.ts   # Interface + event type
│   │   ├── PollingSource.ts  # Interval poller (first implementation)
│   │   └── bus.ts            # Dedupe + fan-out to consumers
│   ├── review/
│   │   ├── queue.ts          # Bounded concurrency, per-PR single-flight
│   │   ├── runner.ts         # Spawn claude -p, timeout, cancel, capture
│   │   └── prompt.ts         # Default review/re-review prompt templates
│   ├── store/
│   │   ├── db.ts             # node:sqlite open + migrations
│   │   ├── schema.sql        # Tables
│   │   └── repos.ts          # Typed data access
│   └── http/
│       ├── routes.ts         # REST handlers
│       ├── sse.ts            # Event stream to the board
│       └── static.ts         # Serve built web bundle
└── web/
    ├── main.tsx
    ├── App.tsx               # Board shell, status groups
    ├── api.ts                # Typed fetch wrappers
    ├── useEventStream.ts     # SSE subscription -> in-place updates
    └── components/
        ├── StatusGroup.tsx
        ├── PullRequestRow.tsx
        ├── ReviewPreview.tsx # Edit + Post + Discard
        └── StatusBar.tsx     # Operator identity, rate limit, last refresh

tests/
├── unit/                     # status, staleness, dedupe, prompt rendering
├── integration/              # faked GitHub transport + faked runner, posting guard
└── fixtures/                 # Recorded GraphQL payloads
```

**Structure Decision**: Single npm package, no workspaces. `src/server` is run with `tsx` in
development and compiled with `tsc` for `npm start`; `src/web` is built by Vite into `dist/web`
and served by the same Fastify process, so one command starts everything. `src/shared` is
imported by both sides, keeping the SSE and REST payload types honest across the boundary.

## Complexity Tracking

> No constitution violations. Section intentionally empty.

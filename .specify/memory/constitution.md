# PR Review Radar Constitution

## Core Principles

### I. Local-First, Credentials Stay Local (NON-NEGOTIABLE)

The application MUST run entirely on a single developer's machine with no shared server, no
shared database, and no secret committed to the repository. Every GitHub call MUST use the
operator's own credentials, resolved at runtime from their existing environment (`gh auth
token`, `GITHUB_TOKEN`) — the app MUST NOT prompt for, store, or transmit a token to any
third party. Every AI review MUST run through the operator's own locally installed `claude`
CLI. Teammates adopt the tool by cloning the repo and running it; they MUST NOT need an
account, invite, or credential issued by this project.

**Rationale**: The tool reads private source code and triggers paid AI usage. Making each
operator's own identity the only identity removes the entire class of shared-secret, access-
scope, and billing-attribution problems, and makes "share it with my team" a `git clone`.

### II. GitHub Is the Source of Truth

GitHub state (pull requests, reviews, commits, labels) MUST be treated as authoritative and
read-only unless the user explicitly acts. Local storage is a cache plus app-owned
annotations (review runs, their output, timestamps); it MUST be safe to delete the local
database at any time and rebuild it from GitHub without losing anything the user cannot
recreate. Derived status (e.g. "awaiting re-review") MUST be computed from GitHub facts, never
stored as the primary truth.

**Rationale**: A dashboard that disagrees with GitHub is worse than no dashboard. Recomputing
from authoritative facts guarantees the UI can always be trusted and makes cache corruption a
non-event.

### III. No Side Effect Without Explicit Human Approval (NON-NEGOTIABLE)

The app MUST NOT write to GitHub — comment, review, label, or request reviewers — except as
the direct result of a user action in the UI. AI-generated review content MUST be presented to
the user for preview and MUST require an explicit confirm action before it is posted to a pull
request. Automatic background work is limited to reading from GitHub and running local
analysis; posting is never automatic.

**Rationale**: The reviews carry the operator's name on a teammate's pull request. Automation
earns trust by being fast at reading and conservative at writing.

### IV. Event-Driven Core, Pluggable Change Sources

Change detection MUST be isolated behind a source interface that emits normalized "pull
request changed" events. Polling is the first implementation; a webhook receiver MUST be
addable as an additional source without modifying the staleness logic, the review pipeline, or
the UI. Consumers of events MUST be idempotent: the same event delivered twice MUST NOT
produce two review runs or two posted comments.

**Rationale**: The core user problem is "I only find out when I re-run the prompt." Treating
updates as events — rather than as a side effect of one polling loop — is what lets delivery
get faster later without a rewrite.

### V. Incremental Work Only

Any operation whose cost scales with the number of open pull requests MUST avoid redundant
work. Refresh MUST use conditional requests (ETag / `If-None-Match`) and MUST skip pull
requests whose head SHA is unchanged. An AI review MUST NOT be re-run for a head SHA that has
already been reviewed unless the user explicitly forces it. Any skipped work MUST be visible
to the user as state ("reviewed at abc123"), never silently.

**Rationale**: Re-checking every pull request on every run is the exact inefficiency this
project exists to eliminate; permitting it anywhere in the implementation reintroduces the
original problem.

## Technology and Operational Constraints

- **Stack**: TypeScript end to end — Node.js server (HTTP + background workers), React single-
  page UI, SQLite for local persistence. No additional runtime (no Python, no Docker) MAY be
  required to run the app.
- **Startup**: `npm install` followed by a single documented command MUST be sufficient to
  start the app on a machine that already has Node.js, the `gh` CLI (authenticated), and the
  `claude` CLI installed. Missing prerequisites MUST produce an actionable error naming the
  missing tool, never a stack trace.
- **Configuration**: The set of watched pull requests MUST be expressed as a user-editable
  GitHub search query. That query is owned by the operator's browser (local storage) and MUST
  NOT be written to disk by the server, committed, or shipped as a default. Server-side
  settings (ports, limits, timeouts) live in a gitignored local file. Team- or user-specific
  values MUST NOT be hardcoded anywhere.
- **Binding**: The server MUST bind to localhost by default. Any change to that default MUST be
  an explicit, documented opt-in.
- **Rate limits**: The app MUST surface remaining GitHub API quota and MUST back off rather
  than fail hard when throttled.
- **Subprocesses**: Invocation of `claude` MUST be cancellable, MUST have a timeout, and MUST
  capture stdout, stderr, and exit code for display when a run fails.

## Development Workflow

- Work follows the Spec Kit flow: constitution, then `/speckit-specify`, `/speckit-plan`,
  `/speckit-tasks`, `/speckit-implement`. Specifications describe behavior and user outcomes;
  implementation details belong in the plan, not the spec.
- Every feature MUST carry its own spec directory under `specs/`. A feature may be delivered
  across several branches — one per user story is the normal shape — and those branches share
  the feature's spec directory rather than each creating a new one. A branch that introduces a
  behavior the spec does not describe MUST update the spec in the same pull request.
- Tests MUST cover, at minimum: pull request status classification (including the re-review
  rule), event idempotency, and the "never post without confirmation" boundary. These encode
  Principles II, III, IV, and V and are the project's regression surface.
- A change that violates a principle MUST either be redesigned or accompanied by an amendment
  to this constitution in the same pull request. Silent exceptions are not permitted.

## Governance

This constitution supersedes other conventions in this repository. Amendments MUST be made by
editing this file in a pull request that states what changed and why, and MUST update the
version below.

Versioning uses semantic versioning: MAJOR for removing or redefining a principle in a
backward-incompatible way, MINOR for adding a principle or materially expanding guidance,
PATCH for clarifications and wording.

Compliance is verified at review time: the reviewer checks the change against the principles
above, with particular attention to Principle I (no shared or stored credentials) and
Principle III (no unapproved writes to GitHub).

**Version**: 1.0.2 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-02

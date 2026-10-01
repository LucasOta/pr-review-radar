# Feature Specification: PR Review Radar

**Feature Branch**: `001-pr-review-radar`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "A local UI that lists my team's open pull requests (found by a configurable GitHub search), shows which ones have an AI review, which do not, which are waiting for a re-review, and which are ready for a human to review and test. Buttons request an AI review or re-review, run locally via the Claude Code CLI, let me preview the result, and post it to the pull request. The app detects pull request updates on its own and re-evaluates the affected pull request, so I stop re-running a prompt over every pull request just to learn what changed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the review board at a glance (Priority: P1)

A reviewer opens the app and immediately sees every open pull request matching their configured
GitHub search, grouped by what it needs next: no AI review yet, AI review in progress, awaiting
re-review after changes were requested, or reviewed and ready for a human. Each row shows the
title, author, repository, branch, age, head commit, and when the last AI review ran. No manual
prompt, no per-pull-request digging.

**Why this priority**: This replaces the chat prompt the reviewer runs today. Even with every
action button removed, a board that is correct and current is already the thing they re-run a
prompt to produce.

**Independent Test**: Configure a search query, open the app, and confirm the board lists the same
pull requests as the equivalent GitHub search, each in the correct status group, with no further
input.

**Acceptance Scenarios**:

1. **Given** a configured search query matching six open pull requests, **When** the reviewer
   opens the board, **Then** all six appear, each in exactly one status group, and the total
   matches the number GitHub reports for that query.
2. **Given** a pull request with no AI review on its current head commit, **When** the board
   loads, **Then** it is grouped as needing an AI review.
3. **Given** a pull request where an AI review requested changes and the author has pushed new
   commits since, **When** the board loads, **Then** it is grouped as awaiting re-review and shows
   the commit count added since that review.
4. **Given** a pull request whose latest AI review covers its current head commit and did not
   request changes, **When** the board loads, **Then** it is grouped as ready for human review.
5. **Given** the search query returns no results, **When** the board loads, **Then** an empty
   state explains that the query matched nothing and offers to edit the query.

---

### User Story 2 - Request an AI review, preview it, post it (Priority: P1)

From a row on the board, the reviewer clicks to request an AI review. The app runs the review
locally using their Claude Code CLI against that pull request's diff, shows progress, then
presents the finished review for reading. The reviewer either posts it to the pull request as a
comment under their own GitHub identity, or discards it. Nothing reaches GitHub without that
explicit confirmation.

**Why this priority**: Together with Story 1 this is the complete manual loop the reviewer runs
today, and it is the minimum that makes the board worth opening rather than just informative.

**Independent Test**: Click review on one pull request, watch it run, read the output, post it,
and confirm the comment appears on GitHub authored by the operator.

**Acceptance Scenarios**:

1. **Given** a pull request needing a review, **When** the reviewer clicks Request AI review,
   **Then** a run starts, the row shows in-progress state, and the review output appears when it
   finishes.
2. **Given** a finished review awaiting preview, **When** the reviewer clicks Post, **Then** the
   review is posted to that pull request and the row updates to reviewed.
3. **Given** a finished review awaiting preview, **When** the reviewer clicks Discard, **Then**
   nothing is posted, and the pull request returns to needing a review.
4. **Given** a review run in progress, **When** the reviewer cancels it, **Then** the run stops,
   nothing is posted, and the row returns to its prior state.
5. **Given** the Claude Code CLI fails or exits non-zero, **When** the run ends, **Then** the row
   shows a failed state with the captured error output and a retry action, and nothing is posted.
6. **Given** a review run is already in progress for a pull request, **When** the reviewer clicks
   Request AI review again, **Then** no second run starts.

---

### User Story 3 - Learn about updates without re-running anything (Priority: P1)

While the app is open, it checks GitHub on its own. When a pull request gains commits, reviews,
or comments, that pull request — and only that pull request — is re-evaluated, its status is
recalculated, and the board updates in place. Pull requests that did not change are not
re-examined and cost nothing. The reviewer can see when the board last refreshed.

**Why this priority**: This is the problem statement. Stories 1 and 2 without it leave the
reviewer re-running work to find out what changed.

**Independent Test**: Open the board, push a commit to a watched pull request from elsewhere, and
confirm the row moves to awaiting re-review within the refresh interval without any user action.

**Acceptance Scenarios**:

1. **Given** the board is open and a watched pull request receives a new commit, **When** the next
   refresh completes, **Then** that row updates to reflect the new head commit and recomputed
   status without the reviewer reloading the page.
2. **Given** a refresh cycle where no watched pull request changed, **When** the cycle completes,
   **Then** no pull request is re-evaluated and the board is unchanged.
3. **Given** a watched pull request is merged or closed, **When** the next refresh completes,
   **Then** it leaves the board.
4. **Given** a new pull request starts matching the search query, **When** the next refresh
   completes, **Then** it appears on the board in the correct status group.
5. **Given** GitHub is unreachable or rate limited, **When** a refresh fails, **Then** the board
   keeps showing the last known state, marks itself stale with the time of the last success, and
   retries with backoff.

---

### User Story 4 - Clear the backlog in one pass (Priority: P2)

The reviewer requests AI reviews for every pull request currently needing one, and re-reviews for
every pull request awaiting one, from a single action per group. Runs proceed with a bounded
number at a time; each result still requires individual preview and confirmation before posting.

**Why this priority**: Matches how the reviewer works today — a sweep over the whole set — but it
depends entirely on Story 2 and saves clicks rather than enabling anything new.

**Independent Test**: With several pull requests needing review, use the group action and confirm
each produces its own previewable result, with nothing posted automatically.

**Acceptance Scenarios**:

1. **Given** four pull requests need an AI review, **When** the reviewer triggers the group
   action, **Then** four runs are queued, no more than the configured limit execute at once, and
   each completes into its own preview.
2. **Given** a group action is running, **When** one run fails, **Then** the remaining runs
   continue and the failure is reported on its own row.
3. **Given** a group action has produced several finished reviews, **When** the reviewer takes no
   further action, **Then** none of them are posted.

---

### User Story 5 - Make it the team's tool (Priority: P2)

A teammate clones the repository, runs one documented command, and uses the app with their own
GitHub credentials and their own Claude Code CLI. They set their own search query. Reviews they
post appear under their own GitHub identity. No credential, query, or review history is shared
through the repository.

**Why this priority**: The tool must be shareable to be worth building as a project rather than a
script, but a single operator gets full value before this is polished.

**Independent Test**: On a second machine with its own GitHub login, clone, configure a query, and
complete a review end to end without touching any file committed to the repository.

**Acceptance Scenarios**:

1. **Given** a fresh clone on a machine with an authenticated GitHub CLI and Claude Code CLI,
   **When** the teammate runs the documented start command, **Then** the app starts and prompts
   for a search query if none is configured.
2. **Given** a machine missing a required tool, **When** the app starts, **Then** it names the
   missing tool and how to install it, rather than failing obscurely.
3. **Given** a teammate has configured the app, **When** they inspect the repository working tree,
   **Then** no credential or personal configuration is staged for commit.
4. **Given** a teammate posts an AI review, **When** it appears on GitHub, **Then** it is authored
   by that teammate's own account.

---

### Edge Cases

- A pull request's head commit changes while an AI review is running: the finished review is
  marked as covering a commit that is no longer current, and the reviewer is warned before
  posting.
- A pull request is closed or merged while a review run for it is in progress: the run is
  abandoned and nothing is posted.
- The search query matches many pull requests (dozens or more): the board stays responsive and
  refresh respects rate limits rather than issuing one request per pull request per cycle.
- The diff is very large or binary-heavy: the run reports that it exceeded the size the reviewer
  configured rather than hanging or silently truncating without saying so.
- A pull request is a draft: it is shown and labeled as draft, and group actions skip it by
  default.
- The same pull request changes twice inside one refresh interval: it is re-evaluated once, not
  twice, and never produces duplicate runs or duplicate posted comments.
- The local database is deleted: the board rebuilds from GitHub on next start, losing only stored
  review text and run history.
- A review was posted, then the reviewer clicks post again on the same preview: the second attempt
  is refused rather than creating a duplicate comment.
- The configured query is invalid or the token lacks access to a matched repository: the specific
  failure is shown, and the rest of the board still loads.
- Two pull requests in different repositories share a number: they remain distinct everywhere.

## Requirements *(mandatory)*

### Functional Requirements

**Discovery and configuration**

- **FR-001**: The system MUST discover pull requests using a user-supplied GitHub search query,
  editable from the UI, with a documented default template based on an organization and a label.
- **FR-002**: The system MUST store configuration locally per operator and MUST NOT include any
  operator configuration or credential in version control.
- **FR-003**: The system MUST authenticate to GitHub using the operator's own existing
  credentials and MUST NOT ask the operator to paste a token into the UI.
- **FR-004**: The system MUST show the operator which GitHub account it is acting as.

**Board and status**

- **FR-005**: The system MUST display every open pull request matching the query with repository,
  number, title, author, draft flag, age, head commit, and last AI review time.
- **FR-006**: The system MUST classify each pull request into exactly one status: needs AI review,
  AI review running, awaiting re-review, ready for human review, or error.
- **FR-007**: The system MUST classify a pull request as awaiting re-review when a review
  requesting changes exists and at least one commit has landed after it; a pull request with new
  commits but no changes-requested review MUST NOT be classified as awaiting re-review.
- **FR-008**: The system MUST classify a pull request as ready for human review when its current
  head commit has been reviewed and no review on that commit requests changes.
- **FR-009**: The system MUST show, for each pull request awaiting re-review, how many commits
  landed after the review that requested changes.
- **FR-010**: The system MUST group or filter the board by status so the reviewer can see each
  group's count without reading every row.
- **FR-011**: The system MUST link each row to the pull request on GitHub.

**Review runs**

- **FR-012**: Users MUST be able to request an AI review for an individual pull request.
- **FR-013**: Users MUST be able to request a re-review for a pull request awaiting one, scoped to
  what changed since the review that requested changes.
- **FR-014**: The system MUST execute reviews locally through the operator's Claude Code CLI and
  MUST NOT send pull request content to any service other than the ones that CLI and GitHub
  already use.
- **FR-015**: The system MUST show live run state — queued, running, succeeded, failed, cancelled
  — for each run.
- **FR-016**: Users MUST be able to cancel a running review.
- **FR-017**: The system MUST enforce a timeout on each review run and report a timed-out run as
  failed with its captured output.
- **FR-018**: The system MUST capture and display the CLI's output and exit status when a run
  fails.
- **FR-019**: The system MUST NOT start a second concurrent run for a pull request that already
  has one in progress.
- **FR-020**: The system MUST limit how many review runs execute concurrently, with the limit
  configurable.
- **FR-021**: The system MUST record which head commit each review run covered.
- **FR-022**: The system MUST NOT automatically re-run a review for a head commit it has already
  reviewed unless the operator explicitly forces it.
- **FR-023**: Users MUST be able to re-run a review for a pull request at any time, overriding
  FR-022.

**Posting**

- **FR-024**: The system MUST present every completed review for preview and MUST require an
  explicit confirmation before posting anything to GitHub.
- **FR-025**: Users MUST be able to edit the review text before posting.
- **FR-026**: Users MUST be able to discard a completed review without posting.
- **FR-027**: The system MUST post the review to the pull request under the operator's own GitHub
  identity.
- **FR-028**: The system MUST warn before posting a review whose covered commit is no longer the
  pull request's head.
- **FR-029**: The system MUST prevent the same completed review from being posted twice.
- **FR-030**: The system MUST NOT write to GitHub — comment, review, label, assign, or request a
  reviewer — except as the direct result of an explicit user action.
- **FR-031**: The system MUST record and display, per pull request, when a review was posted and
  link to the posted comment.

**Change detection**

- **FR-032**: The system MUST detect changes to watched pull requests on its own while running,
  without the operator triggering a refresh.
- **FR-033**: The system MUST re-evaluate only the pull requests that changed.
- **FR-034**: The system MUST avoid refetching unchanged data, using conditional requests where
  GitHub supports them.
- **FR-035**: The system MUST update the board in place when a pull request's status changes,
  without a page reload.
- **FR-036**: The system MUST treat a duplicate change notification for the same pull request and
  commit as a single event, producing no duplicate work.
- **FR-037**: The system MUST allow the operator to trigger an immediate refresh.
- **FR-038**: The system MUST show when it last successfully refreshed and indicate when its data
  is stale.
- **FR-039**: The system MUST support adding push-based change notification later without
  changing how status is computed or how reviews are run.

**Resilience and operations**

- **FR-040**: The system MUST display remaining GitHub API quota and MUST back off instead of
  failing hard when throttled.
- **FR-041**: The system MUST keep serving the last known board state when GitHub is unreachable.
- **FR-042**: The system MUST report a per-repository access failure without preventing the rest
  of the board from loading.
- **FR-043**: The system MUST rebuild its board from GitHub if local storage is missing or
  deleted, losing only stored review text and run history.
- **FR-044**: The system MUST verify required local tools at startup and name any that are missing
  along with how to install them.
- **FR-045**: The system MUST listen on the local machine only by default.

### Key Entities

- **Watched pull request**: An open pull request matching the operator's query. Identified by
  repository plus number. Carries title, author, draft flag, head commit, timestamps, and the
  review signals needed to compute status. Sourced from GitHub; never authoritative locally.
- **Review run**: One local AI review attempt against one pull request at one head commit. Has a
  lifecycle (queued, running, succeeded, failed, cancelled), captured output, and timing.
- **Review draft**: The reviewable result of a succeeded run — editable text, the commit it
  covers, and whether it has been posted or discarded.
- **Posted review**: The record that a draft was published to GitHub — when, by whom, and a link
  to the resulting comment.
- **Change event**: A normalized signal that a specific pull request changed, carrying enough
  identity to be deduplicated. Produced by polling now; by push notification later.
- **Operator configuration**: The search query, concurrency limit, refresh interval, and review
  prompt settings for one person on one machine. Local only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can open the app and know what every matching pull request needs next in
  under 15 seconds, without typing anything.
- **SC-002**: A pull request that gains a commit is reflected on an open board within one minute
  with no user action.
- **SC-003**: A refresh cycle in which nothing changed performs no AI review work and re-examines
  no pull request in depth.
- **SC-004**: Reviewing a backlog of ten pull requests takes fewer than five user actions before
  the preview stage, versus one prompt plus one request per pull request today.
- **SC-005**: Zero reviews are posted to GitHub without an explicit confirmation, verified by
  test.
- **SC-006**: A teammate goes from clone to a posted AI review on their own account in under ten
  minutes using only the README.
- **SC-007**: The board renders 50 matching pull requests without the refresh cycle exhausting the
  operator's GitHub API quota over an eight-hour working day.
- **SC-008**: After deleting local storage, the board returns to a correct state on the next
  start, with only review history lost.
- **SC-009**: The reviewer no longer re-runs a summary prompt to learn what changed — measured by
  the manual chat workflow being retired.

## Assumptions

- The operator has the GitHub CLI installed and authenticated, and the Claude Code CLI installed
  and working; the app uses them rather than managing credentials itself.
- All watched pull requests live on github.com and are reachable by the operator's credentials.
- "AI review" means a review authored by a run of the operator's local Claude Code CLI and posted
  as a comment under the operator's own identity; no bot account exists for this.
- The app is used while the operator is at their machine. It is not a background service and makes
  no promises about pull requests that change while it is closed beyond catching up at next start.
- Change detection starts as polling on a configurable interval; push-based delivery is a later
  addition behind the same interface, not part of this feature's scope.
- A single operator uses one query at a time; multiple saved queries are out of scope for v1.
- Status groups are derived from GitHub data only; the app does not ask people to mark pull
  requests as done.
- Draft pull requests are shown but excluded from group actions by default.
- Review prompt content is configurable per operator, with a sensible default shipped in the
  repository.

import type { PostedReview, PullRequestStatus, ReviewRun } from '../../shared/types.js'
import type { PullRequestSnapshot } from '../store/repos.js'
import { commitsSinceChangesRequested, headCommittedAt, latestChangesRequested } from './staleness.js'

export interface StatusInputs {
  snapshot: PullRequestSnapshot
  /** Runs for this pull request, any order. */
  runs: ReviewRun[]
  /** Posted AI reviews for this pull request, any order. */
  posted: PostedReview[]
}

export interface StatusResult {
  status: PullRequestStatus
  commitsSinceChangesRequested: number
  /** Why this status was chosen — surfaced in the UI and in test failures. */
  reason: string
}

/**
 * Pure classifier. Exactly one status per pull request (FR-006).
 *
 * Precedence, first match wins:
 *   1. running           — a run is queued or in flight
 *   2. error             — the newest run against the current head failed, none succeeded
 *   3. ready_for_human   — the current head carries an AI review and nothing requested changes
 *                          on it (FR-008)
 *   4. awaiting_rereview — a review requested changes AND commits landed after it (FR-007)
 *   5. needs_review      — everything else
 *
 * ready_for_human is checked before awaiting_rereview so that a pull request which *was*
 * re-reviewed at its new head leaves the awaiting group instead of sticking there forever.
 * New commits alone never produce awaiting_rereview — that is the operator's explicit rule.
 */
export function classify(inputs: StatusInputs): StatusResult {
  const { snapshot, runs, posted } = inputs
  const commitsSince = commitsSinceChangesRequested(snapshot)

  const active = runs.find((run) => run.status === 'queued' || run.status === 'running')
  if (active) {
    return { status: 'running', commitsSinceChangesRequested: commitsSince, reason: 'run in flight' }
  }

  const runsForHead = runs
    .filter((run) => run.headSha === snapshot.headSha)
    .sort(byFinishedDesc)
  const newestForHead = runsForHead[0]
  const succeededForHead = runsForHead.some((run) => run.status === 'succeeded')
  if (newestForHead?.status === 'failed' && !succeededForHead) {
    return {
      status: 'error',
      commitsSinceChangesRequested: commitsSince,
      reason: newestForHead.error ?? 'last run failed',
    }
  }

  if (headIsCovered(snapshot, posted)) {
    const headAt = headCommittedAt(snapshot)
    const blocking = snapshot.reviews.find(
      (review) =>
        review.state === 'CHANGES_REQUESTED' && (headAt === null || review.submittedAt >= headAt),
    )
    if (!blocking) {
      return {
        status: 'ready_for_human',
        commitsSinceChangesRequested: commitsSince,
        reason: 'current head reviewed, no changes requested on it',
      }
    }
  }

  const changesRequested = latestChangesRequested(snapshot.reviews)
  if (changesRequested && commitsSince > 0) {
    return {
      status: 'awaiting_rereview',
      commitsSinceChangesRequested: commitsSince,
      reason: `${commitsSince} commit(s) after changes were requested`,
    }
  }

  return {
    status: 'needs_review',
    commitsSinceChangesRequested: commitsSince,
    reason: 'no AI review covers the current head',
  }
}

/**
 * Whether an AI review exists for the current head. Posted reviews are the local record; the
 * markers recovered from GitHub comments make this survive a deleted database (FR-043).
 */
export function headIsCovered(snapshot: PullRequestSnapshot, posted: PostedReview[]): boolean {
  if (posted.some((review) => review.headSha === snapshot.headSha)) return true
  return snapshot.aiCommentMarkers.includes(snapshot.headSha)
}

function byFinishedDesc(a: ReviewRun, b: ReviewRun): number {
  const left = a.finishedAt ?? a.startedAt ?? ''
  const right = b.finishedAt ?? b.startedAt ?? ''
  return right.localeCompare(left)
}

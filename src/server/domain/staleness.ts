import type { PullRequestSnapshot, SnapshotReview } from '../store/repos.js'

/** The most recent review that requested changes, or null. */
export function latestChangesRequested(reviews: SnapshotReview[]): SnapshotReview | null {
  let latest: SnapshotReview | null = null
  for (const review of reviews) {
    if (review.state !== 'CHANGES_REQUESTED') continue
    if (!latest || review.submittedAt > latest.submittedAt) latest = review
  }
  return latest
}

/**
 * Commits landed strictly after the review that requested changes (FR-009).
 * A commit dated exactly at the review timestamp is treated as part of what was reviewed.
 */
export function commitsSinceChangesRequested(snapshot: PullRequestSnapshot): number {
  const review = latestChangesRequested(snapshot.reviews)
  if (!review) return 0
  return snapshot.commits.filter((commit) => commit.committedAt > review.submittedAt).length
}

/** Timestamp of the current head commit, when the snapshot carries it. */
export function headCommittedAt(snapshot: PullRequestSnapshot): string | null {
  const head = snapshot.commits.find((commit) => commit.sha === snapshot.headSha)
  return head?.committedAt ?? null
}

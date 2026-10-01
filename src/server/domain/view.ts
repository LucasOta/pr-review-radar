import type {
  BoardResponse,
  PostedReview,
  PullRequestStatus,
  PullRequestView,
  ReviewDraft,
  ReviewRun,
} from '../../shared/types.js'
import { STATUS_ORDER } from '../../shared/types.js'
import type { PullRequestSnapshot } from '../store/repos.js'
import { classify } from './status.js'

export interface ViewInputs {
  snapshot: PullRequestSnapshot
  runs: ReviewRun[]
  posted: PostedReview[]
  pendingDraft: ReviewDraft | null
}

export function buildView(inputs: ViewInputs): PullRequestView {
  const { snapshot, runs, posted, pendingDraft } = inputs
  const { status, commitsSinceChangesRequested } = classify({ snapshot, runs, posted })

  const lastRun = [...runs].sort(byRecency)[0] ?? null
  const lastPosted = [...posted].sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0] ?? null

  return {
    repo: snapshot.repo,
    number: snapshot.number,
    title: snapshot.title,
    author: snapshot.author,
    isDraft: snapshot.isDraft,
    url: snapshot.url,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    headSha: snapshot.headSha,
    baseRef: snapshot.baseRef,
    status,
    commitsSinceChangesRequested,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          headSha: lastRun.headSha,
          finishedAt: lastRun.finishedAt,
          error: lastRun.error,
        }
      : null,
    lastPostedReview: lastPosted
      ? {
          commentUrl: lastPosted.commentUrl,
          postedAt: lastPosted.postedAt,
          headSha: lastPosted.headSha,
        }
      : null,
    pendingDraftId: pendingDraft?.id ?? null,
  }
}

export function emptyGroups(): Record<PullRequestStatus, PullRequestView[]> {
  return Object.fromEntries(STATUS_ORDER.map((status) => [status, [] as PullRequestView[]])) as unknown as Record<
    PullRequestStatus,
    PullRequestView[]
  >
}

export function groupViews(views: PullRequestView[]): BoardResponse['groups'] {
  const groups = emptyGroups()
  for (const view of views) {
    groups[view.status].push(view)
  }
  for (const status of STATUS_ORDER) {
    groups[status].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  return groups
}

function byRecency(a: ReviewRun, b: ReviewRun): number {
  const left = a.finishedAt ?? a.startedAt ?? ''
  const right = b.finishedAt ?? b.startedAt ?? ''
  return right.localeCompare(left)
}

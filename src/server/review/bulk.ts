import type { OperatorConfig, PullRequestStatus, ReviewKind } from '../../shared/types.js'
import type { BoardService } from '../board/service.js'
import { QueueError, type ReviewQueue } from './queue.js'

/** Groups a sweep can target. Reviewing what is already reviewed is not a group action. */
export const BULK_GROUPS = ['needs_review', 'awaiting_rereview', 'error'] as const
export type BulkGroup = (typeof BULK_GROUPS)[number]

export function isBulkGroup(value: unknown): value is BulkGroup {
  return typeof value === 'string' && (BULK_GROUPS as readonly string[]).includes(value)
}

export interface BulkRequest {
  group: BulkGroup
  includeDrafts?: boolean
}

export interface BulkSkip {
  repo: string
  number: number
  reason: string
}

export interface BulkResult {
  enqueued: Array<{ runId: string; repo: string; number: number }>
  skipped: BulkSkip[]
}

const KIND_BY_GROUP: Record<BulkGroup, ReviewKind> = {
  needs_review: 'review',
  awaiting_rereview: 'rereview',
  error: 'review',
}

/**
 * One action, one run per pull request in the group. The queue still enforces the concurrency
 * ceiling, so this adds no new way to overload the machine (FR-020). Every pull request that is
 * not enqueued comes back in `skipped` with a reason — a sweep that silently covered less than
 * it appeared to is the failure mode this guards against.
 */
export async function runBulkReview(
  request: BulkRequest,
  deps: { board: BoardService; queue: ReviewQueue; config: () => OperatorConfig },
): Promise<BulkResult> {
  const board = await deps.board.board()
  const group: PullRequestStatus = request.group
  const includeDrafts = request.includeDrafts ?? deps.config().includeDraftsInBulk

  const result: BulkResult = { enqueued: [], skipped: [] }

  for (const pullRequest of board.groups[group]) {
    if (pullRequest.isDraft && !includeDrafts) {
      result.skipped.push({
        repo: pullRequest.repo,
        number: pullRequest.number,
        reason: 'draft_pull_request',
      })
      continue
    }

    if (pullRequest.pendingDraftId) {
      result.skipped.push({
        repo: pullRequest.repo,
        number: pullRequest.number,
        reason: 'review_awaiting_decision',
      })
      continue
    }

    try {
      const run = deps.queue.enqueue({
        repo: pullRequest.repo,
        number: pullRequest.number,
        kind: KIND_BY_GROUP[request.group],
      })
      result.enqueued.push({ runId: run.id, repo: pullRequest.repo, number: pullRequest.number })
    } catch (error) {
      result.skipped.push({
        repo: pullRequest.repo,
        number: pullRequest.number,
        reason: error instanceof QueueError ? error.code : 'unknown_error',
      })
    }
  }

  return result
}

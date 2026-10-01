/** Types shared by the server and the board UI. Contracts live in specs/001-pr-review-radar/contracts. */

export type PullRequestStatus =
  | 'needs_review'
  | 'running'
  | 'awaiting_rereview'
  | 'ready_for_human'
  | 'error'

export const STATUS_ORDER: PullRequestStatus[] = [
  'needs_review',
  'awaiting_rereview',
  'running',
  'ready_for_human',
  'error',
]

export const STATUS_LABELS: Record<PullRequestStatus, string> = {
  needs_review: 'Needs AI review',
  awaiting_rereview: 'Awaiting re-review',
  running: 'Review running',
  ready_for_human: 'Ready for human',
  error: 'Error',
}

export type ReviewKind = 'review' | 'rereview'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type DraftStatus = 'ready' | 'posted' | 'discarded'

export interface ReviewRun {
  id: string
  repo: string
  number: number
  headSha: string
  kind: ReviewKind
  status: RunStatus
  forced: boolean
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  stderrTail: string | null
  error: string | null
}

export interface ReviewDraft {
  id: string
  runId: string
  repo: string
  number: number
  headSha: string
  body: string
  status: DraftStatus
  createdAt: string
  updatedAt: string
}

export interface PostedReview {
  id: string
  draftId: string
  repo: string
  number: number
  headSha: string
  commentId: number
  commentUrl: string
  postedAt: string
  postedAs: string
}

/** One row on the board. Status is computed on read, never persisted. */
export interface PullRequestView {
  repo: string
  number: number
  title: string
  author: string
  isDraft: boolean
  url: string
  createdAt: string
  updatedAt: string
  headSha: string
  baseRef: string
  status: PullRequestStatus
  /** Commits landed after the review that requested changes. 0 when not applicable. */
  commitsSinceChangesRequested: number
  lastRun: Pick<ReviewRun, 'id' | 'status' | 'headSha' | 'finishedAt' | 'error'> | null
  lastPostedReview: Pick<PostedReview, 'commentUrl' | 'postedAt' | 'headSha'> | null
  pendingDraftId: string | null
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: string
}

export interface RepoError {
  repo: string
  message: string
}

export interface OperatorIdentity {
  login: string
  avatarUrl: string | null
}

export interface BoardResponse {
  operator: OperatorIdentity
  query: string
  lastRefreshAt: string | null
  stale: boolean
  rateLimit: RateLimitInfo | null
  groups: Record<PullRequestStatus, PullRequestView[]>
  repoErrors: RepoError[]
}

export interface OperatorConfig {
  searchQuery: string
  refreshIntervalMs: number
  maxConcurrentRuns: number
  runTimeoutMs: number
  maxDiffBytes: number
  reviewPromptPath: string
  rereviewPromptPath: string
  port: number
  includeDraftsInBulk: boolean
}

export const DEFAULT_QUERY_TEMPLATE = 'org:YOUR_ORG is:pr is:open label:YOUR_LABEL'

/** True when the query is still the shipped placeholder, i.e. the operator has not configured one. */
export function isPlaceholderQuery(query: string): boolean {
  return query.includes('YOUR_ORG') || query.includes('YOUR_LABEL') || query.trim() === ''
}

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

/** A draft plus what the UI needs to decide whether posting is safe. */
export interface DraftDetail extends ReviewDraft {
  headShaIsCurrent: boolean
  currentHeadSha: string | null
  postedCommentUrl: string | null
}

export interface RunDetail extends ReviewRun {
  draftId: string | null
}

export interface PostedResult {
  commentUrl: string
  commentId: number
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

export interface QueueDepth {
  active: number
  queued: number
}

export interface BoardResponse {
  operator: OperatorIdentity
  /** How much review work is in flight, so the board can show progress during a sweep. */
  queue: QueueDepth
  /** The query the board was built from. Null until the browser supplies one. */
  query: string | null
  lastRefreshAt: string | null
  stale: boolean
  rateLimit: RateLimitInfo | null
  groups: Record<PullRequestStatus, PullRequestView[]>
  repoErrors: RepoError[]
}

/**
 * Server-side settings. The search query is deliberately NOT here — it lives in the browser's
 * localStorage and travels with each request (see contracts/http-api.md).
 */
export interface OperatorConfig {
  refreshIntervalMs: number
  maxConcurrentRuns: number
  runTimeoutMs: number
  maxDiffBytes: number
  reviewPromptPath: string
  rereviewPromptPath: string
  port: number
  includeDraftsInBulk: boolean
}

/** Status groups a bulk "review everything here" action can target. */
export const BULK_GROUPS: PullRequestStatus[] = ['needs_review', 'awaiting_rereview', 'error']

/** Shown as placeholder text in the query editor; never used as a real query. */
export const QUERY_EXAMPLE = 'org:YOUR_ORG is:pr is:open label:YOUR_LABEL'

/** Where the browser keeps the operator's query. */
export const QUERY_STORAGE_KEY = 'pr-review-radar:query'

/**
 * A query the app must refuse to send to GitHub: blank, or still carrying the example's
 * placeholders. Guards against an empty board silently burning API quota.
 */
export function isUsableQuery(query: string | null | undefined): query is string {
  if (!query) return false
  const trimmed = query.trim()
  if (trimmed === '') return false
  return !trimmed.includes('YOUR_ORG') && !trimmed.includes('YOUR_LABEL')
}

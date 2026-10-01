/**
 * The seam that keeps polling replaceable (Constitution IV). Polling ships now; a webhook
 * receiver implements this same interface later and nothing downstream knows the difference.
 *
 * See specs/001-pr-review-radar/contracts/change-source.md.
 */

export interface PullRequestChanged {
  type: 'pull_request.changed'
  repo: string
  number: number
  headSha: string
  updatedAt: string
  source: SourceName
}

export interface PullRequestRemoved {
  type: 'pull_request.removed'
  repo: string
  number: number
  source: SourceName
}

export type ChangeEvent = PullRequestChanged | PullRequestRemoved

export type SourceName = 'polling' | 'webhook'

export type Emit = (event: ChangeEvent) => void

export interface SourceStatus {
  healthy: boolean
  lastSuccessAt?: string
  lastError?: string
}

export interface ChangeSource {
  readonly name: SourceName
  /** Begin producing events. Resolves once the source is live. */
  start(emit: Emit, signal: AbortSignal): Promise<void>
  /** Force a production cycle now, if the source supports it. */
  refreshNow?(): Promise<void>
  status(): SourceStatus
}

/** Identity used for deduplication: the same change seen twice must collapse to one (FR-036). */
export function eventKey(event: ChangeEvent): string {
  return event.type === 'pull_request.changed'
    ? `c:${event.repo}#${event.number}@${event.headSha}@${event.updatedAt}`
    : `r:${event.repo}#${event.number}`
}

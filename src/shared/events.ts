/** SSE payloads. See specs/001-pr-review-radar/contracts/http-api.md. */
import type { PullRequestView, RateLimitInfo, RunStatus, DraftStatus } from './types.js'

export interface PrUpdatedEvent {
  pullRequest: PullRequestView
}

export interface PrRemovedEvent {
  repo: string
  number: number
}

export interface RunUpdatedEvent {
  runId: string
  repo: string
  number: number
  status: RunStatus
  error?: string
}

export interface DraftReadyEvent {
  draftId: string
  runId: string
  repo: string
  number: number
  headSha: string
}

export interface DraftResolvedEvent {
  draftId: string
  status: DraftStatus
  commentUrl?: string
}

export interface RefreshCompletedEvent {
  at: string
  changedCount: number
  rateLimit: RateLimitInfo | null
}

export interface ErrorEvent {
  scope: 'refresh' | 'repo' | 'run'
  message: string
}

export interface BoardEventMap {
  'pr.updated': PrUpdatedEvent
  'pr.removed': PrRemovedEvent
  'run.updated': RunUpdatedEvent
  'draft.ready': DraftReadyEvent
  'draft.resolved': DraftResolvedEvent
  'refresh.completed': RefreshCompletedEvent
  error: ErrorEvent
}

export type BoardEventName = keyof BoardEventMap

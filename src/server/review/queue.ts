import type { OperatorConfig, ReviewDraft, ReviewKind, ReviewRun } from '../../shared/types.js'
import type { Repositories } from '../store/repos.js'
import type { DiffFetcher } from '../github/diff.js'
import { DiffTooLargeError } from '../github/diff.js'
import { buildPrompt } from './prompt.js'
import { RunnerError, runReview } from './runner.js'
import { newId } from '../ids.js'

export type QueueErrorCode =
  | 'run_in_progress'
  | 'already_reviewed'
  | 'unknown_pull_request'
  | 'no_changes_requested'

export class QueueError extends Error {
  constructor(
    readonly code: QueueErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'QueueError'
  }
}

export interface EnqueueRequest {
  repo: string
  number: number
  kind: ReviewKind
  force?: boolean
}

export interface QueueEvents {
  onRunUpdated?(run: ReviewRun): void
  onDraftReady?(draft: ReviewDraft): void
}

type Runner = typeof runReview

/**
 * Bounded, single-flight review execution. Every rule here is a constitution obligation: one run
 * per pull request (FR-019), a configurable ceiling on concurrent subprocesses (FR-020), and no
 * repeat work for a head SHA already reviewed unless the operator forces it (FR-022, FR-023).
 */
export class ReviewQueue {
  private readonly waiting: string[] = []
  private readonly active = new Map<string, AbortController>()
  private draining = false

  constructor(
    private readonly repos: Repositories,
    private readonly diffs: DiffFetcher,
    private readonly config: () => OperatorConfig,
    private readonly events: QueueEvents = {},
    private readonly runner: Runner = runReview,
  ) {}

  enqueue(request: EnqueueRequest): ReviewRun {
    const { repo, number, kind, force = false } = request

    const snapshot = this.repos.getSnapshot(repo, number)
    if (!snapshot) {
      throw new QueueError('unknown_pull_request', `${repo}#${number} is not on the board.`)
    }

    const active = this.repos.findActiveRun(repo, number)
    if (active) {
      throw new QueueError('run_in_progress', 'A review is already running for this pull request.', {
        runId: active.id,
      })
    }

    if (!force && this.repos.hasSucceededRunForSha(repo, number, snapshot.headSha)) {
      throw new QueueError('already_reviewed', 'This commit has already been reviewed.', {
        headSha: snapshot.headSha,
      })
    }

    const run: ReviewRun = {
      id: newId('run'),
      repo,
      number,
      headSha: snapshot.headSha,
      kind,
      status: 'queued',
      forced: force,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      stderrTail: null,
      error: null,
    }
    this.repos.insertRun({ ...run, createdAt: new Date().toISOString() })
    this.waiting.push(run.id)
    this.events.onRunUpdated?.(run)
    void this.drain()
    return run
  }

  /** Cancels a queued or running review. Idempotent: a finished run keeps its terminal status. */
  cancel(runId: string): ReviewRun | null {
    const run = this.repos.getRun(runId)
    if (!run) return null
    if (run.status !== 'queued' && run.status !== 'running') return run

    const controller = this.active.get(runId)
    if (controller) {
      controller.abort()
      return this.repos.getRun(runId)
    }

    const index = this.waiting.indexOf(runId)
    if (index >= 0) this.waiting.splice(index, 1)
    return this.finishRun(runId, { status: 'cancelled', error: 'Cancelled before it started' })
  }

  get activeCount(): number {
    return this.active.size
  }

  get queuedCount(): number {
    return this.waiting.length
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.waiting.length > 0 && this.active.size < this.config().maxConcurrentRuns) {
        const runId = this.waiting.shift()
        if (!runId) break
        const controller = new AbortController()
        this.active.set(runId, controller)
        void this.execute(runId, controller).finally(() => {
          this.active.delete(runId)
          void this.drain()
        })
      }
    } finally {
      this.draining = false
    }
  }

  private async execute(runId: string, controller: AbortController): Promise<void> {
    const run = this.repos.getRun(runId)
    if (!run) return

    this.repos.updateRun(runId, { status: 'running', startedAt: new Date().toISOString() })
    this.emitRun(runId)

    const snapshot = this.repos.getSnapshot(run.repo, run.number)
    if (!snapshot) {
      this.finishRun(runId, {
        status: 'failed',
        error: 'The pull request left the board before the review started.',
      })
      return
    }

    try {
      const config = this.config()
      const diff = await this.diffs.fetch(run.repo, run.number)
      const parts = buildPrompt({
        kind: run.kind,
        snapshot,
        diff,
        reviewPromptPath: config.reviewPromptPath,
        rereviewPromptPath: config.rereviewPromptPath,
      })

      const result = await this.runner(parts, {
        timeoutMs: config.runTimeoutMs,
        signal: controller.signal,
      })

      const now = new Date().toISOString()
      const draft: ReviewDraft = {
        id: newId('draft'),
        runId,
        repo: run.repo,
        number: run.number,
        headSha: run.headSha,
        body: result.body,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      }
      this.repos.insertDraft(draft)
      this.finishRun(runId, { status: 'succeeded', exitCode: result.exitCode })
      this.events.onDraftReady?.(draft)
    } catch (error) {
      this.finishRun(runId, failureFrom(error))
    }
  }

  private finishRun(
    runId: string,
    patch: { status: ReviewRun['status']; error?: string; exitCode?: number; stderrTail?: string },
  ): ReviewRun | null {
    this.repos.updateRun(runId, {
      status: patch.status,
      finishedAt: new Date().toISOString(),
      error: patch.error ?? null,
      exitCode: patch.exitCode ?? null,
      stderrTail: patch.stderrTail ?? null,
    })
    return this.emitRun(runId)
  }

  private emitRun(runId: string): ReviewRun | null {
    const updated = this.repos.getRun(runId)
    if (updated) this.events.onRunUpdated?.(updated)
    return updated
  }
}

function failureFrom(error: unknown): {
  status: ReviewRun['status']
  error: string
  exitCode?: number
  stderrTail?: string
} {
  if (error instanceof RunnerError) {
    return {
      status: error.kind === 'cancelled' ? 'cancelled' : 'failed',
      error: error.message,
      ...(error.exitCode !== null ? { exitCode: error.exitCode } : {}),
      ...(error.stderrTail ? { stderrTail: error.stderrTail } : {}),
    }
  }
  if (error instanceof DiffTooLargeError) {
    return { status: 'failed', error: error.message }
  }
  return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
}

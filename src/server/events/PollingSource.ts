import type { BoardService } from '../board/service.js'
import { isUsableQuery } from '../../shared/types.js'
import type { ChangeSource, Emit, SourceStatus } from './ChangeSource.js'

export interface PollingOptions {
  intervalMs: () => number
  onCycle?: (summary: { at: string; changedCount: number; removedCount: number }) => void
  onError?: (error: unknown) => void
  /** Injected in tests so a cycle can be driven without real timers. */
  schedule?: (fn: () => void, ms: number) => { cancel(): void }
}

/**
 * The first ChangeSource. One batched query per cycle; a pull request whose head and updatedAt
 * are unchanged produces no event and is not re-examined (Constitution V). With no usable query
 * the source idles rather than polling or erroring — the query belongs to the browser, and none
 * may have arrived yet.
 */
export class PollingSource implements ChangeSource {
  readonly name = 'polling' as const

  private emit: Emit | null = null
  private timer: { cancel(): void } | null = null
  private running = false
  private inFlight: Promise<void> | null = null
  private lastSuccessAt: string | undefined
  private lastError: string | undefined

  constructor(
    private readonly board: BoardService,
    private readonly options: PollingOptions,
  ) {}

  async start(emit: Emit, signal: AbortSignal): Promise<void> {
    this.emit = emit
    this.running = true
    signal.addEventListener(
      'abort',
      () => {
        this.running = false
        this.timer?.cancel()
        this.timer = null
      },
      { once: true },
    )
    await this.cycle()
    this.scheduleNext()
  }

  /** Runs a cycle now. Concurrent callers share the one in flight. */
  async refreshNow(): Promise<void> {
    if (this.inFlight) return this.inFlight
    return this.cycle()
  }

  status(): SourceStatus {
    return {
      healthy: this.lastError === undefined,
      ...(this.lastSuccessAt ? { lastSuccessAt: this.lastSuccessAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.timer?.cancel()
    const schedule = this.options.schedule ?? defaultSchedule
    this.timer = schedule(() => {
      void this.cycle().finally(() => this.scheduleNext())
    }, this.options.intervalMs())
  }

  private cycle(): Promise<void> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(): Promise<void> {
    if (!isUsableQuery(this.board.query)) return

    try {
      const outcome = await this.board.refresh()
      for (const changed of outcome.changed) {
        this.emit?.({
          type: 'pull_request.changed',
          repo: changed.repo,
          number: changed.number,
          headSha: changed.headSha,
          updatedAt: changed.updatedAt,
          source: this.name,
        })
      }
      for (const removed of outcome.removed) {
        this.emit?.({
          type: 'pull_request.removed',
          repo: removed.repo,
          number: removed.number,
          source: this.name,
        })
      }
      this.lastSuccessAt = outcome.at
      this.lastError = undefined
      this.options.onCycle?.({
        at: outcome.at,
        changedCount: outcome.changed.length,
        removedCount: outcome.removed.length,
      })
    } catch (error) {
      // A failed cycle must never escape start() or stop the schedule (contract rule 3).
      this.lastError = error instanceof Error ? error.message : String(error)
      this.options.onError?.(error)
    }
  }
}

function defaultSchedule(fn: () => void, ms: number): { cancel(): void } {
  const handle = setTimeout(fn, ms)
  handle.unref?.()
  return { cancel: () => clearTimeout(handle) }
}

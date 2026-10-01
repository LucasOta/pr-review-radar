import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueueError, ReviewQueue } from '../../src/server/review/queue.js'
import type { DiffFetcher } from '../../src/server/github/diff.js'
import { DiffTooLargeError } from '../../src/server/github/diff.js'
import { RunnerError } from '../../src/server/review/runner.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import { DEFAULT_CONFIG } from '../../src/server/config/schema.js'
import { snapshot } from '../fixtures/github.js'
import type { ReviewDraft, ReviewRun } from '../../src/shared/types.js'

const config = (over: Partial<typeof DEFAULT_CONFIG> = {}) => () => ({ ...DEFAULT_CONFIG, ...over })

function fakeDiffs(diff = 'diff --git a/a b/a'): DiffFetcher {
  return { fetch: async () => diff, invalidate: () => undefined } as unknown as DiffFetcher
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ReviewQueue', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
    repos.upsertSnapshot(snapshot())
  })

  it('runs a review and leaves a draft behind', async () => {
    const drafts: ReviewDraft[] = []
    const queue = new ReviewQueue(
      repos,
      fakeDiffs(),
      config(),
      { onDraftReady: (draft) => drafts.push(draft) },
      async () => ({ body: 'Looks good.', exitCode: 0 }),
    )

    const run = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(run.id)?.status === 'succeeded')

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.body).toBe('Looks good.')
    expect(drafts[0]?.headSha).toBe('aaa1111')
    expect(repos.findPendingDraft('acme/widgets', 1)?.id).toBe(drafts[0]?.id)
  })

  it('refuses a second concurrent run for the same pull request (FR-019)', async () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return { body: 'ok', exitCode: 0 }
    })

    queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await settle()

    expect(() => queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })).toThrow(
      QueueError,
    )
    try {
      queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    } catch (error) {
      expect((error as QueueError).code).toBe('run_in_progress')
    }
  })

  it('skips a head SHA that already succeeded, unless forced (FR-022, FR-023)', async () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => ({
      body: 'ok',
      exitCode: 0,
    }))

    const first = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(first.id)?.status === 'succeeded')

    try {
      queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
      throw new Error('should have refused')
    } catch (error) {
      expect((error as QueueError).code).toBe('already_reviewed')
      expect((error as QueueError).detail.headSha).toBe('aaa1111')
    }

    const forced = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review', force: true })
    expect(forced.forced).toBe(true)
    await vi.waitUntil(() => repos.getRun(forced.id)?.status === 'succeeded')
  })

  it('reviews a new head SHA without being forced', async () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => ({
      body: 'ok',
      exitCode: 0,
    }))
    const first = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(first.id)?.status === 'succeeded')

    repos.upsertSnapshot(snapshot({ headSha: 'bbb2222' }))
    const second = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    expect(second.headSha).toBe('bbb2222')
  })

  it('never exceeds maxConcurrentRuns (FR-020)', async () => {
    for (let number = 2; number <= 6; number++) {
      repos.upsertSnapshot(snapshot({ number, headSha: `sha${number}` }))
    }
    let inFlight = 0
    let peak = 0
    const queue = new ReviewQueue(repos, fakeDiffs(), config({ maxConcurrentRuns: 2 }), {}, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 40))
      inFlight -= 1
      return { body: 'ok', exitCode: 0 }
    })

    const runs: ReviewRun[] = []
    for (let number = 1; number <= 6; number++) {
      runs.push(queue.enqueue({ repo: 'acme/widgets', number, kind: 'review' }))
    }

    await vi.waitUntil(() => runs.every((run) => repos.getRun(run.id)?.status === 'succeeded'), {
      timeout: 5000,
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBeGreaterThan(1)
  })

  it('cancels a queued run without starting it', async () => {
    repos.upsertSnapshot(snapshot({ number: 2, headSha: 'sha2' }))
    const started: string[] = []
    const queue = new ReviewQueue(repos, fakeDiffs(), config({ maxConcurrentRuns: 1 }), {}, async () => {
      started.push('run')
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { body: 'ok', exitCode: 0 }
    })

    queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    const queued = queue.enqueue({ repo: 'acme/widgets', number: 2, kind: 'review' })
    await settle()

    const cancelled = queue.cancel(queued.id)
    expect(cancelled?.status).toBe('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(started).toHaveLength(1)
    expect(repos.findPendingDraft('acme/widgets', 2)).toBeNull()
  })

  it('cancelling a finished run keeps its terminal status', async () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => ({
      body: 'ok',
      exitCode: 0,
    }))
    const run = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(run.id)?.status === 'succeeded')

    expect(queue.cancel(run.id)?.status).toBe('succeeded')
    expect(queue.cancel('run_nope')).toBeNull()
  })

  it('records a failed run with its captured output and leaves no draft', async () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => {
      throw new RunnerError('claude exited 2', 2, 'rate limited')
    })
    const run = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(run.id)?.status === 'failed')

    const stored = repos.getRun(run.id)
    expect(stored?.error).toBe('claude exited 2')
    expect(stored?.exitCode).toBe(2)
    expect(stored?.stderrTail).toBe('rate limited')
    expect(repos.findPendingDraft('acme/widgets', 1)).toBeNull()
  })

  it('reports an oversize diff as an actionable failure', async () => {
    const diffs = {
      fetch: async () => {
        throw new DiffTooLargeError(500_000, 400_000)
      },
      invalidate: () => undefined,
    } as unknown as DiffFetcher
    const queue = new ReviewQueue(repos, diffs, config(), {}, async () => ({ body: 'ok', exitCode: 0 }))

    const run = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await vi.waitUntil(() => repos.getRun(run.id)?.status === 'failed')
    expect(repos.getRun(run.id)?.error).toMatch(/above the configured limit/)
  })

  it('refuses a pull request that is not on the board', () => {
    const queue = new ReviewQueue(repos, fakeDiffs(), config(), {}, async () => ({
      body: 'ok',
      exitCode: 0,
    }))
    try {
      queue.enqueue({ repo: 'acme/widgets', number: 999, kind: 'review' })
      throw new Error('should have refused')
    } catch (error) {
      expect((error as QueueError).code).toBe('unknown_pull_request')
    }
  })

  it('fails cleanly when a queued pull request leaves the board before its turn', async () => {
    repos.upsertSnapshot(snapshot({ number: 2, headSha: 'sha2' }))
    const queue = new ReviewQueue(repos, fakeDiffs(), config({ maxConcurrentRuns: 1 }), {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return { body: 'ok', exitCode: 0 }
    })

    queue.enqueue({ repo: 'acme/widgets', number: 2, kind: 'review' })
    const queued = queue.enqueue({ repo: 'acme/widgets', number: 1, kind: 'review' })
    await settle()
    // The pull request is merged while its review is still waiting its turn.
    repos.deleteSnapshot('acme/widgets', 1)

    await vi.waitUntil(() => repos.getRun(queued.id)?.status === 'failed')
    expect(repos.getRun(queued.id)?.error).toMatch(/left the board/)
    expect(repos.findPendingDraft('acme/widgets', 1)).toBeNull()
  })
})

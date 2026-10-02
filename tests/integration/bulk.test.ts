import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardService } from '../../src/server/board/service.js'
import { ConfigStore } from '../../src/server/config/store.js'
import { DiffFetcher } from '../../src/server/github/diff.js'
import { ReviewQueue } from '../../src/server/review/queue.js'
import { runBulkReview } from '../../src/server/review/bulk.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import type { GitHubClients } from '../../src/server/github/client.js'
import type { OperatorConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/server/config/schema.js'
import { commit, review, snapshot } from '../fixtures/github.js'
import type { PromptParts } from '../../src/server/review/prompt.js'

type FakeRunner = (parts: PromptParts) => Promise<{ body: string; exitCode: number }>

function tempConfig(): ConfigStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-bulk-'))
  return new ConfigStore(path.join(dir, 'config.json'))
}

const clients = {
  graphql: (async () => ({})) as unknown as GitHubClients['graphql'],
  rest: {} as GitHubClients['rest'],
  identity: async () => ({ login: 'operator', avatarUrl: null }),
  rateLimit: () => null,
  recordRateLimit: () => undefined,
} satisfies GitHubClients

function fakeDiffs(): DiffFetcher {
  return { fetch: async () => 'diff', invalidate: () => undefined } as unknown as DiffFetcher
}

describe('bulk review', () => {
  let repos: Repositories
  let board: BoardService

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
    board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')
  })

  function makeQueue(
    config: Partial<OperatorConfig> = {},
    runner: FakeRunner = async () => ({ body: 'Looks good.', exitCode: 0 }),
  ): ReviewQueue {
    return new ReviewQueue(repos, fakeDiffs(), () => ({ ...DEFAULT_CONFIG, ...config }), {}, runner)
  }

  const deps = (queue: ReviewQueue, config: Partial<OperatorConfig> = {}) => ({
    board,
    queue,
    config: () => ({ ...DEFAULT_CONFIG, ...config }),
  })

  it('queues every pull request in the group, each producing its own draft', async () => {
    for (const number of [1, 2, 3]) {
      repos.upsertSnapshot(snapshot({ number, headSha: `sha${number}` }))
    }
    const queue = makeQueue()

    const result = await runBulkReview({ group: 'needs_review' }, deps(queue))

    expect(result.enqueued).toHaveLength(3)
    expect(result.skipped).toHaveLength(0)

    await vi.waitUntil(() =>
      result.enqueued.every((entry) => repos.getRun(entry.runId)?.status === 'succeeded'),
    )
    // Each result is its own draft awaiting its own decision.
    expect(repos.listPendingDrafts()).toHaveLength(3)
  })

  it('posts nothing by itself', async () => {
    for (const number of [1, 2]) repos.upsertSnapshot(snapshot({ number, headSha: `sha${number}` }))
    const queue = makeQueue()

    const result = await runBulkReview({ group: 'needs_review' }, deps(queue))
    await vi.waitUntil(() =>
      result.enqueued.every((entry) => repos.getRun(entry.runId)?.status === 'succeeded'),
    )

    expect(repos.listAllPosted()).toHaveLength(0)
    expect(repos.listPendingDrafts().every((draft) => draft.status === 'ready')).toBe(true)
  })

  it('respects the concurrency ceiling', async () => {
    for (let number = 1; number <= 5; number++) {
      repos.upsertSnapshot(snapshot({ number, headSha: `sha${number}` }))
    }
    let inFlight = 0
    let peak = 0
    const queue = makeQueue({ maxConcurrentRuns: 2 }, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 30))
      inFlight -= 1
      return { body: 'ok', exitCode: 0 }
    })

    const result = await runBulkReview({ group: 'needs_review' }, deps(queue, { maxConcurrentRuns: 2 }))
    await vi.waitUntil(
      () => result.enqueued.every((entry) => repos.getRun(entry.runId)?.status === 'succeeded'),
      { timeout: 5000 },
    )

    expect(peak).toBeLessThanOrEqual(2)
  })

  it('keeps going when one run fails', async () => {
    for (const number of [1, 2, 3]) {
      repos.upsertSnapshot(snapshot({ number, headSha: `sha${number}` }))
    }
    const queue = makeQueue({}, async (parts) => {
      if (parts.context.includes('#2')) throw new Error('claude exploded')
      return { body: 'ok', exitCode: 0 }
    })

    const result = await runBulkReview({ group: 'needs_review' }, deps(queue))
    await vi.waitUntil(() =>
      result.enqueued.every((entry) =>
        ['succeeded', 'failed'].includes(repos.getRun(entry.runId)?.status ?? ''),
      ),
    )

    const statuses = result.enqueued.map((entry) => repos.getRun(entry.runId)?.status)
    expect(statuses.filter((status) => status === 'succeeded')).toHaveLength(2)
    expect(statuses.filter((status) => status === 'failed')).toHaveLength(1)
  })

  it('skips drafts by default and includes them on request', async () => {
    repos.upsertSnapshot(snapshot({ number: 1, headSha: 'sha1' }))
    repos.upsertSnapshot(snapshot({ number: 2, headSha: 'sha2', isDraft: true }))

    const skipping = await runBulkReview({ group: 'needs_review' }, deps(makeQueue()))
    expect(skipping.enqueued).toHaveLength(1)
    expect(skipping.skipped).toEqual([
      { repo: 'acme/widgets', number: 2, reason: 'draft_pull_request' },
    ])

    const including = await runBulkReview(
      { group: 'needs_review', includeDrafts: true },
      deps(makeQueue()),
    )
    expect(including.enqueued.map((entry) => entry.number)).toContain(2)
  })

  // A pull request with a run in flight has already left the group — it shows as `running` —
  // so a second sweep finds nothing rather than double-queueing.
  it('is a no-op while the previous sweep is still running', async () => {
    repos.upsertSnapshot(snapshot({ number: 1, headSha: 'sha1' }))
    repos.upsertSnapshot(snapshot({ number: 2, headSha: 'sha2' }))
    const queue = makeQueue({}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { body: 'ok', exitCode: 0 }
    })

    const first = await runBulkReview({ group: 'needs_review' }, deps(queue))
    expect(first.enqueued).toHaveLength(2)

    const second = await runBulkReview({ group: 'needs_review' }, deps(queue))
    expect(second.enqueued).toHaveLength(0)
    expect(second.skipped).toHaveLength(0)
    expect((await board.board()).groups.running).toHaveLength(2)
  })

  it('skips a pull request whose review is already waiting for a decision', async () => {
    repos.upsertSnapshot(snapshot({ number: 1, headSha: 'sha1' }))
    const queue = makeQueue()

    const first = await runBulkReview({ group: 'needs_review' }, deps(queue))
    await vi.waitUntil(() => repos.getRun(first.enqueued[0]!.runId)?.status === 'succeeded')

    const second = await runBulkReview({ group: 'needs_review' }, deps(queue))
    expect(second.enqueued).toHaveLength(0)
    expect(second.skipped[0]?.reason).toBe('review_awaiting_decision')
  })

  it('sends re-reviews for the awaiting group', async () => {
    repos.upsertSnapshot(
      snapshot({
        number: 1,
        headSha: 'bbb2222',
        reviews: [review('CHANGES_REQUESTED', '2026-09-02T08:00:00Z')],
        commits: [commit('aaa1111', '2026-09-02T07:00:00Z'), commit('bbb2222', '2026-09-02T09:00:00Z')],
      }),
    )
    const queue = makeQueue()

    const result = await runBulkReview({ group: 'awaiting_rereview' }, deps(queue))

    expect(result.enqueued).toHaveLength(1)
    expect(repos.getRun(result.enqueued[0]!.runId)?.kind).toBe('rereview')
  })

  it('does nothing for an empty group', async () => {
    const result = await runBulkReview({ group: 'needs_review' }, deps(makeQueue()))
    expect(result).toEqual({ enqueued: [], skipped: [] })
  })
})

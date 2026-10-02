import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardService } from '../../src/server/board/service.js'
import { ConfigStore } from '../../src/server/config/store.js'
import { fetchBoard } from '../../src/server/github/fetchBoard.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import type { GitHubClients } from '../../src/server/github/client.js'
import type { RateLimitInfo } from '../../src/shared/types.js'
import { searchPayload } from '../fixtures/github.js'

function tempConfig(): ConfigStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-perf-'))
  return new ConfigStore(path.join(dir, 'config.json'))
}

function countingClients(pages: unknown[]) {
  let calls = 0
  let rateLimit: RateLimitInfo | null = null
  return {
    graphql: (async () => {
      const page = pages[Math.min(calls, pages.length - 1)]
      calls += 1
      return page
    }) as unknown as GitHubClients['graphql'],
    rest: {} as GitHubClients['rest'],
    identity: async () => ({ login: 'operator', avatarUrl: null }),
    rateLimit: () => rateLimit,
    recordRateLimit: (info: RateLimitInfo) => {
      rateLimit = info
    },
    get calls() {
      return calls
    },
  } as GitHubClients & { calls: number }
}

function manyPullRequests(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    number: offset + index + 1,
    headSha: `sha${offset + index + 1}`,
    updatedAt: `2026-09-02T10:${String(index % 60).padStart(2, '0')}:00Z`,
  }))
}

describe('cost per cycle', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
  })

  // Constitution V: a page of results costs one request, and a quiet cycle costs one too.
  it('issues exactly one GraphQL request for a single page', async () => {
    const clients = countingClients([searchPayload(manyPullRequests(25))])
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')

    await board.refresh()

    expect(clients.calls).toBe(1)
  })

  it('issues one request per page and no more', async () => {
    const clients = countingClients([
      searchPayload(manyPullRequests(25), { hasNextPage: true, endCursor: 'page2' }),
      searchPayload(manyPullRequests(25, 25)),
    ])
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')

    const outcome = await board.refresh()

    expect(clients.calls).toBe(2)
    expect(outcome.changed).toHaveLength(50)
  })

  it('costs the same one request when nothing changed, and writes nothing', async () => {
    const page = searchPayload(manyPullRequests(50))
    const clients = countingClients([page])
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')

    await board.refresh()
    const before = repos.listSnapshots().map((snapshot) => snapshot.fetchedAt)

    const second = await board.refresh()

    expect(clients.calls).toBe(2) // one per cycle, not one per pull request
    expect(second.changed).toHaveLength(0)
    // Unchanged rows are not rewritten, so their fetchedAt stamps are untouched.
    expect(repos.listSnapshots().map((snapshot) => snapshot.fetchedAt)).toEqual(before)
  })

  it('composes a 50-row board quickly', async () => {
    const clients = countingClients([searchPayload(manyPullRequests(50))])
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')
    await board.refresh()

    const started = performance.now()
    const response = await board.board()
    const elapsed = performance.now() - started

    expect(Object.values(response.groups).flat()).toHaveLength(50)
    // Generous ceiling; it exists to catch an accidental per-row query, not to benchmark.
    expect(elapsed).toBeLessThan(500)
  })

  it('maps a large page without quadratic blowup', async () => {
    const payload = searchPayload(manyPullRequests(100))
    const started = performance.now()
    const result = await fetchBoard(async () => payload as never, 'org:acme is:pr')
    const elapsed = performance.now() - started

    expect(result.snapshots).toHaveLength(100)
    expect(elapsed).toBeLessThan(500)
  })
})

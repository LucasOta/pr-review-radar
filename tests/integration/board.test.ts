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
import { buildMarker } from '../../src/server/github/queries.js'
import { searchPayload } from '../fixtures/github.js'

function tempConfig(query: string): ConfigStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-board-'))
  const store = new ConfigStore(path.join(dir, 'config.json'))
  store.update({ searchQuery: query })
  return store
}

function fakeClients(responses: unknown[]): GitHubClients & { calls: number } {
  let rateLimit: RateLimitInfo | null = null
  let calls = 0
  const clients = {
    graphql: (async () => {
      const response = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      if (response instanceof Error) throw response
      return response
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
  }
  return clients as GitHubClients & { calls: number }
}

describe('fetchBoard', () => {
  it('maps a search payload into snapshots', async () => {
    const payload = searchPayload([
      {
        number: 7,
        title: 'Fix eligibility',
        headSha: 'bbb2222',
        reviews: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-09-02T08:00:00Z' }],
        commits: [
          { oid: 'aaa1111', committedDate: '2026-09-02T07:00:00Z' },
          { oid: 'bbb2222', committedDate: '2026-09-02T09:00:00Z' },
        ],
        comments: [`Nice work ${buildMarker('draft_9', 'aaa1111')}`],
      },
    ])
    const result = await fetchBoard(async () => payload as never, 'org:acme is:pr')

    expect(result.snapshots).toHaveLength(1)
    const [snapshot] = result.snapshots
    expect(snapshot?.repo).toBe('acme/widgets')
    expect(snapshot?.headSha).toBe('bbb2222')
    expect(snapshot?.reviews[0]?.state).toBe('CHANGES_REQUESTED')
    expect(snapshot?.aiCommentMarkers).toEqual(['aaa1111'])
    expect(result.rateLimit?.remaining).toBe(4990)
  })

  it('returns readable results alongside per-repository errors', async () => {
    const partial = Object.assign(new Error('partial'), {
      data: searchPayload([{ number: 3 }]),
      errors: [{ message: 'Resource not accessible', path: ['search', 'nodes', '1'] }],
    })
    const result = await fetchBoard(async () => {
      throw partial
    }, 'org:acme is:pr')

    expect(result.snapshots).toHaveLength(1)
    expect(result.repoErrors[0]?.message).toContain('not accessible')
  })
})

describe('BoardService', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
  })

  it('groups pull requests by computed status', async () => {
    const clients = fakeClients([
      searchPayload([
        { number: 1, headSha: 'aaa1111' },
        {
          number: 2,
          headSha: 'ccc3333',
          reviews: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-09-02T08:00:00Z' }],
          commits: [
            { oid: 'bbb2222', committedDate: '2026-09-02T07:00:00Z' },
            { oid: 'ccc3333', committedDate: '2026-09-02T09:00:00Z' },
          ],
        },
        {
          number: 3,
          headSha: 'ddd4444',
          comments: [`review ${buildMarker('d1', 'ddd4444')}`],
        },
      ]),
    ])
    const service = new BoardService(repos, clients, tempConfig('org:acme is:pr is:open'))

    await service.refresh()
    const board = await service.board()

    expect(board.groups.needs_review.map((pr) => pr.number)).toEqual([1])
    expect(board.groups.awaiting_rereview.map((pr) => pr.number)).toEqual([2])
    expect(board.groups.ready_for_human.map((pr) => pr.number)).toEqual([3])
    expect(board.operator.login).toBe('operator')
    expect(board.stale).toBe(false)
  })

  it('reports only genuinely changed pull requests on a second cycle (Constitution V)', async () => {
    const unchanged = searchPayload([{ number: 1, headSha: 'aaa1111', updatedAt: '2026-09-02T10:00:00Z' }])
    const clients = fakeClients([unchanged, unchanged])
    const service = new BoardService(repos, clients, tempConfig('org:acme is:pr is:open'))

    const first = await service.refresh()
    const second = await service.refresh()

    expect(first.changed).toHaveLength(1)
    expect(second.changed).toHaveLength(0)
  })

  it('reports a pull request whose head moved', async () => {
    const clients = fakeClients([
      searchPayload([{ number: 1, headSha: 'aaa1111', updatedAt: '2026-09-02T10:00:00Z' }]),
      searchPayload([{ number: 1, headSha: 'bbb2222', updatedAt: '2026-09-02T11:00:00Z' }]),
    ])
    const service = new BoardService(repos, clients, tempConfig('org:acme is:pr is:open'))

    await service.refresh()
    const second = await service.refresh()

    expect(second.changed).toEqual([
      { repo: 'acme/widgets', number: 1, headSha: 'bbb2222', updatedAt: '2026-09-02T11:00:00Z' },
    ])
  })

  it('drops pull requests that leave the query', async () => {
    const clients = fakeClients([
      searchPayload([{ number: 1 }, { number: 2 }]),
      searchPayload([{ number: 1 }]),
    ])
    const service = new BoardService(repos, clients, tempConfig('org:acme is:pr is:open'))

    await service.refresh()
    const second = await service.refresh()

    expect(second.removed).toEqual([{ repo: 'acme/widgets', number: 2 }])
    const board = await service.board()
    expect(board.groups.needs_review).toHaveLength(1)
  })

  it('keeps serving the last board when GitHub fails, and marks it stale', async () => {
    const clients = fakeClients([searchPayload([{ number: 1 }]), new Error('ETIMEDOUT')])
    const service = new BoardService(repos, clients, tempConfig('org:acme is:pr is:open'))

    await service.refresh()
    await expect(service.refresh()).rejects.toThrow('ETIMEDOUT')

    const board = await service.board()
    expect(board.groups.needs_review).toHaveLength(1)
    expect(board.stale).toBe(true)
    expect(service.lastRefreshError).toContain('ETIMEDOUT')
  })

  it('does not call GitHub while the query is still the placeholder', async () => {
    const clients = fakeClients([searchPayload([{ number: 1 }])])
    const store = tempConfig('org:acme is:pr')
    store.update({ searchQuery: 'org:YOUR_ORG is:pr is:open label:YOUR_LABEL' })
    const service = new BoardService(repos, clients, store)

    const outcome = await service.refresh()

    expect(outcome.changed).toHaveLength(0)
    expect(clients.calls).toBe(0)
  })
})

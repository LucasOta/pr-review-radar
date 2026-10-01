import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardService } from '../../src/server/board/service.js'
import { ConfigStore } from '../../src/server/config/store.js'
import { PollingSource } from '../../src/server/events/PollingSource.js'
import type { ChangeEvent } from '../../src/server/events/ChangeSource.js'
import type { GitHubClients } from '../../src/server/github/client.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import type { RateLimitInfo } from '../../src/shared/types.js'
import { searchPayload } from '../fixtures/github.js'

function tempConfig(): ConfigStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-degrade-'))
  return new ConfigStore(path.join(dir, 'config.json'))
}

function clientsFor(responses: unknown[]): GitHubClients {
  let rateLimit: RateLimitInfo | null = null
  let calls = 0
  return {
    graphql: (async () => {
      const response = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      if (response instanceof Error) throw response
      return response
    }) as unknown as GitHubClients['graphql'],
    rest: {} as GitHubClients['rest'],
    identity: async () => ({ login: 'operator', avatarUrl: null }),
    rateLimit: () => rateLimit,
    recordRateLimit: (info) => {
      rateLimit = info
    },
  }
}

/** GitHub's shape for a throttled answer. */
function rateLimited(): Error {
  return Object.assign(new Error('API rate limit exceeded'), { status: 403 })
}

describe('degradation', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
  })

  function wire(responses: unknown[]) {
    const clients = clientsFor(responses)
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery('org:acme is:pr is:open')
    const errors: unknown[] = []
    const events: ChangeEvent[] = []
    const pending: Array<() => void> = []
    const source = new PollingSource(board, {
      intervalMs: () => 60_000,
      schedule: (fn) => {
        pending.push(fn)
        return {
          cancel: () => {
            const index = pending.indexOf(fn)
            if (index >= 0) pending.splice(index, 1)
          },
        }
      },
      onError: (error) => errors.push(error),
    })
    return {
      source,
      board,
      errors,
      events,
      tick: () => pending.shift()?.(),
      pendingCount: () => pending.length,
    }
  }

  it('keeps serving the last board when a cycle fails, and marks it stale', async () => {
    const { source, board, errors } = wire([searchPayload([{ number: 1 }]), rateLimited()])
    await source.start((event) => void event, new AbortController().signal)

    const healthy = await board.board()
    expect(healthy.groups.needs_review).toHaveLength(1)
    expect(healthy.stale).toBe(false)

    await source.refreshNow()

    const degraded = await board.board()
    expect(degraded.groups.needs_review).toHaveLength(1) // last known state survives
    expect(degraded.stale).toBe(true)
    expect(errors).toHaveLength(1)
    expect(source.status().healthy).toBe(false)
    expect(source.status().lastError).toMatch(/rate limit/i)
  })

  it('does not throw out of start when the very first cycle fails', async () => {
    const { source, errors } = wire([rateLimited()])

    await expect(
      source.start((event) => void event, new AbortController().signal),
    ).resolves.toBeUndefined()

    expect(errors).toHaveLength(1)
    expect(source.status().healthy).toBe(false)
  })

  it('keeps polling after a failure and recovers on the next success', async () => {
    const { source, board, tick, pendingCount } = wire([
      rateLimited(),
      searchPayload([{ number: 7 }]),
    ])
    await source.start((event) => void event, new AbortController().signal)

    expect(source.status().healthy).toBe(false)
    expect(pendingCount()).toBe(1) // the schedule survived the failure

    tick()
    await vi.waitUntil(() => source.status().healthy)

    const recovered = await board.board()
    expect(recovered.groups.needs_review.map((pr) => pr.number)).toEqual([7])
    expect(recovered.stale).toBe(false)
    expect(source.status().lastError).toBeUndefined()
  })

  it('collapses concurrent refresh requests into one cycle', async () => {
    let inFlight = 0
    let peak = 0
    const slow = {
      graphql: (async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 30))
        inFlight -= 1
        return searchPayload([{ number: 1 }])
      }) as unknown as GitHubClients['graphql'],
      rest: {} as GitHubClients['rest'],
      identity: async () => ({ login: 'operator', avatarUrl: null }),
      rateLimit: () => null,
      recordRateLimit: () => undefined,
    } satisfies GitHubClients

    const board = new BoardService(repos, slow, tempConfig())
    board.setQuery('org:acme is:pr is:open')
    const source = new PollingSource(board, { intervalMs: () => 60_000, schedule: () => ({ cancel: () => undefined }) })

    await Promise.all([source.refreshNow(), source.refreshNow(), source.refreshNow()])

    expect(peak).toBe(1)
  })
})

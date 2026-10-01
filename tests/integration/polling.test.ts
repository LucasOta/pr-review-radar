import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardService } from '../../src/server/board/service.js'
import { ConfigStore } from '../../src/server/config/store.js'
import { EventBus } from '../../src/server/events/bus.js'
import { PollingSource } from '../../src/server/events/PollingSource.js'
import type { ChangeEvent } from '../../src/server/events/ChangeSource.js'
import type { GitHubClients } from '../../src/server/github/client.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import type { RateLimitInfo } from '../../src/shared/types.js'
import { searchPayload } from '../fixtures/github.js'

function tempConfig(): ConfigStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-poll-'))
  return new ConfigStore(path.join(dir, 'config.json'))
}

function fakeClients(responses: unknown[]) {
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
    recordRateLimit: (info: RateLimitInfo) => {
      rateLimit = info
    },
    get calls() {
      return calls
    },
  } as GitHubClients & { calls: number }
}

/** A schedule the test drives by hand, so cycles are deterministic instead of timer-raced. */
function manualSchedule() {
  const pending: Array<() => void> = []
  return {
    schedule: (fn: () => void) => {
      pending.push(fn)
      return {
        cancel: () => {
          const index = pending.indexOf(fn)
          if (index >= 0) pending.splice(index, 1)
        },
      }
    },
    tick(): void {
      const next = pending.shift()
      next?.()
    },
    get size(): number {
      return pending.length
    },
  }
}

describe('PollingSource', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
  })

  function wire(responses: unknown[], query: string | null = 'org:acme is:pr is:open') {
    const clients = fakeClients(responses)
    const board = new BoardService(repos, clients, tempConfig())
    board.setQuery(query)
    const events: ChangeEvent[] = []
    const cycles: Array<{ at: string; changedCount: number; removedCount: number }> = []
    const errors: unknown[] = []
    const timers = manualSchedule()
    const source = new PollingSource(board, {
      intervalMs: () => 60_000,
      schedule: timers.schedule,
      onCycle: (summary) => cycles.push(summary),
      onError: (error) => errors.push(error),
    })
    const bus = new EventBus()
    bus.subscribe((event) => {
      events.push(event)
    })
    return { source, bus, board, clients, events, cycles, errors, timers }
  }

  it('emits one event per changed pull request on the first cycle', async () => {
    const { source, bus, events } = wire([searchPayload([{ number: 1 }, { number: 2 }])])

    await source.start((event) => bus.publish(event), new AbortController().signal)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'pull_request.changed', repo: 'acme/widgets', number: 1 })
    expect(source.status().healthy).toBe(true)
    expect(source.status().lastSuccessAt).toBeTruthy()
  })

  // Constitution V: a quiet cycle must cost nothing beyond the one query.
  it('emits nothing when no pull request changed', async () => {
    const same = searchPayload([{ number: 1, headSha: 'aaa1111', updatedAt: '2026-09-02T10:00:00Z' }])
    const { source, bus, events, cycles, timers } = wire([same, same])

    await source.start((event) => bus.publish(event), new AbortController().signal)
    expect(events).toHaveLength(1)

    timers.tick()
    await vi.waitUntil(() => cycles.length === 2)

    expect(events).toHaveLength(1)
    expect(cycles[1]).toEqual({ at: cycles[1]?.at, changedCount: 0, removedCount: 0 })
  })

  it('emits exactly one event when a head moves', async () => {
    const { source, bus, events, cycles, timers } = wire([
      searchPayload([{ number: 1, headSha: 'aaa1111', updatedAt: '2026-09-02T10:00:00Z' }]),
      searchPayload([{ number: 1, headSha: 'bbb2222', updatedAt: '2026-09-02T11:00:00Z' }]),
    ])

    await source.start((event) => bus.publish(event), new AbortController().signal)
    timers.tick()
    await vi.waitUntil(() => cycles.length === 2)

    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ number: 1, headSha: 'bbb2222' })
  })

  it('emits a removal when a pull request leaves the query', async () => {
    const { source, bus, events, cycles, timers } = wire([
      searchPayload([{ number: 1 }, { number: 2 }]),
      searchPayload([{ number: 1 }]),
    ])

    await source.start((event) => bus.publish(event), new AbortController().signal)
    timers.tick()
    await vi.waitUntil(() => cycles.length === 2)

    expect(events.filter((event) => event.type === 'pull_request.removed')).toEqual([
      { type: 'pull_request.removed', repo: 'acme/widgets', number: 2, source: 'polling' },
    ])
  })

  it('idles instead of polling while no query is set', async () => {
    const { source, bus, events, clients } = wire([searchPayload([{ number: 1 }])], null)

    await source.start((event) => bus.publish(event), new AbortController().signal)
    await source.refreshNow()

    expect(clients.calls).toBe(0)
    expect(events).toHaveLength(0)
    expect(source.status().healthy).toBe(true)
  })

  it('picks up a query set after it started, without a restart', async () => {
    const { source, bus, board, events } = wire([searchPayload([{ number: 1 }])], null)
    await source.start((event) => bus.publish(event), new AbortController().signal)
    expect(events).toHaveLength(0)

    board.setQuery('org:acme is:pr is:open')
    await source.refreshNow()

    expect(events).toHaveLength(1)
  })

  it('stops scheduling once aborted', async () => {
    const { source, bus, timers } = wire([searchPayload([{ number: 1 }])])
    const controller = new AbortController()

    await source.start((event) => bus.publish(event), controller.signal)
    expect(timers.size).toBe(1)

    controller.abort()
    expect(timers.size).toBe(0)
  })
})

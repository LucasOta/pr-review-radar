import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { EventHub, registerEventStream } from '../../src/server/http/sse.js'
import { applyPullRequest, countRows, removePullRequest } from '../../src/web/board.js'
import type { BoardResponse, PullRequestView } from '../../src/shared/types.js'
import { emptyGroups } from '../../src/server/domain/view.js'

let app: FastifyInstance | null = null

afterEach(async () => {
  await app?.close()
  app = null
})

function view(over: Partial<PullRequestView> = {}): PullRequestView {
  return {
    repo: 'acme/widgets',
    number: 1,
    title: 'Add widget',
    author: 'dev',
    isDraft: false,
    url: 'https://github.com/acme/widgets/pull/1',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    headSha: 'aaa1111',
    baseRef: 'main',
    status: 'needs_review',
    commitsSinceChangesRequested: 0,
    lastRun: null,
    lastPostedReview: null,
    pendingDraftId: null,
    ...over,
  }
}

function board(rows: PullRequestView[]): BoardResponse {
  const response: BoardResponse = {
    operator: { login: 'operator', avatarUrl: null },
    queue: { active: 0, queued: 0 },
    query: 'org:acme is:pr is:open',
    lastRefreshAt: '2026-09-02T10:00:00Z',
    stale: false,
    rateLimit: null,
    groups: emptyGroups(),
    repoErrors: [],
  }
  return rows.reduce(applyPullRequest, response)
}

describe('event stream', () => {
  it('delivers named events in SSE wire format', async () => {
    const hub = new EventHub()
    app = Fastify()
    registerEventStream(app, hub)
    const address = await app.listen({ host: '127.0.0.1', port: 0 })

    const response = await fetch(`${address}/api/events`)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()
    const decoder = new TextDecoder()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(hub.clientCount).toBe(1)

    hub.broadcast('pr.updated', { pullRequest: view({ number: 42 }) })

    let text = ''
    while (!text.includes('pr.updated')) {
      const chunk = await reader!.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value)
    }

    expect(text).toContain('retry: 3000')
    expect(text).toContain('event: pr.updated')
    const payload = text.slice(text.indexOf('event: pr.updated'))
    const data = payload.slice(payload.indexOf('data: ') + 6, payload.indexOf('\n\n', payload.indexOf('data: ')))
    expect(JSON.parse(data)).toMatchObject({ pullRequest: { number: 42 } })

    await reader!.cancel()
  })

  it('forgets a client that disconnects', async () => {
    const hub = new EventHub()
    app = Fastify()
    registerEventStream(app, hub)
    const address = await app.listen({ host: '127.0.0.1', port: 0 })

    const controller = new AbortController()
    await fetch(`${address}/api/events`, { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(hub.clientCount).toBe(1)

    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(hub.clientCount).toBe(0)
  })

  it('broadcasting with no clients is a no-op', () => {
    const hub = new EventHub()
    expect(() => hub.broadcast('refresh.completed', { at: 'now', changedCount: 0, rateLimit: null })).not.toThrow()
  })
})

describe('board reducers', () => {
  it('moves a row to its new group in place (FR-035)', () => {
    const start = board([view({ number: 1 }), view({ number: 2 })])
    expect(start.groups.needs_review).toHaveLength(2)

    const next = applyPullRequest(start, view({ number: 1, status: 'ready_for_human' }))

    expect(next.groups.needs_review.map((row) => row.number)).toEqual([2])
    expect(next.groups.ready_for_human.map((row) => row.number)).toEqual([1])
    expect(countRows(next)).toBe(2)
  })

  it('replaces rather than duplicates a row that is updated in place', () => {
    const start = board([view({ number: 1, title: 'old' })])
    const next = applyPullRequest(start, view({ number: 1, title: 'new' }))

    expect(next.groups.needs_review).toHaveLength(1)
    expect(next.groups.needs_review[0]?.title).toBe('new')
  })

  it('keeps rows ordered by most recently updated', () => {
    const start = board([
      view({ number: 1, updatedAt: '2026-09-02T09:00:00Z' }),
      view({ number: 2, updatedAt: '2026-09-02T08:00:00Z' }),
    ])
    const next = applyPullRequest(start, view({ number: 3, updatedAt: '2026-09-02T12:00:00Z' }))

    expect(next.groups.needs_review.map((row) => row.number)).toEqual([3, 1, 2])
  })

  it('removes a row from whichever group it was in', () => {
    const start = board([view({ number: 1, status: 'ready_for_human' }), view({ number: 2 })])
    const next = removePullRequest(start, 'acme/widgets', 1)

    expect(countRows(next)).toBe(1)
    expect(next.groups.ready_for_human).toHaveLength(0)
  })

  it('ignores a removal for a pull request it never had', () => {
    const start = board([view({ number: 1 })])
    expect(countRows(removePullRequest(start, 'acme/widgets', 99))).toBe(1)
  })
})

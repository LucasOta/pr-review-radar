import type { FastifyInstance, FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import { isUsableQuery, type ReviewKind } from '../../shared/types.js'
import type { BoardService } from '../board/service.js'
import type { ConfigStore } from '../config/store.js'
import type { ReviewQueue } from '../review/queue.js'
import { QueueError } from '../review/queue.js'
import type { DraftService } from '../review/drafts.js'
import { DraftError } from '../review/drafts.js'
import type { ReviewPoster } from '../github/post.js'
import { PostError } from '../github/post.js'
import type { Repositories } from '../store/repos.js'
import type { EventHub } from './sse.js'
import type { ChangeSource } from '../events/ChangeSource.js'

export interface RouteDeps {
  board: BoardService
  config: ConfigStore
  repos: Repositories
  queue: ReviewQueue
  drafts: DraftService
  poster: ReviewPoster
  hub: EventHub
  source: ChangeSource
  /** Triggers an out-of-band refresh — the polling source's refreshNow. */
  refreshNow: () => Promise<void>
}

interface QueryParam {
  q?: string
}

interface PullParams {
  owner: string
  name: string
  number: string
}

const QUEUE_STATUS: Record<string, number> = {
  run_in_progress: 409,
  already_reviewed: 409,
  unknown_pull_request: 404,
  no_changes_requested: 409,
}

const POST_STATUS: Record<string, number> = {
  unknown_draft: 404,
  draft_not_ready: 409,
  already_posted: 409,
  stale_head: 409,
  pull_request_closed: 410,
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // --- board -------------------------------------------------------------

  /**
   * The browser owns the query (localStorage) and sends it along. Omitting `q` reads the board
   * with whatever query the session already adopted, which is what a second tab or a `curl`
   * does.
   */
  app.get<{ Querystring: QueryParam }>('/api/board', async (request) => {
    const incoming = request.query.q
    if (incoming !== undefined) {
      const changed = deps.board.setQuery(incoming)
      if (changed && isUsableQuery(incoming)) {
        void deps.refreshNow().catch(() => undefined)
      }
    }
    return deps.board.board()
  })

  app.post<{ Body?: { query?: string } }>('/api/refresh', async (request, reply) => {
    const incoming = request.body?.query
    if (incoming !== undefined) deps.board.setQuery(incoming)
    if (!isUsableQuery(deps.board.query)) {
      return reply.code(409).send({ error: 'no_query', message: 'Set a search query first.' })
    }
    void deps.refreshNow().catch(() => undefined)
    return reply.code(202).send({ accepted: true })
  })

  // --- config ------------------------------------------------------------

  app.get('/api/config', async () => deps.config.get())

  app.put('/api/config', async (request, reply) => {
    try {
      return deps.config.update(request.body)
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: 'invalid_config',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        })
      }
      throw error
    }
  })

  // --- review runs -------------------------------------------------------

  app.post<{ Params: PullParams; Body?: { kind?: ReviewKind; force?: boolean } }>(
    '/api/pulls/:owner/:name/:number/review',
    async (request, reply) => {
      const repo = `${request.params.owner}/${request.params.name}`
      const number = Number(request.params.number)
      const kind: ReviewKind = request.body?.kind === 'rereview' ? 'rereview' : 'review'

      try {
        const run = deps.queue.enqueue({ repo, number, kind, force: request.body?.force ?? false })
        return reply.code(202).send({ runId: run.id, status: run.status })
      } catch (error) {
        return sendQueueError(reply, error)
      }
    },
  )

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (request, reply) => {
    const run = deps.queue.cancel(request.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown_run' })
    return { status: run.status }
  })

  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request, reply) => {
    const run = deps.repos.getRun(request.params.runId)
    if (!run) return reply.code(404).send({ error: 'unknown_run' })
    const draft = deps.repos.listPendingDrafts().find((candidate) => candidate.runId === run.id)
    return { ...run, draftId: draft?.id ?? null }
  })

  app.get('/api/runs', async () => ({
    active: deps.queue.activeCount,
    queued: deps.queue.queuedCount,
  }))

  // --- drafts ------------------------------------------------------------

  app.get('/api/drafts', async () => deps.drafts.listPending())

  app.get<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    try {
      return deps.drafts.get(request.params.id)
    } catch (error) {
      return sendDraftError(reply, error)
    }
  })

  app.patch<{ Params: { id: string }; Body?: { body?: string } }>(
    '/api/drafts/:id',
    async (request, reply) => {
      const body = request.body?.body
      if (typeof body !== 'string' || body.trim() === '') {
        return reply.code(400).send({ error: 'invalid_body', message: 'A review body is required.' })
      }
      try {
        return deps.drafts.edit(request.params.id, body)
      } catch (error) {
        return sendDraftError(reply, error)
      }
    },
  )

  app.post<{ Params: { id: string } }>('/api/drafts/:id/discard', async (request, reply) => {
    try {
      const draft = deps.drafts.discard(request.params.id)
      deps.hub.broadcast('draft.resolved', { draftId: draft.id, status: draft.status })
      broadcastRow(deps, draft.repo, draft.number)
      return { status: draft.status }
    } catch (error) {
      return sendDraftError(reply, error)
    }
  })

  /** The only route in the application that writes to GitHub (Constitution III). */
  app.post<{ Params: { id: string }; Body?: { acknowledgeStaleHead?: boolean } }>(
    '/api/drafts/:id/post',
    async (request, reply) => {
      try {
        const posted = await deps.poster.post({
          draftId: request.params.id,
          acknowledgeStaleHead: request.body?.acknowledgeStaleHead ?? false,
        })
        deps.hub.broadcast('draft.resolved', {
          draftId: request.params.id,
          status: 'posted',
          commentUrl: posted.commentUrl,
        })
        broadcastRow(deps, posted.repo, posted.number)
        return reply.code(201).send({
          commentUrl: posted.commentUrl,
          commentId: posted.commentId,
          postedAt: posted.postedAt,
          postedAs: posted.postedAs,
        })
      } catch (error) {
        if (error instanceof PostError) {
          return reply
            .code(POST_STATUS[error.code] ?? 400)
            .send({ error: error.code, message: error.message, ...error.detail })
        }
        throw error
      }
    },
  )

  // --- health ------------------------------------------------------------

  app.get('/api/health', async () => ({
    ok: true,
    hasQuery: isUsableQuery(deps.board.query),
    lastRefreshError: deps.board.lastRefreshError,
    activeRuns: deps.queue.activeCount,
    queuedRuns: deps.queue.queuedCount,
    source: { name: deps.source.name, ...deps.source.status() },
    streamClients: deps.hub.clientCount,
  }))
}

/** Pushes one recomputed row to open boards. A pull request that already left is simply skipped. */
function broadcastRow(deps: RouteDeps, repo: string, number: number): void {
  const view = deps.board.view(repo, number)
  if (view) deps.hub.broadcast('pr.updated', { pullRequest: view })
}

function sendQueueError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof QueueError) {
    return reply
      .code(QUEUE_STATUS[error.code] ?? 400)
      .send({ error: error.code, message: error.message, ...error.detail })
  }
  throw error
}

function sendDraftError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DraftError) {
    return reply
      .code(error.code === 'unknown_draft' ? 404 : 409)
      .send({ error: error.code, message: error.message })
  }
  throw error
}

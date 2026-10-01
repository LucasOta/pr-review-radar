import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { isUsableQuery } from '../../shared/types.js'
import type { BoardService } from '../board/service.js'
import type { ConfigStore } from '../config/store.js'

export interface RouteDeps {
  board: BoardService
  config: ConfigStore
  /** Triggers an out-of-band refresh. US3 replaces this with the polling source's refreshNow. */
  refreshNow: () => Promise<void>
}

interface QueryParam {
  q?: string
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
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

  app.post<{ Body?: { query?: string } }>('/api/refresh', async (request, reply) => {
    const incoming = request.body?.query
    if (incoming !== undefined) deps.board.setQuery(incoming)
    if (!isUsableQuery(deps.board.query)) {
      return reply.code(409).send({ error: 'no_query', message: 'Set a search query first.' })
    }
    void deps.refreshNow().catch(() => undefined)
    return reply.code(202).send({ accepted: true })
  })

  app.get('/api/health', async () => ({
    ok: true,
    hasQuery: isUsableQuery(deps.board.query),
    lastRefreshError: deps.board.lastRefreshError,
  }))
}

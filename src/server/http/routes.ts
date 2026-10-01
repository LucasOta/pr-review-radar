import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { BoardService } from '../board/service.js'
import type { ConfigStore } from '../config/store.js'

export interface RouteDeps {
  board: BoardService
  config: ConfigStore
  /** Triggers an out-of-band refresh. US3 replaces this with the polling source's refreshNow. */
  refreshNow: () => Promise<void>
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/board', async () => deps.board.board())

  app.get('/api/config', async () => deps.config.get())

  app.put('/api/config', async (request, reply) => {
    try {
      const updated = deps.config.update(request.body)
      // A new query invalidates nothing cached, but the board should catch up immediately.
      void deps.refreshNow().catch(() => undefined)
      return updated
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

  app.post('/api/refresh', async (_request, reply) => {
    void deps.refreshNow().catch(() => undefined)
    return reply.code(202).send({ accepted: true })
  })

  app.get('/api/health', async () => ({
    ok: true,
    lastRefreshError: deps.board.lastRefreshError,
  }))
}

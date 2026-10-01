import Fastify from 'fastify'
import { BoardService } from './board/service.js'
import { ConfigStore } from './config/store.js'
import { createClients } from './github/client.js'
import { registerRoutes } from './http/routes.js'
import { registerStatic } from './http/static.js'
import { formatPreflightError, preflight, PreflightError } from './preflight.js'
import { openDatabase } from './store/db.js'
import { Repositories } from './store/repos.js'
import { DiffFetcher } from './github/diff.js'
import { ReviewQueue } from './review/queue.js'
import { DraftService } from './review/drafts.js'
import { ReviewPoster } from './github/post.js'

const HOST = '127.0.0.1'

async function main(): Promise<void> {
  const checks = await preflight()

  const config = new ConfigStore()
  const db = openDatabase()
  const repos = new Repositories(db)
  const clients = createClients(checks.token)
  const board = new BoardService(repos, clients, config)
  const diffs = new DiffFetcher(clients.rest, () => config.get().maxDiffBytes)
  const drafts = new DraftService(repos)
  const poster = new ReviewPoster(clients.rest, repos, () => clients.identity())

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', transport: undefined },
  })

  let refreshing: Promise<void> | null = null
  const refreshNow = async (): Promise<void> => {
    if (refreshing) return refreshing
    refreshing = board
      .refresh()
      .then((outcome) => {
        app.log.info(
          { changed: outcome.changed.length, removed: outcome.removed.length },
          'refresh completed',
        )
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'refresh failed; serving last known board')
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  const queue = new ReviewQueue(repos, diffs, () => config.get(), {
    onRunUpdated: (run) => app.log.info({ runId: run.id, status: run.status }, 'run updated'),
    onDraftReady: (draft) =>
      app.log.info({ draftId: draft.id, repo: draft.repo, number: draft.number }, 'draft ready'),
  })

  registerRoutes(app, { board, config, repos, queue, drafts, poster, refreshNow })
  await registerStatic(app)

  const { port } = config.get()
  await app.listen({ host: HOST, port })

  const identity = await clients.identity().catch(() => null)
  app.log.info(`Acting as ${identity?.login ?? 'unknown GitHub user'}`)
  // The query lives in the browser; the board adopts it when the UI connects.
  app.log.info(`Board at http://${HOST}:${port}`)

  const shutdown = async (): Promise<void> => {
    await app.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  if (error instanceof PreflightError) {
    process.stderr.write(formatPreflightError(error) + '\n')
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

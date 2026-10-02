import Fastify from 'fastify'
import { BoardService } from './board/service.js'
import { ConfigStore } from './config/store.js'
import { EventBus } from './events/bus.js'
import { PollingSource } from './events/PollingSource.js'
import { createClients } from './github/client.js'
import { DiffFetcher } from './github/diff.js'
import { ReviewPoster } from './github/post.js'
import { registerRoutes } from './http/routes.js'
import { EventHub, registerEventStream } from './http/sse.js'
import { registerStatic } from './http/static.js'
import { formatPreflightError, preflight, PreflightError } from './preflight.js'
import { DraftService } from './review/drafts.js'
import { ReviewQueue } from './review/queue.js'
import { REDACT_PATHS, redactSecrets } from './log.js'
import { openDatabase } from './store/db.js'
import { Repositories } from './store/repos.js'

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
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: undefined,
      // Belt and braces: redact by key, and scrub any credential-shaped string that slips
      // through in a message (Constitution I).
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((arg) =>
            typeof arg === 'string' ? redactSecrets(arg, checks.token) : arg,
          )
          method.apply(this, scrubbed as typeof args)
        },
      },
    },
  })

  const hub = new EventHub()

  const queue = new ReviewQueue(repos, diffs, () => config.get(), {
    onRunUpdated: (run) => {
      app.log.info(
        {
          runId: run.id,
          repo: run.repo,
          number: run.number,
          headSha: run.headSha.slice(0, 7),
          kind: run.kind,
          status: run.status,
          ...(run.error ? { error: run.error } : {}),
        },
        'review run',
      )
      hub.broadcast('run.updated', {
        runId: run.id,
        repo: run.repo,
        number: run.number,
        status: run.status,
        ...(run.error ? { error: run.error } : {}),
      })
      const view = board.view(run.repo, run.number)
      if (view) hub.broadcast('pr.updated', { pullRequest: view })
    },
    onDraftReady: (draft) => {
      app.log.info(
        { runId: draft.runId, draftId: draft.id, repo: draft.repo, number: draft.number },
        'review ready to preview',
      )
      hub.broadcast('draft.ready', {
        draftId: draft.id,
        runId: draft.runId,
        repo: draft.repo,
        number: draft.number,
        headSha: draft.headSha,
      })
    },
  })

  const bus = new EventBus({
    onConsumerError: (error) => app.log.error({ err: error }, 'event consumer failed'),
  })

  // The only consumer today: push the affected row to open boards. Consumers must stay
  // idempotent — the bus guarantees one delivery per distinct change, not per source.
  bus.subscribe((event) => {
    if (event.type === 'pull_request.removed') {
      hub.broadcast('pr.removed', { repo: event.repo, number: event.number })
      return
    }
    const view = board.view(event.repo, event.number)
    if (view) hub.broadcast('pr.updated', { pullRequest: view })
  })

  const source = new PollingSource(board, {
    intervalMs: () => config.get().refreshIntervalMs,
    onCycle: ({ at, changedCount }) => {
      hub.broadcast('refresh.completed', { at, changedCount, rateLimit: clients.rateLimit() })
      if (changedCount > 0) app.log.info({ changedCount }, 'refresh changed pull requests')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      app.log.error({ err: error }, 'refresh failed; serving last known board')
      hub.broadcast('error', { scope: 'refresh', message })
    },
  })

  registerRoutes(app, {
    board,
    config,
    repos,
    queue,
    drafts,
    poster,
    hub,
    source,
    refreshNow: () => source.refreshNow(),
  })
  registerEventStream(app, hub)
  await registerStatic(app)

  const { port } = config.get()
  await app.listen({ host: HOST, port })

  const identity = await clients.identity().catch(() => null)
  app.log.info(`Acting as ${identity?.login ?? 'unknown GitHub user'}`)

  const lifetime = new AbortController()
  // The query lives in the browser; the source idles until a board hands one over.
  void source.start((event) => bus.publish(event), lifetime.signal)

  app.log.info(`Board at http://${HOST}:${port}`)

  const shutdown = async (): Promise<void> => {
    lifetime.abort()
    hub.close()
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

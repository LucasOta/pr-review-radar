import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { WEB_DIST_DIR } from '../paths.js'

/**
 * Serves the built board. In development Vite serves the UI on its own port and proxies /api
 * here, so a missing bundle is expected and must not be fatal.
 */
export async function registerStatic(app: FastifyInstance, dir: string = WEB_DIST_DIR): Promise<void> {
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    app.log.info('No built UI found; run `npm run dev:web` or `npm run build:web`.')
    return
  }
  await app.register(fastifyStatic, { root: dir })
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return reply.sendFile('index.html')
  })
}

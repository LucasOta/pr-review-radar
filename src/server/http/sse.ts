import type { FastifyInstance, FastifyReply } from 'fastify'
import type { BoardEventMap, BoardEventName } from '../../shared/events.js'

const HEARTBEAT_MS = 15_000

/**
 * One-way server-to-client updates. SSE over WebSockets because the data only flows one way,
 * reconnects are the browser's job, and `curl` can read it (research.md decision 5).
 */
export class EventHub {
  private readonly clients = new Set<FastifyReply>()
  private heartbeat: NodeJS.Timeout | null = null

  get clientCount(): number {
    return this.clients.size
  }

  add(reply: FastifyReply): void {
    this.clients.add(reply)
    this.startHeartbeat()
  }

  remove(reply: FastifyReply): void {
    this.clients.delete(reply)
    if (this.clients.size === 0) this.stopHeartbeat()
  }

  broadcast<K extends BoardEventName>(name: K, payload: BoardEventMap[K]): void {
    const frame = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) {
      try {
        client.raw.write(frame)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  close(): void {
    this.stopHeartbeat()
    for (const client of this.clients) {
      try {
        client.raw.end()
      } catch {
        // already gone
      }
    }
    this.clients.clear()
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return
    // Comment frames keep proxies and sleeping laptops from dropping the stream silently.
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.raw.write(': heartbeat\n\n')
        } catch {
          this.clients.delete(client)
        }
      }
    }, HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }
}

export function registerEventStream(app: FastifyInstance, hub: EventHub): void {
  app.get('/api/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // The board reconnects itself; tell the browser how long to wait first.
      'x-accel-buffering': 'no',
    })
    reply.raw.write('retry: 3000\n\n')
    hub.add(reply)

    request.raw.on('close', () => hub.remove(reply))
    request.raw.on('error', () => hub.remove(reply))
  })
}

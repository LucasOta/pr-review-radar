import type { ChangeEvent } from './ChangeSource.js'
import { eventKey } from './ChangeSource.js'

export type Consumer = (event: ChangeEvent) => void | Promise<void>

export interface BusOptions {
  /** How many recent event identities to remember when collapsing duplicates. */
  memory?: number
  onConsumerError?: (error: unknown, event: ChangeEvent) => void
}

/**
 * Deduplicates change events and fans them out. Two sources (or one source delivering twice)
 * reporting the same pull request at the same commit produce exactly one re-evaluation —
 * the property that lets a webhook source be added alongside polling without doubling work
 * (FR-036, Constitution IV).
 */
export class EventBus {
  private readonly consumers: Consumer[] = []
  private readonly seen = new Set<string>()
  private readonly order: string[] = []
  private readonly memory: number
  private readonly onConsumerError: (error: unknown, event: ChangeEvent) => void

  constructor(options: BusOptions = {}) {
    this.memory = options.memory ?? 500
    this.onConsumerError = options.onConsumerError ?? (() => undefined)
  }

  subscribe(consumer: Consumer): () => void {
    this.consumers.push(consumer)
    return () => {
      const index = this.consumers.indexOf(consumer)
      if (index >= 0) this.consumers.splice(index, 1)
    }
  }

  /** Returns true when the event was new and was delivered, false when it was a duplicate. */
  publish(event: ChangeEvent): boolean {
    const key = eventKey(event)
    if (this.seen.has(key)) return false

    // A pull request that leaves and comes back must not have its new events mistaken for
    // duplicates of the old ones, in either direction.
    this.forget(
      event.type === 'pull_request.changed'
        ? `r:${event.repo}#${event.number}`
        : `c:${event.repo}#${event.number}@`,
    )
    this.remember(key)

    for (const consumer of this.consumers) {
      try {
        const result = consumer(event)
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.onConsumerError(error, event))
        }
      } catch (error) {
        // One bad consumer must not stop the others.
        this.onConsumerError(error, event)
      }
    }
    return true
  }

  private remember(key: string): void {
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.order.push(key)
    while (this.order.length > this.memory) {
      const oldest = this.order.shift()
      if (oldest) this.seen.delete(oldest)
    }
  }

  /** Drops remembered keys matching a prefix (or one exact key). */
  private forget(prefix: string): void {
    for (let index = this.order.length - 1; index >= 0; index--) {
      const key = this.order[index]
      if (key?.startsWith(prefix)) {
        this.order.splice(index, 1)
        this.seen.delete(key)
      }
    }
  }
}

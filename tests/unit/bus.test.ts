import { describe, expect, it } from 'vitest'
import { EventBus } from '../../src/server/events/bus.js'
import type { ChangeEvent } from '../../src/server/events/ChangeSource.js'

const changed = (over: Partial<Extract<ChangeEvent, { type: 'pull_request.changed' }>> = {}): ChangeEvent => ({
  type: 'pull_request.changed',
  repo: 'acme/widgets',
  number: 1,
  headSha: 'aaa1111',
  updatedAt: '2026-09-02T10:00:00Z',
  source: 'polling',
  ...over,
})

const removed = (number = 1): ChangeEvent => ({
  type: 'pull_request.removed',
  repo: 'acme/widgets',
  number,
  source: 'polling',
})

describe('EventBus', () => {
  // FR-036 / Constitution IV: the same change delivered twice must do the work once.
  it('delivers a repeated event only once', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    expect(bus.publish(changed())).toBe(true)
    expect(bus.publish(changed())).toBe(false)
    expect(bus.publish(changed())).toBe(false)

    expect(seen).toHaveLength(1)
  })

  it('collapses the same change arriving from two different sources', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ source: 'polling' }))
    bus.publish(changed({ source: 'webhook' }))

    expect(seen).toHaveLength(1)
  })

  it('treats a new head SHA as a new event', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ headSha: 'aaa1111' }))
    bus.publish(changed({ headSha: 'bbb2222', updatedAt: '2026-09-02T11:00:00Z' }))

    expect(seen).toHaveLength(2)
  })

  it('treats a new updatedAt at the same head as a new event', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ updatedAt: '2026-09-02T10:00:00Z' }))
    bus.publish(changed({ updatedAt: '2026-09-02T10:05:00Z' }))

    expect(seen).toHaveLength(2)
  })

  it('keeps pull requests independent', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ number: 1 }))
    bus.publish(changed({ number: 2 }))

    expect(seen).toHaveLength(2)
  })

  it('deduplicates removals too', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    expect(bus.publish(removed())).toBe(true)
    expect(bus.publish(removed())).toBe(false)
    expect(seen).toHaveLength(1)
  })

  it('lets a pull request leave and come back without being swallowed', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed())
    bus.publish(removed())
    // Same identity as the first change: it must still be delivered after the removal.
    expect(bus.publish(changed())).toBe(true)
    expect(bus.publish(removed())).toBe(true)

    expect(seen.map((event) => event.type)).toEqual([
      'pull_request.changed',
      'pull_request.removed',
      'pull_request.changed',
      'pull_request.removed',
    ])
  })

  it('fans out to every consumer', () => {
    const bus = new EventBus()
    const first: ChangeEvent[] = []
    const second: ChangeEvent[] = []
    bus.subscribe((event) => {
      first.push(event)
    })
    bus.subscribe((event) => {
      second.push(event)
    })

    bus.publish(changed())

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it('isolates a throwing consumer from the others', () => {
    const errors: unknown[] = []
    const bus = new EventBus({ onConsumerError: (error) => errors.push(error) })
    const survivor: ChangeEvent[] = []

    bus.subscribe(() => {
      throw new Error('consumer exploded')
    })
    bus.subscribe((event) => {
      survivor.push(event)
    })

    expect(() => bus.publish(changed())).not.toThrow()
    expect(survivor).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })

  it('reports a rejected async consumer without losing the event', async () => {
    const errors: unknown[] = []
    const bus = new EventBus({ onConsumerError: (error) => errors.push(error) })
    bus.subscribe(async () => {
      throw new Error('async boom')
    })

    bus.publish(changed())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors).toHaveLength(1)
  })

  it('unsubscribes', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus()
    const off = bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ headSha: 'aaa1111' }))
    off()
    bus.publish(changed({ headSha: 'bbb2222' }))

    expect(seen).toHaveLength(1)
  })

  it('forgets the oldest identities once memory is full', () => {
    const seen: ChangeEvent[] = []
    const bus = new EventBus({ memory: 2 })
    bus.subscribe((event) => {
      seen.push(event)
    })

    bus.publish(changed({ headSha: 'a' }))
    bus.publish(changed({ headSha: 'b' }))
    bus.publish(changed({ headSha: 'c' }))
    // 'a' has aged out, so it is no longer recognized as a duplicate.
    expect(bus.publish(changed({ headSha: 'a' }))).toBe(true)
    expect(seen).toHaveLength(4)
  })
})

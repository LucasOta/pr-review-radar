import { useEffect, useRef } from 'react'
import type { BoardEventMap, BoardEventName } from '@shared/events.js'

type Handlers = {
  [K in BoardEventName]?: (payload: BoardEventMap[K]) => void
} & {
  /** Fired on every (re)connect: the board must resynchronize with a full fetch. */
  onConnect?: () => void
  onDisconnect?: () => void
}

/**
 * Subscribes to the server's event stream. The browser reconnects on its own; every connect
 * triggers a full board fetch so a gap in the stream cannot leave stale rows on screen.
 */
export function useEventStream(handlers: Handlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const source = new EventSource('/api/events')

    const named: BoardEventName[] = [
      'pr.updated',
      'pr.removed',
      'run.updated',
      'draft.ready',
      'draft.resolved',
      'refresh.completed',
      'error',
    ]

    const listeners = named.map((name) => {
      const listener = (event: MessageEvent<string>): void => {
        const handler = ref.current[name] as ((payload: unknown) => void) | undefined
        if (!handler) return
        try {
          handler(JSON.parse(event.data))
        } catch {
          // A malformed frame must not take the board down.
        }
      }
      source.addEventListener(name, listener as EventListener)
      return { name, listener }
    })

    source.onopen = () => ref.current.onConnect?.()
    source.onerror = () => ref.current.onDisconnect?.()

    return () => {
      for (const { name, listener } of listeners) {
        source.removeEventListener(name, listener as EventListener)
      }
      source.close()
    }
  }, [])
}

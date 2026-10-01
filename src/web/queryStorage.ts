import { QUERY_STORAGE_KEY, isUsableQuery } from '@shared/types.js'

/**
 * The operator's search query lives in the browser, not on the server (FR-002). This module is
 * the only thing that touches storage, so it can be tested with a plain fake and so a corrupt or
 * unavailable store degrades to "no query yet" instead of a blank screen.
 */
export interface QueryStore {
  read(): string | null
  write(query: string): void
  clear(): void
}

export function createQueryStore(storage: Storage | undefined = safeStorage()): QueryStore {
  return {
    read(): string | null {
      if (!storage) return null
      try {
        const raw = storage.getItem(QUERY_STORAGE_KEY)
        const trimmed = raw?.trim() ?? ''
        return trimmed === '' ? null : trimmed
      } catch {
        return null
      }
    },
    write(query: string): void {
      if (!storage) return
      try {
        storage.setItem(QUERY_STORAGE_KEY, query.trim())
      } catch {
        // Private browsing or a full quota: the session still works, it just will not persist.
      }
    },
    clear(): void {
      if (!storage) return
      try {
        storage.removeItem(QUERY_STORAGE_KEY)
      } catch {
        // ignore
      }
    },
  }
}

/** True when the stored value can actually be sent to GitHub. */
export function storedQueryIsUsable(store: QueryStore): boolean {
  return isUsableQuery(store.read())
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

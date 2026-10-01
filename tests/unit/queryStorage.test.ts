import { describe, expect, it } from 'vitest'
import { createQueryStore, storedQueryIsUsable } from '../../src/web/queryStorage.js'
import { QUERY_STORAGE_KEY } from '../../src/shared/types.js'

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new DOMException('denied')
  }
  return {
    get length(): number {
      return fail()
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  }
}

describe('query storage', () => {
  it('round-trips a query under the documented key', () => {
    const storage = fakeStorage()
    const store = createQueryStore(storage)

    store.write('org:acme is:pr is:open label:squad')

    expect(storage.getItem(QUERY_STORAGE_KEY)).toBe('org:acme is:pr is:open label:squad')
    expect(store.read()).toBe('org:acme is:pr is:open label:squad')
  })

  it('reads an existing value written by a previous session', () => {
    const store = createQueryStore(fakeStorage({ [QUERY_STORAGE_KEY]: 'org:acme is:pr' }))
    expect(store.read()).toBe('org:acme is:pr')
  })

  it('treats blank and whitespace-only values as no query', () => {
    expect(createQueryStore(fakeStorage({ [QUERY_STORAGE_KEY]: '   ' })).read()).toBeNull()
    expect(createQueryStore(fakeStorage()).read()).toBeNull()
  })

  it('trims on write', () => {
    const storage = fakeStorage()
    createQueryStore(storage).write('  org:acme is:pr  ')
    expect(storage.getItem(QUERY_STORAGE_KEY)).toBe('org:acme is:pr')
  })

  it('clears', () => {
    const storage = fakeStorage({ [QUERY_STORAGE_KEY]: 'org:acme is:pr' })
    const store = createQueryStore(storage)
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('degrades to no-query when storage is unavailable rather than throwing', () => {
    const store = createQueryStore(throwingStorage())
    expect(store.read()).toBeNull()
    expect(() => store.write('org:acme is:pr')).not.toThrow()
    expect(() => store.clear()).not.toThrow()
  })

  it('still works when there is no storage at all', () => {
    const store = createQueryStore(undefined)
    expect(store.read()).toBeNull()
    expect(() => store.write('org:acme is:pr')).not.toThrow()
  })

  it('rejects the shipped placeholder as a usable query', () => {
    const store = createQueryStore(
      fakeStorage({ [QUERY_STORAGE_KEY]: 'org:YOUR_ORG is:pr is:open label:YOUR_LABEL' }),
    )
    expect(store.read()).not.toBeNull()
    expect(storedQueryIsUsable(store)).toBe(false)
  })

  it('accepts a real query as usable', () => {
    const store = createQueryStore(fakeStorage({ [QUERY_STORAGE_KEY]: 'org:acme is:pr is:open' }))
    expect(storedQueryIsUsable(store)).toBe(true)
  })
})

import { randomUUID } from 'node:crypto'

/** Time-ordered-ish ids: sortable prefix plus entropy, readable in logs and the UI. */
export function newId(prefix: string): string {
  const stamp = Date.now().toString(36)
  const random = randomUUID().replace(/-/g, '').slice(0, 10)
  return `${prefix}_${stamp}${random}`
}

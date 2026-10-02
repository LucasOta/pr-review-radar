import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { DraftDetail } from '@shared/types.js'
import { api } from '../api.js'

interface Props {
  /** Bumped whenever something could have changed the pending set. */
  revision: number
  onPreview: (draftId: string) => void
}

/**
 * Reviews waiting on a decision. A sweep can finish several at once, and each still needs its own
 * preview and confirmation — this is how they stay reachable one by one (Constitution III).
 */
export function DraftTray({ revision, onPreview }: Props): JSX.Element | null {
  const [drafts, setDrafts] = useState<DraftDetail[]>([])

  useEffect(() => {
    let cancelled = false
    void api
      .drafts()
      .then((pending) => {
        if (!cancelled) setDrafts(pending)
      })
      .catch(() => {
        if (!cancelled) setDrafts([])
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  if (drafts.length === 0) return null

  return (
    <section className="banner tray">
      <strong>
        {drafts.length} review{drafts.length === 1 ? '' : 's'} waiting for you
      </strong>
      <ul className="tray-list">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <button type="button" className="link" onClick={() => onPreview(draft.id)}>
              {draft.repo}#{draft.number}
            </button>
            <code>{draft.headSha.slice(0, 7)}</code>
            {!draft.headShaIsCurrent && <span className="warn">pull request has moved on</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

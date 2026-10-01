import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { DraftDetail } from '@shared/types.js'
import { ApiError, api } from '../api.js'

interface Props {
  draftId: string
  onClose: () => void
  onResolved: () => void
}

/**
 * Reading, editing, and deciding. Posting happens only from the explicit Post button here — the
 * app has no other path to GitHub (Constitution III).
 */
export function ReviewPreview({ draftId, onClose, onResolved }: Props): JSX.Element {
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleConfirm, setStaleConfirm] = useState<{ current: string } | null>(null)
  const [posted, setPosted] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .draft(draftId)
      .then((loaded) => {
        if (cancelled) return
        setDraft(loaded)
        setBody(loaded.body)
        setPosted(loaded.postedCommentUrl)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [draftId])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.editDraft(draftId, body)
      setDraft(updated)
      setEditing(false)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const post = async (acknowledgeStaleHead = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.postDraft(draftId, acknowledgeStaleHead)
      setPosted(result.commentUrl)
      setStaleConfirm(null)
      onResolved()
    } catch (cause) {
      if (cause instanceof ApiError && isStaleHead(cause)) {
        const detail = cause.body as { currentHeadSha?: string }
        setStaleConfirm({ current: detail.currentHeadSha ?? 'unknown' })
      } else {
        setError(messageOf(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  const discard = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.discardDraft(draftId)
      onResolved()
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Review preview">
      <div className="panel">
        <header className="panel-head">
          <div>
            <strong>Review preview</strong>
            {draft && (
              <span className="muted">
                {' '}
                {draft.repo}#{draft.number} at <code>{draft.headSha.slice(0, 7)}</code>
              </span>
            )}
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {!draft && !error && <p className="muted">Loading…</p>}

        {draft && !draft.headShaIsCurrent && !posted && (
          <p className="warn">
            This review describes <code>{draft.headSha.slice(0, 7)}</code>, but the pull request is
            now at <code>{(draft.currentHeadSha ?? '').slice(0, 7)}</code>.
          </p>
        )}

        {posted && (
          <p className="ok">
            Posted.{' '}
            <a href={posted} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </p>
        )}

        {draft && !posted && editing && (
          <textarea
            className="draft-edit"
            value={body}
            rows={20}
            onChange={(event) => setBody(event.target.value)}
          />
        )}

        {draft && (!editing || posted) && <pre className="draft-body">{draft.body}</pre>}

        {error && <p className="error">{error}</p>}

        {staleConfirm && (
          <p className="warn">
            The pull request moved to <code>{staleConfirm.current.slice(0, 7)}</code> since this was
            written. Post it anyway?{' '}
            <button type="button" onClick={() => void post(true)} disabled={busy}>
              Post anyway
            </button>
          </p>
        )}

        {draft && !posted && (
          <div className="actions">
            <button type="button" onClick={() => void post()} disabled={busy || editing}>
              {busy ? 'Working…' : 'Post to GitHub'}
            </button>
            {editing ? (
              <button type="button" className="secondary" onClick={() => void save()} disabled={busy}>
                Save edit
              </button>
            ) : (
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button type="button" className="secondary" onClick={() => void discard()} disabled={busy}>
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function isStaleHead(error: ApiError): boolean {
  return (error.body as { error?: string }).error === 'stale_head'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

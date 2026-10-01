import type { JSX } from 'react'
import { useState } from 'react'
import type { PullRequestView, ReviewKind } from '@shared/types.js'
import { ApiError, api } from '../api.js'

interface Props {
  pullRequest: PullRequestView
  onChanged: () => void
  onPreview: (draftId: string) => void
}

export function PullRequestRow({ pullRequest, onChanged, onPreview }: Props): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = async (kind: ReviewKind, force = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.requestReview(pullRequest.repo, pullRequest.number, kind, force)
      onChanged()
    } catch (cause) {
      if (cause instanceof ApiError && code(cause) === 'already_reviewed') {
        setError('Already reviewed at this commit — use Re-run to review it again.')
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!pullRequest.lastRun) return
    setBusy(true)
    try {
      await api.cancelRun(pullRequest.lastRun.id)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="row">
      <div className="row-main">
        <a className="row-title" href={pullRequest.url} target="_blank" rel="noreferrer">
          {pullRequest.title}
        </a>
        {pullRequest.isDraft && <span className="tag tag-draft">draft</span>}
        {pullRequest.status === 'awaiting_rereview' &&
          pullRequest.commitsSinceChangesRequested > 0 && (
            <span className="tag tag-stale">
              +{pullRequest.commitsSinceChangesRequested} commit
              {pullRequest.commitsSinceChangesRequested === 1 ? '' : 's'} since changes requested
            </span>
          )}
        <span className="row-actions">
          {pullRequest.pendingDraftId && (
            <button type="button" onClick={() => onPreview(pullRequest.pendingDraftId as string)}>
              Preview review
            </button>
          )}
          {pullRequest.status === 'running' ? (
            <button type="button" className="secondary" onClick={() => void cancel()} disabled={busy}>
              Cancel
            </button>
          ) : pullRequest.status === 'awaiting_rereview' ? (
            <button type="button" onClick={() => void request('rereview')} disabled={busy}>
              {busy ? 'Starting…' : 'Request re-review'}
            </button>
          ) : pullRequest.status === 'ready_for_human' ? (
            <button
              type="button"
              className="secondary"
              onClick={() => void request('review', true)}
              disabled={busy}
            >
              Re-run
            </button>
          ) : (
            <button type="button" onClick={() => void request('review')} disabled={busy}>
              {busy ? 'Starting…' : 'Request AI review'}
            </button>
          )}
        </span>
      </div>
      <div className="row-meta">
        <span className="repo">
          {pullRequest.repo}#{pullRequest.number}
        </span>
        <span>{pullRequest.author}</span>
        <span title={pullRequest.createdAt}>opened {relative(pullRequest.createdAt)}</span>
        <span title={pullRequest.updatedAt}>updated {relative(pullRequest.updatedAt)}</span>
        <code title={pullRequest.headSha}>{pullRequest.headSha.slice(0, 7)}</code>
        {pullRequest.lastPostedReview ? (
          <a href={pullRequest.lastPostedReview.commentUrl} target="_blank" rel="noreferrer">
            AI review {relative(pullRequest.lastPostedReview.postedAt)} on{' '}
            {pullRequest.lastPostedReview.headSha.slice(0, 7)}
          </a>
        ) : (
          <span className="muted">no AI review</span>
        )}
        {pullRequest.lastRun?.status === 'failed' && (
          <span className="error">last run failed: {pullRequest.lastRun.error ?? 'unknown'}</span>
        )}
        {error && <span className="error">{error}</span>}
      </div>
    </li>
  )
}

function code(error: ApiError): string | undefined {
  return (error.body as { error?: string }).error
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

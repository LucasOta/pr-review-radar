import type { JSX } from 'react'
import { useState } from 'react'
import type { PullRequestStatus, PullRequestView } from '@shared/types.js'
import { BULK_GROUPS, STATUS_LABELS } from '@shared/types.js'
import { api } from '../api.js'
import { PullRequestRow } from './PullRequestRow.js'

interface Props {
  status: PullRequestStatus
  pullRequests: PullRequestView[]
  onChanged: () => void
  onPreview: (draftId: string) => void
}

export function StatusGroup({ status, pullRequests, onChanged, onPreview }: Props): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (pullRequests.length === 0) return null

  const bulkable = BULK_GROUPS.includes(status)
  const label = status === 'awaiting_rereview' ? 'Re-review all' : 'Review all'

  const reviewAll = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const result = await api.bulkReview(status)
      // Never imply a sweep covered more than it did.
      const parts = [`${result.enqueued.length} queued`]
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped (${summarize(result.skipped)})`)
      setNote(parts.join(', '))
      onChanged()
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`group group-${status}`}>
      <h2>
        <span className={`dot dot-${status}`} aria-hidden="true" />
        {STATUS_LABELS[status]}
        <span className="count">{pullRequests.length}</span>
        {bulkable && (
          <button
            type="button"
            className="group-action"
            onClick={() => void reviewAll()}
            disabled={busy}
            aria-label={`${label} ${pullRequests.length} pull request(s) in ${STATUS_LABELS[status]}`}
          >
            {busy ? 'Queueing…' : `${label} (${pullRequests.length})`}
          </button>
        )}
        {note && (
          <span className="group-note muted" role="status">
            {note}
          </span>
        )}
      </h2>
      <ul className="rows">
        {pullRequests.map((pullRequest) => (
          <PullRequestRow
            key={`${pullRequest.repo}#${pullRequest.number}`}
            pullRequest={pullRequest}
            onChanged={onChanged}
            onPreview={onPreview}
          />
        ))}
      </ul>
    </section>
  )
}

function summarize(skipped: Array<{ reason: string }>): string {
  const counts = new Map<string, number>()
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  return [...counts.entries()].map(([reason, count]) => `${count} ${reason.replace(/_/g, ' ')}`).join(', ')
}

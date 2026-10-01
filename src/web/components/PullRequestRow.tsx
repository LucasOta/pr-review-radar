import type { JSX } from 'react'
import type { PullRequestView } from '@shared/types.js'

interface Props {
  pullRequest: PullRequestView
}

export function PullRequestRow({ pullRequest }: Props): JSX.Element {
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
      </div>
    </li>
  )
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

import type { JSX } from 'react'
import type { PullRequestStatus, PullRequestView } from '@shared/types.js'
import { STATUS_LABELS } from '@shared/types.js'
import { PullRequestRow } from './PullRequestRow.js'

interface Props {
  status: PullRequestStatus
  pullRequests: PullRequestView[]
}

export function StatusGroup({ status, pullRequests }: Props): JSX.Element | null {
  if (pullRequests.length === 0) return null
  return (
    <section className={`group group-${status}`}>
      <h2>
        <span className={`dot dot-${status}`} aria-hidden="true" />
        {STATUS_LABELS[status]}
        <span className="count">{pullRequests.length}</span>
      </h2>
      <ul className="rows">
        {pullRequests.map((pullRequest) => (
          <PullRequestRow
            key={`${pullRequest.repo}#${pullRequest.number}`}
            pullRequest={pullRequest}
          />
        ))}
      </ul>
    </section>
  )
}

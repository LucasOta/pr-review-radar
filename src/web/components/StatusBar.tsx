import type { JSX } from 'react'
import type { BoardResponse } from '@shared/types.js'

interface Props {
  board: BoardResponse
  /** The browser's query, which may be ahead of the one the board was built from. */
  query: string | null
  /** Whether the event stream is connected — the board is live rather than merely loaded. */
  live: boolean
  onRefresh: () => void
  onEditQuery: () => void
}

export function StatusBar({ board, query, live, onRefresh, onEditQuery }: Props): JSX.Element {
  return (
    <div className="statusbar">
      <span className="operator">
        {board.operator.avatarUrl && (
          <img src={board.operator.avatarUrl} alt="" width={20} height={20} />
        )}
        {board.operator.login}
      </span>
      <button
        type="button"
        className="link"
        onClick={onEditQuery}
        title={query ?? 'No query set — click to set one'}
      >
        <code>{query ? truncate(query, 48) : 'set a query'}</code>
      </button>
      {board.rateLimit && (
        <span className="muted" title={`resets ${board.rateLimit.resetAt}`}>
          API {board.rateLimit.remaining}/{board.rateLimit.limit}
        </span>
      )}
      <span className={live ? 'muted' : 'warn'} title={live ? 'Receiving live updates' : 'Not connected to the update stream'}>
        {live ? 'live' : 'offline'}
      </span>
      <span className={board.stale ? 'warn' : 'muted'}>
        {board.lastRefreshAt
          ? `refreshed ${new Date(board.lastRefreshAt).toLocaleTimeString()}`
          : 'never refreshed'}
        {board.stale && ' (stale)'}
      </span>
      <button type="button" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

import type { BoardResponse, PullRequestView } from '@shared/types.js'
import { STATUS_ORDER } from '@shared/types.js'

/** Replaces one row in place, moving it between groups when its status changed (FR-035). */
export function applyPullRequest(board: BoardResponse, view: PullRequestView): BoardResponse {
  const groups = { ...board.groups }
  for (const status of STATUS_ORDER) {
    groups[status] = groups[status].filter(
      (row) => !(row.repo === view.repo && row.number === view.number),
    )
  }
  groups[view.status] = [view, ...groups[view.status]].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
  return { ...board, groups }
}

export function removePullRequest(
  board: BoardResponse,
  repo: string,
  number: number,
): BoardResponse {
  const groups = { ...board.groups }
  for (const status of STATUS_ORDER) {
    groups[status] = groups[status].filter((row) => !(row.repo === repo && row.number === number))
  }
  return { ...board, groups }
}

export function countRows(board: BoardResponse): number {
  return STATUS_ORDER.reduce((sum, status) => sum + board.groups[status].length, 0)
}

import { describe, expect, it } from 'vitest'
import {
  commitsSinceChangesRequested,
  headCommittedAt,
  latestChangesRequested,
} from '../../src/server/domain/staleness.js'
import { commit, review, snapshot } from '../fixtures/github.js'

describe('staleness', () => {
  it('counts zero when nothing requested changes', () => {
    expect(commitsSinceChangesRequested(snapshot())).toBe(0)
  })

  it('counts only commits strictly after the changes-requested review', () => {
    const value = commitsSinceChangesRequested(
      snapshot({
        reviews: [review('CHANGES_REQUESTED', '2026-09-02T08:00:00Z')],
        commits: [
          commit('a', '2026-09-02T07:00:00Z'),
          commit('b', '2026-09-02T08:00:00Z'), // exactly at the review: part of what was reviewed
          commit('c', '2026-09-02T09:00:00Z'),
          commit('d', '2026-09-02T10:00:00Z'),
        ],
      }),
    )
    expect(value).toBe(2)
  })

  it('uses the most recent changes-requested review when several exist', () => {
    const latest = latestChangesRequested([
      review('CHANGES_REQUESTED', '2026-09-01T08:00:00Z'),
      review('CHANGES_REQUESTED', '2026-09-03T08:00:00Z'),
      review('COMMENTED', '2026-09-04T08:00:00Z'),
    ])
    expect(latest?.submittedAt).toBe('2026-09-03T08:00:00Z')
  })

  it('finds the head commit timestamp, or null when the head is not in the window', () => {
    expect(headCommittedAt(snapshot())).toBe('2026-09-02T09:00:00Z')
    expect(headCommittedAt(snapshot({ headSha: 'zzz9999' }))).toBeNull()
  })
})

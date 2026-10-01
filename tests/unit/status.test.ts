import { describe, expect, it } from 'vitest'
import { classify } from '../../src/server/domain/status.js'
import type { PostedReview, ReviewRun } from '../../src/shared/types.js'
import { commit, review, snapshot } from '../fixtures/github.js'

function run(overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
    id: 'run_1',
    repo: 'acme/widgets',
    number: 1,
    headSha: 'aaa1111',
    kind: 'review',
    status: 'succeeded',
    forced: false,
    startedAt: '2026-09-02T10:00:00Z',
    finishedAt: '2026-09-02T10:02:00Z',
    exitCode: 0,
    stderrTail: null,
    error: null,
    ...overrides,
  }
}

function posted(headSha: string, postedAt = '2026-09-02T10:03:00Z'): PostedReview {
  return {
    id: 'post_1',
    draftId: 'draft_1',
    repo: 'acme/widgets',
    number: 1,
    headSha,
    commentId: 1,
    commentUrl: 'https://github.com/acme/widgets/pull/1#issuecomment-1',
    postedAt,
    postedAs: 'operator',
  }
}

describe('classify', () => {
  it('reports needs_review when nothing has reviewed the head', () => {
    const result = classify({ snapshot: snapshot(), runs: [], posted: [] })
    expect(result.status).toBe('needs_review')
  })

  it('reports running while a run is queued or in flight', () => {
    for (const status of ['queued', 'running'] as const) {
      const result = classify({ snapshot: snapshot(), runs: [run({ status })], posted: [] })
      expect(result.status).toBe('running')
    }
  })

  it('running wins over every other signal', () => {
    const result = classify({
      snapshot: snapshot({ reviews: [review('CHANGES_REQUESTED', '2026-09-02T08:00:00Z')] }),
      runs: [run({ status: 'running' })],
      posted: [posted('aaa1111')],
    })
    expect(result.status).toBe('running')
  })

  it('reports error when the newest run for the current head failed', () => {
    const result = classify({
      snapshot: snapshot(),
      runs: [run({ status: 'failed', error: 'claude exited 1' })],
      posted: [],
    })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('claude exited 1')
  })

  it('does not report error when a later run for the same head succeeded', () => {
    const result = classify({
      snapshot: snapshot(),
      runs: [
        run({ id: 'old', status: 'failed', finishedAt: '2026-09-02T10:01:00Z' }),
        run({ id: 'new', status: 'succeeded', finishedAt: '2026-09-02T10:05:00Z' }),
      ],
      posted: [posted('aaa1111')],
    })
    expect(result.status).toBe('ready_for_human')
  })

  it('ignores a failed run that targeted an older head', () => {
    const result = classify({
      snapshot: snapshot({ headSha: 'bbb2222' }),
      runs: [run({ headSha: 'aaa1111', status: 'failed' })],
      posted: [],
    })
    expect(result.status).toBe('needs_review')
  })

  it('reports ready_for_human when the current head carries a posted AI review', () => {
    const result = classify({ snapshot: snapshot(), runs: [run()], posted: [posted('aaa1111')] })
    expect(result.status).toBe('ready_for_human')
  })

  it('treats a recovered comment marker as covering the head (survives a deleted database)', () => {
    const result = classify({
      snapshot: snapshot({ aiCommentMarkers: ['aaa1111'] }),
      runs: [],
      posted: [],
    })
    expect(result.status).toBe('ready_for_human')
  })

  it('reports awaiting_rereview when changes were requested and commits landed after', () => {
    const result = classify({
      snapshot: snapshot({
        headSha: 'bbb2222',
        reviews: [review('CHANGES_REQUESTED', '2026-09-02T08:00:00Z')],
        commits: [
          commit('aaa1111', '2026-09-02T07:00:00Z'),
          commit('bbb2222', '2026-09-02T09:00:00Z'),
        ],
      }),
      runs: [],
      posted: [posted('aaa1111')],
    })
    expect(result.status).toBe('awaiting_rereview')
    expect(result.commitsSinceChangesRequested).toBe(1)
  })

  // FR-007: the operator's explicit rule. New commits alone are NOT a re-review trigger.
  it('does NOT report awaiting_rereview for new commits without a changes-requested review', () => {
    const result = classify({
      snapshot: snapshot({
        headSha: 'bbb2222',
        reviews: [review('COMMENTED', '2026-09-02T08:00:00Z')],
        commits: [
          commit('aaa1111', '2026-09-02T07:00:00Z'),
          commit('bbb2222', '2026-09-02T09:00:00Z'),
        ],
      }),
      runs: [],
      posted: [posted('aaa1111')],
    })
    expect(result.status).toBe('needs_review')
    expect(result.commitsSinceChangesRequested).toBe(0)
  })

  it('also ignores an approval followed by new commits', () => {
    const result = classify({
      snapshot: snapshot({
        headSha: 'ccc3333',
        reviews: [review('APPROVED', '2026-09-02T08:00:00Z')],
        commits: [commit('ccc3333', '2026-09-02T09:00:00Z')],
      }),
      runs: [],
      posted: [],
    })
    expect(result.status).toBe('needs_review')
  })

  it('leaves awaiting_rereview once the new head has been re-reviewed', () => {
    const result = classify({
      snapshot: snapshot({
        headSha: 'bbb2222',
        reviews: [review('CHANGES_REQUESTED', '2026-09-02T08:00:00Z')],
        commits: [
          commit('aaa1111', '2026-09-02T07:00:00Z'),
          commit('bbb2222', '2026-09-02T09:00:00Z'),
        ],
      }),
      runs: [run({ headSha: 'bbb2222' })],
      posted: [posted('bbb2222', '2026-09-02T10:00:00Z')],
    })
    expect(result.status).toBe('ready_for_human')
  })

  it('keeps a reviewed head out of ready when changes were requested on that very head', () => {
    const result = classify({
      snapshot: snapshot({
        headSha: 'bbb2222',
        reviews: [review('CHANGES_REQUESTED', '2026-09-02T11:00:00Z')],
        commits: [
          commit('aaa1111', '2026-09-02T07:00:00Z'),
          commit('bbb2222', '2026-09-02T09:00:00Z'),
        ],
      }),
      runs: [],
      posted: [posted('bbb2222')],
    })
    expect(result.status).toBe('needs_review')
  })

  it('assigns exactly one status per pull request (FR-006)', () => {
    const cases = [
      classify({ snapshot: snapshot(), runs: [], posted: [] }),
      classify({ snapshot: snapshot(), runs: [run({ status: 'running' })], posted: [] }),
      classify({ snapshot: snapshot(), runs: [run({ status: 'failed' })], posted: [] }),
      classify({ snapshot: snapshot(), runs: [], posted: [posted('aaa1111')] }),
    ]
    for (const result of cases) {
      expect(typeof result.status).toBe('string')
    }
    expect(new Set(cases.map((c) => c.status)).size).toBe(4)
  })
})

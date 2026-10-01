import type { PullRequestSnapshot, SnapshotCommit, SnapshotReview } from '../../src/server/store/repos.js'

export function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    repo: 'acme/widgets',
    number: 1,
    nodeId: 'PR_1',
    title: 'Add widget',
    author: 'dev',
    isDraft: false,
    url: 'https://github.com/acme/widgets/pull/1',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    headSha: 'aaa1111',
    baseRef: 'main',
    reviews: [],
    commits: [{ sha: 'aaa1111', committedAt: '2026-09-02T09:00:00Z' }],
    aiCommentMarkers: [],
    fetchedAt: '2026-09-02T10:05:00Z',
    ...overrides,
  }
}

export function review(
  state: SnapshotReview['state'],
  submittedAt: string,
  author = 'reviewer',
): SnapshotReview {
  return { state, submittedAt, author }
}

export function commit(sha: string, committedAt: string): SnapshotCommit {
  return { sha, committedAt }
}

/** A GraphQL search payload shaped like the real one, for fetchBoard tests. */
export function searchPayload(
  pullRequests: Array<{
    repo?: string
    number: number
    title?: string
    headSha?: string
    updatedAt?: string
    isDraft?: boolean
    reviews?: Array<{ state: string; submittedAt: string; login?: string }>
    commits?: Array<{ oid: string; committedDate: string }>
    comments?: string[]
  }>,
  options: { hasNextPage?: boolean; endCursor?: string | null; remaining?: number } = {},
) {
  return {
    rateLimit: { limit: 5000, remaining: options.remaining ?? 4990, resetAt: '2026-10-01T19:00:00Z' },
    search: {
      issueCount: pullRequests.length,
      pageInfo: { hasNextPage: options.hasNextPage ?? false, endCursor: options.endCursor ?? null },
      nodes: pullRequests.map((pr) => ({
        __typename: 'PullRequest',
        id: `PR_${pr.number}`,
        number: pr.number,
        title: pr.title ?? `PR ${pr.number}`,
        url: `https://github.com/${pr.repo ?? 'acme/widgets'}/pull/${pr.number}`,
        isDraft: pr.isDraft ?? false,
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: pr.updatedAt ?? '2026-09-02T10:00:00Z',
        baseRefName: 'main',
        headRefOid: pr.headSha ?? 'aaa1111',
        repository: { nameWithOwner: pr.repo ?? 'acme/widgets' },
        author: { login: 'dev' },
        reviews: {
          nodes: (pr.reviews ?? []).map((r) => ({
            state: r.state,
            submittedAt: r.submittedAt,
            author: { login: r.login ?? 'reviewer' },
          })),
        },
        commits: {
          nodes: (pr.commits ?? [{ oid: pr.headSha ?? 'aaa1111', committedDate: '2026-09-02T09:00:00Z' }]).map(
            (c) => ({ commit: c }),
          ),
        },
        comments: { nodes: (pr.comments ?? []).map((body) => ({ body })) },
      })),
    },
  }
}

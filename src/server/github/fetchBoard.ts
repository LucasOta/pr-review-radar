import type { RateLimitInfo, RepoError } from '../../shared/types.js'
import type { PullRequestSnapshot, SnapshotCommit, SnapshotReview } from '../store/repos.js'
import { BOARD_QUERY, extractMarkerShas } from './queries.js'

export interface BoardQueryVariables {
  q: string
  cursor: string | null
}

/** Minimal transport shape so tests can hand in fixtures instead of a live Octokit. */
export type GraphQLTransport = <T>(query: string, variables: BoardQueryVariables) => Promise<T>

export interface FetchBoardResult {
  snapshots: PullRequestSnapshot[]
  rateLimit: RateLimitInfo | null
  repoErrors: RepoError[]
  totalCount: number
}

interface SearchResponse {
  rateLimit?: { limit: number; remaining: number; resetAt: string } | null
  search: {
    issueCount: number
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<PullRequestNode | { __typename: string } | null>
  }
}

interface PullRequestNode {
  __typename: 'PullRequest'
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  baseRefName: string
  headRefOid: string
  repository: { nameWithOwner: string }
  author: { login: string } | null
  reviews: { nodes: Array<{ state: string; submittedAt: string | null; author: { login: string } | null } | null> }
  commits: { nodes: Array<{ commit: { oid: string; committedDate: string } } | null> }
  comments: { nodes: Array<{ body: string } | null> }
}

const MAX_PAGES = 8

/**
 * Pages the search and maps nodes to snapshots. Partial failures (a repository the token cannot
 * read) are returned as repoErrors so the rest of the board still loads (FR-042).
 */
export async function fetchBoard(
  transport: GraphQLTransport,
  query: string,
  now: () => string = () => new Date().toISOString(),
): Promise<FetchBoardResult> {
  const snapshots: PullRequestSnapshot[] = []
  const repoErrors: RepoError[] = []
  let rateLimit: RateLimitInfo | null = null
  let cursor: string | null = null
  let totalCount = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    let response: SearchResponse
    try {
      response = await transport<SearchResponse>(BOARD_QUERY, { q: query, cursor })
    } catch (error) {
      const partial = partialFrom(error)
      if (!partial) throw error
      repoErrors.push(...partial.repoErrors)
      response = partial.data
    }

    if (response.rateLimit) {
      rateLimit = {
        limit: response.rateLimit.limit,
        remaining: response.rateLimit.remaining,
        resetAt: response.rateLimit.resetAt,
      }
    }
    totalCount = response.search.issueCount
    const fetchedAt = now()

    for (const node of response.search.nodes) {
      if (!node || node.__typename !== 'PullRequest') continue
      snapshots.push(toSnapshot(node as PullRequestNode, fetchedAt))
    }

    if (!response.search.pageInfo.hasNextPage) break
    cursor = response.search.pageInfo.endCursor
    if (!cursor) break
  }

  return { snapshots, rateLimit, repoErrors, totalCount }
}

function toSnapshot(node: PullRequestNode, fetchedAt: string): PullRequestSnapshot {
  const reviews: SnapshotReview[] = node.reviews.nodes
    .filter((review): review is NonNullable<typeof review> => Boolean(review?.submittedAt))
    .map((review) => ({
      author: review.author?.login ?? 'unknown',
      state: review.state as SnapshotReview['state'],
      submittedAt: review.submittedAt as string,
    }))

  const commits: SnapshotCommit[] = node.commits.nodes
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({ sha: entry.commit.oid, committedAt: entry.commit.committedDate }))

  const bodies = node.comments.nodes
    .filter((comment): comment is NonNullable<typeof comment> => Boolean(comment))
    .map((comment) => comment.body)

  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    nodeId: node.id,
    title: node.title,
    author: node.author?.login ?? 'ghost',
    isDraft: node.isDraft,
    url: node.url,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    headSha: node.headRefOid,
    baseRef: node.baseRefName,
    reviews,
    commits,
    aiCommentMarkers: extractMarkerShas(bodies),
    fetchedAt,
  }
}

/**
 * GitHub answers a partially-authorized search with data AND errors. Octokit raises that as an
 * exception carrying both, so the readable half is still usable.
 */
function partialFrom(error: unknown): { data: SearchResponse; repoErrors: RepoError[] } | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { data?: unknown; errors?: Array<{ message?: string; path?: unknown[] }> }
  if (!candidate.data || typeof candidate.data !== 'object') return null
  const data = candidate.data as SearchResponse
  if (!data.search) return null
  const repoErrors = (candidate.errors ?? []).map((graphqlError) => ({
    repo: repoFromPath(graphqlError.path) ?? 'unknown',
    message: graphqlError.message ?? 'GraphQL error',
  }))
  return { data, repoErrors }
}

function repoFromPath(path: unknown[] | undefined): string | null {
  if (!Array.isArray(path)) return null
  return path.filter((segment) => typeof segment === 'string').join('.') || null
}

/**
 * One batched query per refresh cycle. REST would cost one call per pull request per signal and
 * exhaust the hourly limit on a 50-pull-request board (research.md decision 1).
 */
export const BOARD_QUERY = /* GraphQL */ `
  query Board($q: String!, $cursor: String) {
    rateLimit {
      limit
      remaining
      resetAt
    }
    search(query: $q, type: ISSUE, first: 25, after: $cursor) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        __typename
        ... on PullRequest {
          id
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          baseRefName
          headRefOid
          repository {
            nameWithOwner
          }
          author {
            login
          }
          reviews(last: 30) {
            nodes {
              state
              submittedAt
              author {
                login
              }
            }
          }
          commits(last: 30) {
            nodes {
              commit {
                oid
                committedDate
              }
            }
          }
          comments(last: 20) {
            nodes {
              body
            }
          }
        }
      }
    }
  }
`

/** Marker appended to every review this app posts, so its own comments stay recognizable. */
export const MARKER_PREFIX = 'pr-review-radar:draft:'

export function buildMarker(draftId: string, headSha: string): string {
  return `<!-- ${MARKER_PREFIX}${draftId}:sha:${headSha} -->`
}

const MARKER_RE = /<!--\s*pr-review-radar:draft:[^:]+:sha:([0-9a-f]{7,40})\s*-->/g

/** Head SHAs this app has already reviewed, recovered from the pull request's comments. */
export function extractMarkerShas(bodies: string[]): string[] {
  const shas = new Set<string>()
  for (const body of bodies) {
    for (const match of body.matchAll(MARKER_RE)) {
      if (match[1]) shas.add(match[1])
    }
  }
  return [...shas]
}

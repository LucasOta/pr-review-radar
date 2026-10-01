import { Octokit } from '@octokit/rest'
import { throttling } from '@octokit/plugin-throttling'
import { graphql as octokitGraphql } from '@octokit/graphql'
import type { OperatorIdentity, RateLimitInfo } from '../../shared/types.js'

const ThrottledOctokit = Octokit.plugin(throttling)

export interface GitHubClients {
  /** Read path: batched board queries. */
  graphql: typeof octokitGraphql
  /** Read path: diffs. Also carries the mutating methods, which only github/post.ts may use. */
  rest: Octokit
  identity(): Promise<OperatorIdentity>
  rateLimit(): RateLimitInfo | null
  recordRateLimit(info: RateLimitInfo): void
}

export function createClients(token: string, log = console): GitHubClients {
  let lastRateLimit: RateLimitInfo | null = null

  const rest = new ThrottledOctokit({
    auth: token,
    userAgent: 'pr-review-radar',
    throttle: {
      // Back off rather than fail hard (FR-040).
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        log.warn(`GitHub rate limit hit on ${options.method} ${options.url}; waiting ${retryAfter}s`)
        return retryCount < 2
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        log.warn(`GitHub secondary rate limit on ${options.method} ${options.url}`)
        return retryCount < 2
      },
    },
  })

  const graphql = octokitGraphql.defaults({
    headers: { authorization: `token ${token}`, 'user-agent': 'pr-review-radar' },
  })

  let cachedIdentity: OperatorIdentity | null = null

  return {
    graphql,
    rest,
    async identity(): Promise<OperatorIdentity> {
      if (cachedIdentity) return cachedIdentity
      const { data } = await rest.users.getAuthenticated()
      cachedIdentity = { login: data.login, avatarUrl: data.avatar_url ?? null }
      return cachedIdentity
    },
    rateLimit: () => lastRateLimit,
    recordRateLimit: (info: RateLimitInfo) => {
      lastRateLimit = info
    },
  }
}

import type { BoardResponse, RateLimitInfo, RepoError } from '../../shared/types.js'
import type { GitHubClients } from '../github/client.js'
import { fetchBoard, type GraphQLTransport } from '../github/fetchBoard.js'
import { buildView, groupViews } from '../domain/view.js'
import type { ConfigStore } from '../config/store.js'
import type { PullRequestSnapshot, Repositories } from '../store/repos.js'
import { isPlaceholderQuery } from '../../shared/types.js'

const LAST_REFRESH_KEY = 'lastRefreshAt'

export interface RefreshOutcome {
  changed: Array<{ repo: string; number: number; headSha: string; updatedAt: string }>
  removed: Array<{ repo: string; number: number }>
  rateLimit: RateLimitInfo | null
  repoErrors: RepoError[]
  at: string
}

/**
 * Owns the cache of GitHub facts and composes the board. Status is never stored — it is computed
 * on every read so the board cannot drift from GitHub (Constitution II).
 */
export class BoardService {
  private repoErrors: RepoError[] = []
  private lastError: string | null = null

  constructor(
    private readonly repos: Repositories,
    private readonly clients: GitHubClients,
    private readonly config: ConfigStore,
  ) {}

  /**
   * Pulls the current search result, writes changed snapshots, prunes departed pull requests.
   * Returns which pull requests actually moved — the caller decides what to do with that
   * (US3 turns it into events). Unchanged pull requests are not rewritten (Constitution V).
   */
  async refresh(): Promise<RefreshOutcome> {
    const query = this.config.get().searchQuery
    const at = new Date().toISOString()

    if (isPlaceholderQuery(query)) {
      this.lastError = null
      return { changed: [], removed: [], rateLimit: this.clients.rateLimit(), repoErrors: [], at }
    }

    const transport: GraphQLTransport = (document, variables) =>
      this.clients.graphql(document, { ...variables }) as Promise<never>

    try {
      const result = await fetchBoard(transport, query)
      const changed: RefreshOutcome['changed'] = []
      const seen = new Set<string>()

      for (const snapshot of result.snapshots) {
        seen.add(`${snapshot.repo}#${snapshot.number}`)
        const previous = this.repos.getSnapshot(snapshot.repo, snapshot.number)
        if (!hasChanged(previous, snapshot)) continue
        this.repos.upsertSnapshot(snapshot)
        changed.push({
          repo: snapshot.repo,
          number: snapshot.number,
          headSha: snapshot.headSha,
          updatedAt: snapshot.updatedAt,
        })
      }

      const removed = this.repos.pruneSnapshotsNotIn(seen)

      if (result.rateLimit) this.clients.recordRateLimit(result.rateLimit)
      this.repoErrors = result.repoErrors
      this.repos.setState(LAST_REFRESH_KEY, at)
      this.lastError = null

      return { changed, removed, rateLimit: result.rateLimit, repoErrors: result.repoErrors, at }
    } catch (error) {
      // Keep serving the last known board (FR-041).
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async board(): Promise<BoardResponse> {
    const config = this.config.get()
    const snapshots = this.repos.listSnapshots()
    const views = snapshots.map((snapshot) =>
      buildView({
        snapshot,
        runs: this.repos.listRunsFor(snapshot.repo, snapshot.number),
        posted: this.repos.listPostedFor(snapshot.repo, snapshot.number),
        pendingDraft: this.repos.findPendingDraft(snapshot.repo, snapshot.number),
      }),
    )

    const lastRefreshAt = this.repos.getState(LAST_REFRESH_KEY)

    return {
      operator: await this.clients.identity(),
      query: config.searchQuery,
      lastRefreshAt,
      stale: this.isStale(lastRefreshAt, config.refreshIntervalMs),
      rateLimit: this.clients.rateLimit(),
      groups: groupViews(views),
      repoErrors: this.repoErrors,
    }
  }

  get lastRefreshError(): string | null {
    return this.lastError
  }

  private isStale(lastRefreshAt: string | null, intervalMs: number): boolean {
    if (this.lastError) return true
    if (!lastRefreshAt) return true
    const age = Date.now() - Date.parse(lastRefreshAt)
    return age > intervalMs * 3
  }
}

/** A pull request is unchanged when neither its head nor its updatedAt moved (FR-033). */
export function hasChanged(
  previous: PullRequestSnapshot | null,
  next: PullRequestSnapshot,
): boolean {
  if (!previous) return true
  return previous.headSha !== next.headSha || previous.updatedAt !== next.updatedAt
}

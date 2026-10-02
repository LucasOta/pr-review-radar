import type { BoardResponse, PullRequestView, RateLimitInfo, RepoError } from '../../shared/types.js'
import type { GitHubClients } from '../github/client.js'
import { fetchBoard, type GraphQLTransport } from '../github/fetchBoard.js'
import { buildView, groupViews } from '../domain/view.js'
import type { ConfigStore } from '../config/store.js'
import type { PullRequestSnapshot, Repositories } from '../store/repos.js'
import { isUsableQuery } from '../../shared/types.js'

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
  /**
   * The query the browser is currently watching. Owned by localStorage on the client and pushed
   * here with each request; the server only remembers it for the lifetime of the process so the
   * background poller has a target. Nothing about the query is written to disk.
   */
  private activeQuery: string | null = null

  constructor(
    private readonly repos: Repositories,
    private readonly clients: GitHubClients,
    private readonly config: ConfigStore,
  ) {}

  /**
   * Adopts the browser's query. Changing it invalidates the cache, which holds snapshots that
   * matched the previous query — dropping them is free (Constitution II). Returns true when the
   * query actually changed, so the caller knows a refresh is due.
   */
  setQuery(query: string | null): boolean {
    const next = query?.trim() ?? null
    if (next === this.activeQuery) return false
    this.activeQuery = next
    this.repos.clearSnapshots()
    this.repoErrors = []
    this.lastError = null
    this.repos.setState(LAST_REFRESH_KEY, '')
    return true
  }

  get query(): string | null {
    return this.activeQuery
  }

  /**
   * Pulls the current search result, writes changed snapshots, prunes departed pull requests.
   * Returns which pull requests actually moved — the caller decides what to do with that
   * (US3 turns it into events). Unchanged pull requests are not rewritten (Constitution V).
   */
  async refresh(): Promise<RefreshOutcome> {
    const query = this.activeQuery
    const at = new Date().toISOString()

    if (!isUsableQuery(query)) {
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

  /** One row, recomputed from current facts. Used to push a single update to an open board. */
  view(repo: string, number: number): PullRequestView | null {
    const snapshot = this.repos.getSnapshot(repo, number)
    if (!snapshot) return null
    return buildView({
      snapshot,
      runs: this.repos.listRunsFor(repo, number),
      posted: this.repos.listPostedFor(repo, number),
      pendingDraft: this.repos.findPendingDraft(repo, number),
    })
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

    const lastRefreshAt = this.repos.getState(LAST_REFRESH_KEY) || null

    return {
      operator: await this.clients.identity(),
      queue: { active: 0, queued: 0 },
      query: this.activeQuery,
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
    // Without a query there is nothing to be stale about.
    if (!isUsableQuery(this.activeQuery)) return false
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

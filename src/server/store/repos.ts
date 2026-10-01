import type { DatabaseSync } from 'node:sqlite'
import type {
  DraftStatus,
  PostedReview,
  ReviewDraft,
  ReviewKind,
  ReviewRun,
  RunStatus,
} from '../../shared/types.js'

/** A review GitHub knows about, as recorded on a snapshot. */
export interface SnapshotReview {
  author: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  submittedAt: string
}

export interface SnapshotCommit {
  sha: string
  committedAt: string
}

export interface PullRequestSnapshot {
  repo: string
  number: number
  nodeId: string
  title: string
  author: string
  isDraft: boolean
  url: string
  createdAt: string
  updatedAt: string
  headSha: string
  baseRef: string
  reviews: SnapshotReview[]
  commits: SnapshotCommit[]
  aiCommentMarkers: string[]
  fetchedAt: string
}

type Row = Record<string, unknown>

const str = (row: Row, key: string): string => String(row[key] ?? '')
const num = (row: Row, key: string): number => Number(row[key] ?? 0)
const nullableStr = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key])
const nullableNum = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : Number(row[key])

/**
 * The only module that touches SQL. Keeping access here means swapping the storage engine is a
 * one-module change (see research.md decision 4).
 */
export class Repositories {
  constructor(private readonly db: DatabaseSync) {}

  // --- snapshots (cache) ---------------------------------------------------

  listSnapshots(): PullRequestSnapshot[] {
    const rows = this.db
      .prepare('SELECT * FROM pull_request_snapshots ORDER BY updated_at DESC')
      .all() as Row[]
    return rows.map(toSnapshot)
  }

  getSnapshot(repo: string, number: number): PullRequestSnapshot | null {
    const row = this.db
      .prepare('SELECT * FROM pull_request_snapshots WHERE repo = ? AND number = ?')
      .get(repo, number) as Row | undefined
    return row ? toSnapshot(row) : null
  }

  upsertSnapshot(snapshot: PullRequestSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO pull_request_snapshots
           (repo, number, node_id, title, author, is_draft, url, created_at, updated_at,
            head_sha, base_ref, reviews_json, commits_json, ai_comment_markers_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo, number) DO UPDATE SET
           node_id = excluded.node_id,
           title = excluded.title,
           author = excluded.author,
           is_draft = excluded.is_draft,
           url = excluded.url,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           head_sha = excluded.head_sha,
           base_ref = excluded.base_ref,
           reviews_json = excluded.reviews_json,
           commits_json = excluded.commits_json,
           ai_comment_markers_json = excluded.ai_comment_markers_json,
           fetched_at = excluded.fetched_at`,
      )
      .run(
        snapshot.repo,
        snapshot.number,
        snapshot.nodeId,
        snapshot.title,
        snapshot.author,
        snapshot.isDraft ? 1 : 0,
        snapshot.url,
        snapshot.createdAt,
        snapshot.updatedAt,
        snapshot.headSha,
        snapshot.baseRef,
        JSON.stringify(snapshot.reviews),
        JSON.stringify(snapshot.commits),
        JSON.stringify(snapshot.aiCommentMarkers),
        snapshot.fetchedAt,
      )
  }

  deleteSnapshot(repo: string, number: number): void {
    this.db
      .prepare('DELETE FROM pull_request_snapshots WHERE repo = ? AND number = ?')
      .run(repo, number)
  }

  /** Removes every snapshot not present in the given set — pull requests that left the query. */
  pruneSnapshotsNotIn(keys: ReadonlySet<string>): Array<{ repo: string; number: number }> {
    const rows = this.db.prepare('SELECT repo, number FROM pull_request_snapshots').all() as Row[]
    const removed: Array<{ repo: string; number: number }> = []
    for (const row of rows) {
      const repo = str(row, 'repo')
      const number = num(row, 'number')
      if (!keys.has(`${repo}#${number}`)) {
        this.deleteSnapshot(repo, number)
        removed.push({ repo, number })
      }
    }
    return removed
  }

  // --- runs ----------------------------------------------------------------

  listRunsFor(repo: string, number: number): ReviewRun[] {
    const rows = this.db
      .prepare('SELECT * FROM review_runs WHERE repo = ? AND number = ? ORDER BY created_at DESC')
      .all(repo, number) as Row[]
    return rows.map(toRun)
  }

  listAllRuns(): ReviewRun[] {
    return (this.db.prepare('SELECT * FROM review_runs ORDER BY created_at DESC').all() as Row[])
      .map(toRun)
  }

  getRun(id: string): ReviewRun | null {
    const row = this.db.prepare('SELECT * FROM review_runs WHERE id = ?').get(id) as Row | undefined
    return row ? toRun(row) : null
  }

  insertRun(run: ReviewRun & { createdAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO review_runs
           (id, repo, number, head_sha, kind, status, forced, created_at, started_at,
            finished_at, exit_code, stderr_tail, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.repo,
        run.number,
        run.headSha,
        run.kind satisfies ReviewKind,
        run.status satisfies RunStatus,
        run.forced ? 1 : 0,
        run.createdAt,
        run.startedAt,
        run.finishedAt,
        run.exitCode,
        run.stderrTail,
        run.error,
      )
  }

  updateRun(id: string, patch: Partial<Omit<ReviewRun, 'id'>>): void {
    const columns: Record<string, string> = {
      status: 'status',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      exitCode: 'exit_code',
      stderrTail: 'stderr_tail',
      error: 'error',
      forced: 'forced',
      headSha: 'head_sha',
    }
    const sets: string[] = []
    const values: Array<string | number | null> = []
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue
      const value = (patch as Record<string, unknown>)[key]
      sets.push(`${column} = ?`)
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE review_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  /** Backs the "already reviewed this SHA" skip (FR-022). */
  hasSucceededRunForSha(repo: string, number: number, headSha: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM review_runs
         WHERE repo = ? AND number = ? AND head_sha = ? AND status = 'succeeded' LIMIT 1`,
      )
      .get(repo, number, headSha) as Row | undefined
    return row !== undefined
  }

  findActiveRun(repo: string, number: number): ReviewRun | null {
    const row = this.db
      .prepare(
        `SELECT * FROM review_runs
         WHERE repo = ? AND number = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(repo, number) as Row | undefined
    return row ? toRun(row) : null
  }

  // --- drafts --------------------------------------------------------------

  getDraft(id: string): ReviewDraft | null {
    const row = this.db.prepare('SELECT * FROM review_drafts WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? toDraft(row) : null
  }

  findPendingDraft(repo: string, number: number): ReviewDraft | null {
    const row = this.db
      .prepare(
        `SELECT * FROM review_drafts
         WHERE repo = ? AND number = ? AND status = 'ready'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(repo, number) as Row | undefined
    return row ? toDraft(row) : null
  }

  listPendingDrafts(): ReviewDraft[] {
    return (
      this.db
        .prepare("SELECT * FROM review_drafts WHERE status = 'ready' ORDER BY created_at DESC")
        .all() as Row[]
    ).map(toDraft)
  }

  insertDraft(draft: ReviewDraft): void {
    this.db
      .prepare(
        `INSERT INTO review_drafts
           (id, run_id, repo, number, head_sha, body, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.id,
        draft.runId,
        draft.repo,
        draft.number,
        draft.headSha,
        draft.body,
        draft.status,
        draft.createdAt,
        draft.updatedAt,
      )
  }

  updateDraft(id: string, patch: { body?: string; status?: DraftStatus; updatedAt: string }): void {
    const sets = ['updated_at = ?']
    const values: Array<string | number> = [patch.updatedAt]
    if (patch.body !== undefined) {
      sets.unshift('body = ?')
      values.unshift(patch.body)
    }
    if (patch.status !== undefined) {
      sets.push('status = ?')
      values.push(patch.status)
    }
    values.push(id)
    this.db.prepare(`UPDATE review_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  // --- posted reviews ------------------------------------------------------

  insertPostedReview(posted: PostedReview): void {
    this.db
      .prepare(
        `INSERT INTO posted_reviews
           (id, draft_id, repo, number, head_sha, comment_id, comment_url, posted_at, posted_as)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        posted.id,
        posted.draftId,
        posted.repo,
        posted.number,
        posted.headSha,
        posted.commentId,
        posted.commentUrl,
        posted.postedAt,
        posted.postedAs,
      )
  }

  getPostedByDraft(draftId: string): PostedReview | null {
    const row = this.db.prepare('SELECT * FROM posted_reviews WHERE draft_id = ?').get(draftId) as
      | Row
      | undefined
    return row ? toPosted(row) : null
  }

  listPostedFor(repo: string, number: number): PostedReview[] {
    return (
      this.db
        .prepare('SELECT * FROM posted_reviews WHERE repo = ? AND number = ? ORDER BY posted_at DESC')
        .all(repo, number) as Row[]
    ).map(toPosted)
  }

  listAllPosted(): PostedReview[] {
    return (
      this.db.prepare('SELECT * FROM posted_reviews ORDER BY posted_at DESC').all() as Row[]
    ).map(toPosted)
  }

  // --- app state -----------------------------------------------------------

  getState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
      | Row
      | undefined
    return row ? str(row, 'value') : null
  }

  setState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }
}

function toSnapshot(row: Row): PullRequestSnapshot {
  return {
    repo: str(row, 'repo'),
    number: num(row, 'number'),
    nodeId: str(row, 'node_id'),
    title: str(row, 'title'),
    author: str(row, 'author'),
    isDraft: num(row, 'is_draft') === 1,
    url: str(row, 'url'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
    headSha: str(row, 'head_sha'),
    baseRef: str(row, 'base_ref'),
    reviews: JSON.parse(str(row, 'reviews_json') || '[]') as SnapshotReview[],
    commits: JSON.parse(str(row, 'commits_json') || '[]') as SnapshotCommit[],
    aiCommentMarkers: JSON.parse(str(row, 'ai_comment_markers_json') || '[]') as string[],
    fetchedAt: str(row, 'fetched_at'),
  }
}

function toRun(row: Row): ReviewRun {
  return {
    id: str(row, 'id'),
    repo: str(row, 'repo'),
    number: num(row, 'number'),
    headSha: str(row, 'head_sha'),
    kind: str(row, 'kind') as ReviewKind,
    status: str(row, 'status') as RunStatus,
    forced: num(row, 'forced') === 1,
    startedAt: nullableStr(row, 'started_at'),
    finishedAt: nullableStr(row, 'finished_at'),
    exitCode: nullableNum(row, 'exit_code'),
    stderrTail: nullableStr(row, 'stderr_tail'),
    error: nullableStr(row, 'error'),
  }
}

function toDraft(row: Row): ReviewDraft {
  return {
    id: str(row, 'id'),
    runId: str(row, 'run_id'),
    repo: str(row, 'repo'),
    number: num(row, 'number'),
    headSha: str(row, 'head_sha'),
    body: str(row, 'body'),
    status: str(row, 'status') as DraftStatus,
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

function toPosted(row: Row): PostedReview {
  return {
    id: str(row, 'id'),
    draftId: str(row, 'draft_id'),
    repo: str(row, 'repo'),
    number: num(row, 'number'),
    headSha: str(row, 'head_sha'),
    commentId: num(row, 'comment_id'),
    commentUrl: str(row, 'comment_url'),
    postedAt: str(row, 'posted_at'),
    postedAs: str(row, 'posted_as'),
  }
}

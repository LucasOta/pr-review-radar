import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostError, ReviewPoster } from '../../src/server/github/post.js'
import { DraftService } from '../../src/server/review/drafts.js'
import { openDatabase } from '../../src/server/store/db.js'
import { Repositories } from '../../src/server/store/repos.js'
import { MARKER_PREFIX } from '../../src/server/github/queries.js'
import { snapshot } from '../fixtures/github.js'
import type { ReviewDraft } from '../../src/shared/types.js'

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url))
const POSTER_FILE = path.join(SERVER_DIR, 'github', 'post.ts')

/** Calls that change something on GitHub. Reading is unrestricted; writing is not. */
const MUTATION_PATTERNS = [
  /\bissues\.create\w*\(/,
  /\bissues\.update\w*\(/,
  /\bissues\.add\w*\(/,
  /\bissues\.delete\w*\(/,
  /\bpulls\.create\w*\(/,
  /\bpulls\.update\w*\(/,
  /\bpulls\.merge\(/,
  /\bpulls\.requestReviewers\(/,
  /\brequest\(\s*['"`](POST|PATCH|PUT|DELETE)\s/,
]

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() && full.endsWith('.ts') ? [full] : []
  })
}

interface FakeState {
  comments: Array<{ owner: string; repo: string; issue_number: number; body: string }>
  pullState: 'open' | 'closed'
  headSha: string
}

function fakeRest(state: FakeState) {
  let nextId = 100
  return {
    pulls: {
      get: async ({ pull_number }: { owner: string; repo: string; pull_number: number }) => ({
        data: { state: state.pullState, head: { sha: state.headSha }, number: pull_number },
      }),
    },
    issues: {
      createComment: async (args: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => {
        state.comments.push(args)
        const id = nextId++
        return {
          data: {
            id,
            html_url: `https://github.com/${args.owner}/${args.repo}/pull/${args.issue_number}#issuecomment-${id}`,
          },
        }
      },
    },
  } as unknown as ConstructorParameters<typeof ReviewPoster>[0]
}

describe('write surface', () => {
  // Constitution III: exactly one module may write to GitHub.
  it('confines GitHub mutations to github/post.ts', () => {
    const offenders: string[] = []
    for (const file of walk(SERVER_DIR)) {
      if (file === POSTER_FILE) continue
      const source = fs.readFileSync(file, 'utf8')
      for (const pattern of MUTATION_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(SERVER_DIR, file)} matches ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('and the guard is not vacuous — post.ts really does write', () => {
    const source = fs.readFileSync(POSTER_FILE, 'utf8')
    expect(MUTATION_PATTERNS.some((pattern) => pattern.test(source))).toBe(true)
  })
})

describe('ReviewPoster', () => {
  let repos: Repositories
  let state: FakeState

  const draft = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({
    id: 'draft_1',
    runId: 'run_1',
    repo: 'acme/widgets',
    number: 1,
    headSha: 'aaa1111',
    body: 'Looks good.\n\nVerdict: ship it',
    status: 'ready',
    createdAt: '2026-09-02T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    ...over,
  })

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
    repos.upsertSnapshot(snapshot())
    repos.insertRun({
      id: 'run_1',
      repo: 'acme/widgets',
      number: 1,
      headSha: 'aaa1111',
      kind: 'review',
      status: 'succeeded',
      forced: false,
      createdAt: '2026-09-02T10:00:00Z',
      startedAt: '2026-09-02T10:00:00Z',
      finishedAt: '2026-09-02T10:01:00Z',
      exitCode: 0,
      stderrTail: null,
      error: null,
    })
    state = { comments: [], pullState: 'open', headSha: 'aaa1111' }
  })

  function poster(): ReviewPoster {
    return new ReviewPoster(fakeRest(state), repos, async () => ({ login: 'operator' }))
  }

  it('posts only when asked, under the operator identity, with a marker', async () => {
    repos.insertDraft(draft())
    expect(state.comments).toHaveLength(0) // nothing posted by merely having a draft

    const posted = await poster().post({ draftId: 'draft_1' })

    expect(state.comments).toHaveLength(1)
    expect(state.comments[0]?.body).toContain('Looks good.')
    expect(state.comments[0]?.body).toContain(MARKER_PREFIX)
    expect(posted.postedAs).toBe('operator')
    expect(repos.getDraft('draft_1')?.status).toBe('posted')
    expect(repos.listPostedFor('acme/widgets', 1)).toHaveLength(1)
  })

  it('refuses a second post and creates no second comment (FR-029)', async () => {
    repos.insertDraft(draft())
    const first = await poster().post({ draftId: 'draft_1' })

    const error = await poster()
      .post({ draftId: 'draft_1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(PostError)
    expect((error as PostError).code).toBe('already_posted')
    expect((error as PostError).detail.commentUrl).toBe(first.commentUrl)
    expect(state.comments).toHaveLength(1)
  })

  it('refuses a draft describing an older commit until acknowledged (FR-028)', async () => {
    repos.insertDraft(draft())
    state.headSha = 'bbb2222'

    const error = await poster()
      .post({ draftId: 'draft_1' })
      .catch((cause: unknown) => cause)

    expect((error as PostError).code).toBe('stale_head')
    expect((error as PostError).detail).toMatchObject({
      draftHeadSha: 'aaa1111',
      currentHeadSha: 'bbb2222',
    })
    expect(state.comments).toHaveLength(0)

    const posted = await poster().post({ draftId: 'draft_1', acknowledgeStaleHead: true })
    expect(posted.commentUrl).toContain('issuecomment')
    expect(state.comments).toHaveLength(1)
  })

  it('refuses to post to a closed pull request', async () => {
    repos.insertDraft(draft())
    state.pullState = 'closed'

    const error = await poster()
      .post({ draftId: 'draft_1' })
      .catch((cause: unknown) => cause)

    expect((error as PostError).code).toBe('pull_request_closed')
    expect(state.comments).toHaveLength(0)
  })

  it('refuses a discarded draft, and discarding posts nothing', async () => {
    repos.insertDraft(draft())
    const drafts = new DraftService(repos)

    drafts.discard('draft_1')
    expect(state.comments).toHaveLength(0)

    const error = await poster()
      .post({ draftId: 'draft_1' })
      .catch((cause: unknown) => cause)
    expect((error as PostError).code).toBe('draft_not_ready')
    expect(state.comments).toHaveLength(0)
  })

  it('refuses an unknown draft', async () => {
    const error = await poster()
      .post({ draftId: 'draft_nope' })
      .catch((cause: unknown) => cause)
    expect((error as PostError).code).toBe('unknown_draft')
  })
})

describe('DraftService', () => {
  let repos: Repositories

  beforeEach(() => {
    repos = new Repositories(openDatabase(':memory:'))
    repos.upsertSnapshot(snapshot({ headSha: 'bbb2222' }))
    repos.insertRun({
      id: 'run_1',
      repo: 'acme/widgets',
      number: 1,
      headSha: 'aaa1111',
      kind: 'review',
      status: 'succeeded',
      forced: false,
      createdAt: '2026-09-02T10:00:00Z',
      startedAt: null,
      finishedAt: null,
      exitCode: 0,
      stderrTail: null,
      error: null,
    })
    repos.insertDraft({
      id: 'draft_1',
      runId: 'run_1',
      repo: 'acme/widgets',
      number: 1,
      headSha: 'aaa1111',
      body: 'original',
      status: 'ready',
      createdAt: '2026-09-02T10:00:00Z',
      updatedAt: '2026-09-02T10:00:00Z',
    })
  })

  it('reports when the draft no longer describes the head', () => {
    const detail = new DraftService(repos).get('draft_1')
    expect(detail.headShaIsCurrent).toBe(false)
    expect(detail.currentHeadSha).toBe('bbb2222')
  })

  it('edits the body before posting (FR-025)', () => {
    const service = new DraftService(repos)
    const edited = service.edit('draft_1', 'edited by the operator')
    expect(edited.body).toBe('edited by the operator')
    expect(repos.getDraft('draft_1')?.body).toBe('edited by the operator')
  })

  it('refuses to edit a resolved draft', () => {
    const service = new DraftService(repos)
    service.discard('draft_1')
    expect(() => service.edit('draft_1', 'too late')).toThrow(/discarded/)
  })

  it('drops a discarded draft out of the pending list (FR-026)', () => {
    const service = new DraftService(repos)
    expect(service.listPending()).toHaveLength(1)
    service.discard('draft_1')
    expect(service.listPending()).toHaveLength(0)
  })
})

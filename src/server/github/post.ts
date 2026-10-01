import type { Octokit } from '@octokit/rest'
import type { PostedReview, ReviewDraft } from '../../shared/types.js'
import type { Repositories } from '../store/repos.js'
import { buildMarker } from './queries.js'
import { newId } from '../ids.js'

export type PostErrorCode =
  | 'unknown_draft'
  | 'draft_not_ready'
  | 'already_posted'
  | 'stale_head'
  | 'pull_request_closed'

export class PostError extends Error {
  constructor(
    readonly code: PostErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'PostError'
  }
}

export interface PostRequest {
  draftId: string
  acknowledgeStaleHead?: boolean
}

/**
 * THE ONLY MODULE IN THIS APPLICATION THAT WRITES TO GITHUB (Constitution III).
 *
 * Every guard here exists because the comment lands on a teammate's pull request under the
 * operator's own name: the draft must still be `ready` (FR-024), it must not already be posted
 * (FR-029), the pull request must still be open, and a draft describing an older commit needs an
 * explicit acknowledgement (FR-028).
 *
 * A test asserts no other server module imports a mutating Octokit method. If you need to write
 * to GitHub from somewhere else, add it here instead.
 */
export class ReviewPoster {
  constructor(
    private readonly rest: Pick<Octokit, 'pulls' | 'issues'>,
    private readonly repos: Repositories,
    private readonly identity: () => Promise<{ login: string }>,
  ) {}

  async post(request: PostRequest): Promise<PostedReview> {
    const draft = this.repos.getDraft(request.draftId)
    if (!draft) throw new PostError('unknown_draft', 'No such draft.')

    const existing = this.repos.getPostedByDraft(draft.id)
    if (existing) {
      throw new PostError('already_posted', 'This review was already posted.', {
        commentUrl: existing.commentUrl,
      })
    }
    if (draft.status !== 'ready') {
      throw new PostError('draft_not_ready', `This review is ${draft.status}, not ready to post.`)
    }

    const [owner, name] = draft.repo.split('/')
    if (!owner || !name) throw new Error(`Malformed repository "${draft.repo}"`)

    const { data: pull } = await this.rest.pulls.get({
      owner,
      repo: name,
      pull_number: draft.number,
    })

    if (pull.state !== 'open') {
      throw new PostError('pull_request_closed', 'This pull request is no longer open.', {
        state: pull.state,
      })
    }

    if (pull.head.sha !== draft.headSha && !request.acknowledgeStaleHead) {
      throw new PostError('stale_head', 'The pull request moved on since this review was written.', {
        draftHeadSha: draft.headSha,
        currentHeadSha: pull.head.sha,
      })
    }

    const operator = await this.identity()
    const body = `${draft.body.trim()}\n\n${buildMarker(draft.id, draft.headSha)}`

    const { data: comment } = await this.rest.issues.createComment({
      owner,
      repo: name,
      issue_number: draft.number,
      body,
    })

    const posted: PostedReview = {
      id: newId('post'),
      draftId: draft.id,
      repo: draft.repo,
      number: draft.number,
      headSha: draft.headSha,
      commentId: comment.id,
      commentUrl: comment.html_url,
      postedAt: new Date().toISOString(),
      postedAs: operator.login,
    }
    this.repos.insertPostedReview(posted)
    this.repos.updateDraft(draft.id, { status: 'posted', updatedAt: posted.postedAt })
    return posted
  }
}

/** Shared by the routes and the UI: is this draft still describing the pull request's head? */
export function draftCoversHead(draft: ReviewDraft, currentHeadSha: string | undefined): boolean {
  return currentHeadSha === undefined ? true : draft.headSha === currentHeadSha
}

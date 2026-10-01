import type { ReviewDraft } from '../../shared/types.js'
import type { Repositories } from '../store/repos.js'

export type DraftErrorCode = 'unknown_draft' | 'draft_not_ready'

export class DraftError extends Error {
  constructor(
    readonly code: DraftErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DraftError'
  }
}

export interface DraftWithContext extends ReviewDraft {
  /** False when the pull request moved on; posting then needs an acknowledgement (FR-028). */
  headShaIsCurrent: boolean
  currentHeadSha: string | null
  postedCommentUrl: string | null
}

/** Editing and discarding drafts. Deliberately has no access to a GitHub write client. */
export class DraftService {
  constructor(private readonly repos: Repositories) {}

  get(id: string): DraftWithContext {
    const draft = this.repos.getDraft(id)
    if (!draft) throw new DraftError('unknown_draft', 'No such draft.')
    return this.decorate(draft)
  }

  edit(id: string, body: string): DraftWithContext {
    const draft = this.repos.getDraft(id)
    if (!draft) throw new DraftError('unknown_draft', 'No such draft.')
    if (draft.status !== 'ready') {
      throw new DraftError('draft_not_ready', `This review is ${draft.status} and can no longer be edited.`)
    }
    this.repos.updateDraft(id, { body, updatedAt: new Date().toISOString() })
    return this.get(id)
  }

  discard(id: string): DraftWithContext {
    const draft = this.repos.getDraft(id)
    if (!draft) throw new DraftError('unknown_draft', 'No such draft.')
    if (draft.status === 'ready') {
      this.repos.updateDraft(id, { status: 'discarded', updatedAt: new Date().toISOString() })
    }
    return this.get(id)
  }

  listPending(): DraftWithContext[] {
    return this.repos.listPendingDrafts().map((draft) => this.decorate(draft))
  }

  private decorate(draft: ReviewDraft): DraftWithContext {
    const snapshot = this.repos.getSnapshot(draft.repo, draft.number)
    const posted = this.repos.getPostedByDraft(draft.id)
    return {
      ...draft,
      currentHeadSha: snapshot?.headSha ?? null,
      headShaIsCurrent: snapshot ? snapshot.headSha === draft.headSha : true,
      postedCommentUrl: posted?.commentUrl ?? null,
    }
  }
}

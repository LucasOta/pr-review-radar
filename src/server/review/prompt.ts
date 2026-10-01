import fs from 'node:fs'
import path from 'node:path'
import type { ReviewKind } from '../../shared/types.js'
import { ROOT_DIR } from '../paths.js'
import type { PullRequestSnapshot } from '../store/repos.js'
import { latestChangesRequested } from '../domain/staleness.js'

export interface PromptParts {
  /** Passed to `claude -p`. */
  instruction: string
  /** Piped to the process on stdin. */
  context: string
}

export interface PromptInputs {
  kind: ReviewKind
  snapshot: PullRequestSnapshot
  diff: string
  reviewPromptPath: string
  rereviewPromptPath: string
}

export function buildPrompt(inputs: PromptInputs): PromptParts {
  const { kind, snapshot, diff } = inputs
  const file = kind === 'rereview' ? inputs.rereviewPromptPath : inputs.reviewPromptPath
  const instruction = readPrompt(file)

  const lines = [
    `Repository: ${snapshot.repo}`,
    `Pull request: #${snapshot.number} — ${snapshot.title}`,
    `Author: ${snapshot.author}`,
    `Base: ${snapshot.baseRef}`,
    `Head commit: ${snapshot.headSha}`,
    `URL: ${snapshot.url}`,
  ]

  if (kind === 'rereview') {
    const requested = latestChangesRequested(snapshot.reviews)
    if (requested) {
      const since = snapshot.commits.filter((commit) => commit.committedAt > requested.submittedAt)
      lines.push(
        `Changes were requested by ${requested.author} at ${requested.submittedAt}.`,
        `${since.length} commit(s) have landed since: ${since.map((c) => c.sha.slice(0, 7)).join(', ') || 'none recorded'}.`,
      )
    }
  }

  const context = [...lines, '', '--- unified diff ---', diff].join('\n')
  return { instruction, context }
}

function readPrompt(relative: string): string {
  const resolved = path.isAbsolute(relative) ? relative : path.join(ROOT_DIR, relative)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Review prompt not found at ${resolved}. Check reviewPromptPath in your config.`)
  }
  return fs.readFileSync(resolved, 'utf8').trim()
}

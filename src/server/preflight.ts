import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class PreflightError extends Error {
  constructor(
    readonly tool: string,
    message: string,
    readonly fix: string,
  ) {
    super(message)
    this.name = 'PreflightError'
  }
}

export interface PreflightResult {
  /** Held in memory only. Never logged, never persisted, never sent to the browser. */
  token: string
  nodeVersion: string
  ghVersion: string
  claudeVersion: string
}

const MIN_NODE_MAJOR = 24

export async function preflight(env: NodeJS.ProcessEnv = process.env): Promise<PreflightResult> {
  const nodeVersion = process.versions.node
  const major = Number(nodeVersion.split('.')[0])
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw new PreflightError(
      'node',
      `Node ${MIN_NODE_MAJOR} or newer is required (found ${nodeVersion}). The app uses the built-in node:sqlite module.`,
      'Install Node 24+: https://nodejs.org or `nvm install 24 && nvm use 24`',
    )
  }

  const claudeVersion = await version('claude', ['--version'], {
    tool: 'claude',
    message: 'The Claude Code CLI was not found on PATH. Reviews run through it locally.',
    fix: 'Install it: https://claude.com/claude-code',
  })

  const ghVersion = await version('gh', ['--version'], {
    tool: 'gh',
    message: 'The GitHub CLI was not found on PATH. It supplies the GitHub token.',
    fix: 'Install it: https://cli.github.com',
  })

  const token = await resolveToken(env)

  return { token, nodeVersion, ghVersion: ghVersion.split('\n')[0] ?? ghVersion, claudeVersion }
}

/**
 * Credentials come from the operator's own environment (Constitution I). GITHUB_TOKEN wins so a
 * teammate can scope a different token without touching their gh login.
 */
export async function resolveToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const fromEnv = env.GITHUB_TOKEN?.trim()
  if (fromEnv) return fromEnv

  try {
    const { stdout } = await run('gh', ['auth', 'token'], { encoding: 'utf8' })
    const token = stdout.trim()
    if (!token) throw new Error('empty token')
    return token
  } catch {
    throw new PreflightError(
      'gh auth',
      'Could not read a GitHub token. `gh auth token` returned nothing and GITHUB_TOKEN is unset.',
      'Run `gh auth login`, or export GITHUB_TOKEN with a token that can read your team\'s repos.',
    )
  }
}

async function version(
  cmd: string,
  args: string[],
  onMissing: { tool: string; message: string; fix: string },
): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { encoding: 'utf8' })
    return stdout.trim()
  } catch {
    throw new PreflightError(onMissing.tool, onMissing.message, onMissing.fix)
  }
}

export function formatPreflightError(error: PreflightError): string {
  return [
    '',
    `  Cannot start: ${error.tool} check failed.`,
    '',
    `  ${error.message}`,
    `  Fix: ${error.fix}`,
    '',
  ].join('\n')
}

import { spawn } from 'node:child_process'
import type { PromptParts } from './prompt.js'

export interface RunnerResult {
  body: string
  exitCode: number
}

export class RunnerError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
    readonly kind: 'failed' | 'timeout' | 'cancelled' = 'failed',
  ) {
    super(message)
    this.name = 'RunnerError'
  }
}

export interface RunnerOptions {
  timeoutMs: number
  signal?: AbortSignal
  /** Injected in tests. */
  command?: string
  args?: (prompt: string) => string[]
}

const STDERR_TAIL_BYTES = 4000

/**
 * Runs one review through the operator's own Claude Code CLI (Constitution I). The prompt goes in
 * as an argument and the pull request context on stdin, which is the documented headless shape.
 */
export async function runReview(parts: PromptParts, options: RunnerOptions): Promise<RunnerResult> {
  const command = options.command ?? 'claude'
  const args = (options.args ?? defaultArgs)(parts.instruction)

  return new Promise<RunnerResult>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // A CLI that ignores SIGTERM still has to go.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, options.timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGTERM')
      finish(() =>
        reject(new RunnerError('Run cancelled', null, tail(stderr), 'cancelled')),
      )
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error: Error) => {
      finish(() =>
        reject(
          new RunnerError(
            `Could not start ${command}: ${error.message}`,
            null,
            tail(stderr),
          ),
        ),
      )
    })

    child.on('close', (code: number | null) => {
      if (timedOut) {
        finish(() =>
          reject(
            new RunnerError(
              `Review timed out after ${Math.round(options.timeoutMs / 1000)}s`,
              code,
              tail(stderr),
              'timeout',
            ),
          ),
        )
        return
      }
      if (code !== 0) {
        finish(() =>
          reject(new RunnerError(`${command} exited ${code ?? 'with no code'}`, code, tail(stderr))),
        )
        return
      }

      const body = extractBody(stdout)
      if (body.trim() === '') {
        finish(() => reject(new RunnerError(`${command} produced no review text`, code, tail(stderr))))
        return
      }
      finish(() => resolve({ body, exitCode: code ?? 0 }))
    })

    child.stdin.on('error', () => {
      // The child may exit before stdin drains; the close handler reports the real failure.
    })
    child.stdin.end(parts.context)
  })
}

function defaultArgs(prompt: string): string[] {
  return ['-p', prompt, '--output-format', 'json']
}

/** `--output-format json` wraps the answer; fall back to raw stdout when it is plain text. */
export function extractBody(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const record = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed
    if (record && typeof record === 'object') {
      const candidate = record as Record<string, unknown>
      for (const key of ['result', 'text', 'content', 'message']) {
        const value = candidate[key]
        if (typeof value === 'string' && value.trim() !== '') return value.trim()
      }
    }
    return trimmed
  } catch {
    return trimmed
  }
}

function tail(value: string): string {
  return value.length > STDERR_TAIL_BYTES ? value.slice(-STDERR_TAIL_BYTES) : value
}

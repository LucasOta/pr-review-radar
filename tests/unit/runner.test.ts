import { describe, expect, it } from 'vitest'
import { RunnerError, extractBody, runReview } from '../../src/server/review/runner.js'

const parts = { instruction: 'review this', context: 'metadata\n--- unified diff ---\ndiff' }

/** A stand-in for the claude CLI: a real subprocess, no Claude Code installation required. */
function fakeCli(script: string) {
  return { command: process.execPath, args: () => ['-e', script] }
}

describe('extractBody', () => {
  it('unwraps the --output-format json envelope', () => {
    expect(extractBody('{"result":"Looks good.\\n\\nVerdict: ship it"}')).toBe(
      'Looks good.\n\nVerdict: ship it',
    )
  })

  it('takes the last record of a streamed array', () => {
    expect(extractBody('[{"result":"first"},{"result":"second"}]')).toBe('second')
  })

  it('passes plain text through', () => {
    expect(extractBody('  Looks good.  ')).toBe('Looks good.')
  })

  it('falls back to raw output when the JSON has no known field', () => {
    expect(extractBody('{"unexpected":1}')).toBe('{"unexpected":1}')
  })

  it('falls back to raw output on malformed JSON', () => {
    expect(extractBody('{not json')).toBe('{not json')
  })
})

describe('runReview', () => {
  it('returns the review body and reads the context from stdin', async () => {
    const script = `
      let input = ''
      process.stdin.on('data', (c) => { input += c })
      process.stdin.on('end', () => {
        if (!input.includes('unified diff')) { process.stderr.write('no diff on stdin'); process.exit(3) }
        process.stdout.write(JSON.stringify({ result: 'Looks good.' }))
      })
    `
    const result = await runReview(parts, { timeoutMs: 10_000, ...fakeCli(script) })
    expect(result.body).toBe('Looks good.')
    expect(result.exitCode).toBe(0)
  })

  it('fails with the captured stderr when the CLI exits non-zero', async () => {
    const script = `process.stdin.resume(); process.stderr.write('boom: model unavailable'); process.exit(2)`
    await expect(runReview(parts, { timeoutMs: 10_000, ...fakeCli(script) })).rejects.toMatchObject({
      name: 'RunnerError',
      exitCode: 2,
      stderrTail: expect.stringContaining('model unavailable'),
    })
  })

  it('fails when the CLI succeeds but produces nothing', async () => {
    const script = `process.stdin.resume(); process.stdout.write('   '); process.exit(0)`
    await expect(runReview(parts, { timeoutMs: 10_000, ...fakeCli(script) })).rejects.toThrow(
      /produced no review text/,
    )
  })

  it('times out a CLI that hangs', async () => {
    const script = `process.stdin.resume(); setInterval(() => {}, 1000)`
    const error = await runReview(parts, { timeoutMs: 300, ...fakeCli(script) }).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(RunnerError)
    expect((error as RunnerError).kind).toBe('timeout')
    expect((error as RunnerError).message).toMatch(/timed out/)
  })

  it('cancels on abort', async () => {
    const script = `process.stdin.resume(); setInterval(() => {}, 1000)`
    const controller = new AbortController()
    const promise = runReview(parts, {
      timeoutMs: 10_000,
      signal: controller.signal,
      ...fakeCli(script),
    })
    setTimeout(() => controller.abort(), 100)
    const error = await promise.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(RunnerError)
    expect((error as RunnerError).kind).toBe('cancelled')
  })

  it('reports a missing CLI as a failure, not a crash', async () => {
    await expect(
      runReview(parts, { timeoutMs: 1000, command: 'definitely-not-a-real-binary-xyz', args: () => [] }),
    ).rejects.toThrow(/Could not start/)
  })
})

import { describe, expect, it } from 'vitest'
import { PreflightError, formatPreflightError, resolveToken } from '../../src/server/preflight.js'

describe('preflight failures', () => {
  // FR-044: a teammate missing a tool must be told which one and how to install it.
  it('names the tool and the fix', () => {
    const error = new PreflightError(
      'claude',
      'The Claude Code CLI was not found on PATH.',
      'Install it: https://claude.com/claude-code',
    )
    const message = formatPreflightError(error)

    expect(message).toContain('claude check failed')
    expect(message).toContain('not found on PATH')
    expect(message).toContain('Fix: Install it: https://claude.com/claude-code')
    expect(message).not.toMatch(/at .*\.ts:\d+/) // no stack trace
  })

  it('prefers GITHUB_TOKEN over the gh login', async () => {
    await expect(resolveToken({ GITHUB_TOKEN: '  token-from-env  ' })).resolves.toBe(
      'token-from-env',
    )
  })

  it('falls through to gh when GITHUB_TOKEN is empty', async () => {
    // gh is authenticated in this environment, so this resolves to a real token; assert only
    // that something non-empty came back and that it is not the env value.
    const token = await resolveToken({ GITHUB_TOKEN: '   ' })
    expect(token.length).toBeGreaterThan(0)
    expect(token).not.toBe('   ')
  })
})

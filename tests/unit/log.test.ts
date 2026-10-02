import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets, redactValue } from '../../src/server/log.js'

// Built by concatenation so this file never contains a credential-shaped literal.
const fake = (prefix: string): string => [prefix, 'abcdefghijklmnopqrstuvwxyz012345'].join('_')

describe('redaction', () => {
  it('scrubs every GitHub credential shape from a message', () => {
    for (const prefix of ['ghp', 'gho', 'ghs', 'ghu']) {
      const token = fake(prefix)
      expect(redactSecrets(`auth failed for ${token}`)).toBe(`auth failed for ${REDACTED}`)
    }
    const pat = ['github', 'pat', 'abcdefghijklmnopqrstuvwxyz012345'].join('_')
    expect(redactSecrets(`using ${pat}`)).toContain(REDACTED)
  })

  it('scrubs authorization header values', () => {
    expect(redactSecrets('Bearer abcdefghijklmnopqrstuvwxyz')).toBe(REDACTED)
    expect(redactSecrets('token abcdefghijklmnopqrstuvwxyz')).toBe(REDACTED)
  })

  it('scrubs the live token even when it looks like nothing in particular', () => {
    const live = 'an-opaque-value-from-gh-cli'
    expect(redactSecrets(`request failed with ${live}`, live)).toBe(`request failed with ${REDACTED}`)
  })

  it('leaves ordinary messages alone', () => {
    const message = 'refresh completed, 3 pull requests changed'
    expect(redactSecrets(message)).toBe(message)
    expect(redactSecrets('run_abc123 succeeded for acme/widgets#7')).toBe(
      'run_abc123 succeeded for acme/widgets#7',
    )
  })

  it('redacts by key anywhere in an object graph', () => {
    const redacted = redactValue({
      runId: 'run_1',
      request: { headers: { authorization: 'Bearer something-secret-here' } },
      nested: [{ token: fake('ghp') }, { apiSecret: 'hunter2' }],
    })

    expect(redacted.runId).toBe('run_1')
    expect(redacted.request.headers.authorization).toBe(REDACTED)
    expect(redacted.nested[0]?.token).toBe(REDACTED)
    expect(redacted.nested[1]?.apiSecret).toBe(REDACTED)
  })

  it('redacts credential-shaped strings held under innocent keys', () => {
    const redacted = redactValue({ message: `failed with ${fake('ghp')}` })
    expect(redacted.message).toBe(`failed with ${REDACTED}`)
  })

  it('survives cycles-free deep structures without throwing', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'leaf' } } } } } } }
    expect(() => redactValue(deep)).not.toThrow()
  })
})

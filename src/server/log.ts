/**
 * Logging that cannot leak the operator's token (Constitution I). The token is held in memory and
 * passed to Octokit; anything that might carry it into a log line goes through here first.
 */

/** Credential shapes, plus whatever the live token is, replaced wherever they appear. */
const TOKEN_PATTERNS = [
  /\bghp_[A-Za-z0-9]{16,}/g,
  /\bgho_[A-Za-z0-9]{16,}/g,
  /\bghs_[A-Za-z0-9]{16,}/g,
  /\bghu_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
  /\btoken\s+[A-Za-z0-9._-]{16,}/gi,
]

export const REDACTED = '[redacted]'

/** Keys whose values are never safe to print, whatever they contain. */
export const REDACT_PATHS = [
  'token',
  '*.token',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',
  'err.request.headers.authorization',
  'config.headers.authorization',
]

export function redactSecrets(value: string, liveToken?: string): string {
  let out = value
  if (liveToken && liveToken.length >= 8) {
    out = out.split(liveToken).join(REDACTED)
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/** Deep-redacts an arbitrary value before it reaches a log line. */
export function redactValue<T>(value: T, liveToken?: string, depth = 0): T {
  if (depth > 6) return value
  if (typeof value === 'string') return redactSecrets(value, liveToken) as unknown as T
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, liveToken, depth + 1)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|authorization|secret/i.test(key)
        ? REDACTED
        : redactValue(item, liveToken, depth + 1)
    }
    return out as unknown as T
  }
  return value
}

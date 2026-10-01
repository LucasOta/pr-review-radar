import type { Octokit } from '@octokit/rest'

export class DiffTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`Diff is ${bytes} bytes, above the configured limit of ${limit}. Review this one by hand, or raise maxDiffBytes.`)
    this.name = 'DiffTooLargeError'
  }
}

interface CacheEntry {
  etag: string
  diff: string
}

/**
 * Fetches the unified diff for a pull request. Conditional requests mean an unchanged pull
 * request costs a 304 rather than a full download (FR-034); a 304 does not count against the
 * REST rate limit at all.
 */
export class DiffFetcher {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly rest: Pick<Octokit, 'request'>,
    private readonly maxBytes: () => number,
  ) {}

  async fetch(repo: string, number: number): Promise<string> {
    const [owner, name] = repo.split('/')
    if (!owner || !name) throw new Error(`Malformed repository "${repo}"`)

    const key = `${repo}#${number}`
    const cached = this.cache.get(key)

    try {
      const response = await this.rest.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo: name,
        pull_number: number,
        headers: {
          accept: 'application/vnd.github.v3.diff',
          ...(cached ? { 'if-none-match': cached.etag } : {}),
        },
      })

      const diff = typeof response.data === 'string' ? response.data : String(response.data ?? '')
      const etag = (response.headers as Record<string, string | undefined>).etag
      if (etag) this.cache.set(key, { etag, diff })
      return this.checked(diff)
    } catch (error) {
      // Octokit raises "not modified" as an error; for us it is the happy path.
      if (cached && isNotModified(error)) return this.checked(cached.diff)
      throw error
    }
  }

  private checked(diff: string): string {
    const bytes = Buffer.byteLength(diff, 'utf8')
    const limit = this.maxBytes()
    if (bytes > limit) throw new DiffTooLargeError(bytes, limit)
    return diff
  }

  /** Drops a cached diff, e.g. when a pull request's head moves. */
  invalidate(repo: string, number: number): void {
    this.cache.delete(`${repo}#${number}`)
  }
}

function isNotModified(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { status?: number }).status === 304
}

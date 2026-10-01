import type { BoardResponse, OperatorConfig } from '@shared/types.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new ApiError(
      body.message ?? body.error ?? `${response.status} ${response.statusText}`,
      response.status,
      body,
    )
  }
  return (await response.json()) as T
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
  }
}

export const api = {
  /** The query travels with the request: the browser owns it, the server just adopts it. */
  board: (query: string | null) =>
    request<BoardResponse>(query === null ? '/api/board' : `/api/board?q=${encodeURIComponent(query)}`),
  config: () => request<OperatorConfig>('/api/config'),
  updateConfig: (patch: Partial<OperatorConfig>) =>
    request<OperatorConfig>('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),
  refresh: (query: string | null) =>
    request<{ accepted: boolean }>('/api/refresh', {
      method: 'POST',
      body: JSON.stringify(query === null ? {} : { query }),
    }),
}

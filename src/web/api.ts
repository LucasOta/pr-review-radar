import type {
  BoardResponse,
  DraftDetail,
  OperatorConfig,
  PostedResult,
  ReviewKind,
  RunDetail,
} from '@shared/types.js'

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

  requestReview: (repo: string, number: number, kind: ReviewKind, force = false) =>
    request<{ runId: string; status: string }>(`/api/pulls/${repo}/${number}/review`, {
      method: 'POST',
      body: JSON.stringify({ kind, force }),
    }),
  cancelRun: (runId: string) =>
    request<{ status: string }>(`/api/runs/${runId}/cancel`, { method: 'POST' }),
  run: (runId: string) => request<RunDetail>(`/api/runs/${runId}`),

  drafts: () => request<DraftDetail[]>('/api/drafts'),
  draft: (id: string) => request<DraftDetail>(`/api/drafts/${id}`),
  editDraft: (id: string, body: string) =>
    request<DraftDetail>(`/api/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  discardDraft: (id: string) =>
    request<{ status: string }>(`/api/drafts/${id}/discard`, { method: 'POST' }),
  /** The only call in the UI that causes a write to GitHub. */
  postDraft: (id: string, acknowledgeStaleHead = false) =>
    request<PostedResult>(`/api/drafts/${id}/post`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgeStaleHead }),
    }),
}

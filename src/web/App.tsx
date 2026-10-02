import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardResponse } from '@shared/types.js'
import { STATUS_ORDER, isUsableQuery } from '@shared/types.js'
import { api } from './api.js'
import { applyPullRequest, countRows, removePullRequest } from './board.js'
import { useEventStream } from './useEventStream.js'
import { createQueryStore } from './queryStorage.js'
import { StatusBar } from './components/StatusBar.js'
import { StatusGroup } from './components/StatusGroup.js'
import { QueryEditor } from './components/QueryEditor.js'
import { ReviewPreview } from './components/ReviewPreview.js'
import { DraftTray } from './components/DraftTray.js'

export function App(): JSX.Element {
  const store = useMemo(() => createQueryStore(), [])
  const [query, setQuery] = useState<string | null>(() => store.read())
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingQuery, setEditingQuery] = useState(() => !isUsableQuery(store.read()))
  const [previewDraftId, setPreviewDraftId] = useState<string | null>(null)
  const [streamLive, setStreamLive] = useState(false)
  const [draftRevision, setDraftRevision] = useState(0)
  const queryRef = useRef(query)
  queryRef.current = query

  const load = useCallback(async () => {
    try {
      const next = await api.board(queryRef.current)
      setBoard(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Safety net only: the stream drives updates, this catches a stream that died quietly.
    const timer = setInterval(() => void load(), 120_000)
    return () => clearInterval(timer)
  }, [load])

  useEventStream({
    // Every (re)connect resynchronizes, so a gap in the stream cannot leave stale rows.
    onConnect: () => {
      setStreamLive(true)
      void load()
    },
    onDisconnect: () => setStreamLive(false),
    'pr.updated': ({ pullRequest }) =>
      setBoard((current) => (current ? applyPullRequest(current, pullRequest) : current)),
    'pr.removed': ({ repo, number }) =>
      setBoard((current) => (current ? removePullRequest(current, repo, number) : current)),
    'refresh.completed': ({ at, rateLimit }) =>
      setBoard((current) =>
        current ? { ...current, lastRefreshAt: at, stale: false, rateLimit } : current,
      ),
    'draft.ready': () => setDraftRevision((value) => value + 1),
    'draft.resolved': () => {
      setDraftRevision((value) => value + 1)
      void load()
    },
  })

  // Another tab changed the query: adopt it rather than fighting over the board.
  useEffect(() => {
    const onStorage = (): void => {
      const stored = store.read()
      setQuery(stored)
      queryRef.current = stored
      void load()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [store, load])

  const refresh = useCallback(async () => {
    if (!isUsableQuery(queryRef.current)) {
      setEditingQuery(true)
      return
    }
    await api.refresh(queryRef.current)
    setTimeout(() => void load(), 1500)
  }, [load])

  const saveQuery = useCallback(
    async (next: string) => {
      store.write(next)
      setQuery(next)
      queryRef.current = next
      setEditingQuery(false)
      setBoard(null)
      setLoading(true)
      await load()
      setTimeout(() => void load(), 2500)
    },
    [store, load],
  )

  if (loading && !board) {
    return (
      <main className="shell">
        <p className="muted">Loading board…</p>
      </main>
    )
  }

  if (error && !board) {
    return (
      <main className="shell">
        <h1>PR Review Radar</h1>
        <p className="error">Could not reach the local server: {error}</p>
      </main>
    )
  }

  if (!board) return <main className="shell" />

  const total = countRows(board)
  const hasQuery = isUsableQuery(query)

  return (
    <main className="shell">
      <header className="header">
        <h1>PR Review Radar</h1>
        <StatusBar
          board={board}
          query={query}
          live={streamLive}
          onRefresh={refresh}
          onEditQuery={() => setEditingQuery(true)}
        />
      </header>

      {editingQuery && (
        <QueryEditor
          initial={query ?? ''}
          onSave={saveQuery}
          onClear={
            hasQuery
              ? () => {
                  store.clear()
                  setQuery(null)
                  queryRef.current = null
                  void load()
                }
              : undefined
          }
          onCancel={hasQuery ? () => setEditingQuery(false) : undefined}
        />
      )}

      <DraftTray revision={draftRevision} onPreview={setPreviewDraftId} />

      {board.repoErrors.length > 0 && (
        <section className="banner banner-warn">
          <strong>Some repositories could not be read.</strong>
          <ul>
            {board.repoErrors.map((repoError) => (
              <li key={`${repoError.repo}:${repoError.message}`}>
                {repoError.repo}: {repoError.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasQuery && !editingQuery && (
        <section className="empty">
          <p>No search query set yet.</p>
          <button type="button" onClick={() => setEditingQuery(true)}>
            Set query
          </button>
        </section>
      )}

      {hasQuery && total === 0 && (
        <section className="empty">
          <p>
            No open pull requests match <code>{query}</code>.
          </p>
          <button type="button" onClick={() => setEditingQuery(true)}>
            Edit query
          </button>
        </section>
      )}

      {STATUS_ORDER.map((status) => (
        <StatusGroup
          key={status}
          status={status}
          pullRequests={board.groups[status]}
          onChanged={() => void load()}
          onPreview={setPreviewDraftId}
        />
      ))}

      {previewDraftId && (
        <ReviewPreview
          draftId={previewDraftId}
          onClose={() => setPreviewDraftId(null)}
          onResolved={() => {
            setDraftRevision((value) => value + 1)
            void load()
          }}
        />
      )}
    </main>
  )
}

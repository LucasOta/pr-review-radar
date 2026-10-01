import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { BoardResponse } from '@shared/types.js'
import { STATUS_ORDER, isPlaceholderQuery } from '@shared/types.js'
import { api } from './api.js'
import { StatusBar } from './components/StatusBar.js'
import { StatusGroup } from './components/StatusGroup.js'
import { QueryEditor } from './components/QueryEditor.js'

export function App(): JSX.Element {
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingQuery, setEditingQuery] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await api.board()
      setBoard(next)
      setError(null)
      if (isPlaceholderQuery(next.query)) setEditingQuery(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // US3 replaces this interval with the SSE stream.
    const timer = setInterval(() => void load(), 15_000)
    return () => clearInterval(timer)
  }, [load])

  const refresh = useCallback(async () => {
    await api.refresh()
    setTimeout(() => void load(), 1500)
  }, [load])

  const saveQuery = useCallback(
    async (searchQuery: string) => {
      await api.updateConfig({ searchQuery })
      setEditingQuery(false)
      setTimeout(() => void load(), 1500)
    },
    [load],
  )

  if (loading) {
    return <main className="shell">
      <p className="muted">Loading board…</p>
    </main>
  }

  if (error && !board) {
    return <main className="shell">
      <h1>PR Review Radar</h1>
      <p className="error">Could not reach the local server: {error}</p>
    </main>
  }

  if (!board) return <main className="shell" />

  const total = STATUS_ORDER.reduce((sum, status) => sum + board.groups[status].length, 0)
  const placeholder = isPlaceholderQuery(board.query)

  return (
    <main className="shell">
      <header className="header">
        <h1>PR Review Radar</h1>
        <StatusBar board={board} onRefresh={refresh} onEditQuery={() => setEditingQuery(true)} />
      </header>

      {editingQuery && (
        <QueryEditor
          initial={placeholder ? '' : board.query}
          onSave={saveQuery}
          onCancel={placeholder ? undefined : () => setEditingQuery(false)}
        />
      )}

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

      {total === 0 && !placeholder && (
        <section className="empty">
          <p>
            No open pull requests match <code>{board.query}</code>.
          </p>
          <button type="button" onClick={() => setEditingQuery(true)}>
            Edit query
          </button>
        </section>
      )}

      {STATUS_ORDER.map((status) => (
        <StatusGroup key={status} status={status} pullRequests={board.groups[status]} />
      ))}
    </main>
  )
}

import type { JSX } from 'react'
import { useState } from 'react'
import { QUERY_EXAMPLE, isUsableQuery } from '@shared/types.js'

interface Props {
  initial: string
  onSave: (query: string) => Promise<void>
  onCancel?: () => void
  onClear?: () => void
}

export function QueryEditor({ initial, onSave, onCancel, onClear }: Props): JSX.Element {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (!isUsableQuery(value)) {
      setError('Replace the YOUR_ORG / YOUR_LABEL placeholders with your own values.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(value.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="banner">
      <label htmlFor="query">GitHub search query</label>
      <input
        id="query"
        value={value}
        placeholder={QUERY_EXAMPLE}
        spellCheck={false}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }}
      />
      <p className="muted">
        Same syntax as GitHub search. Example: <code>{QUERY_EXAMPLE}</code>. Saved in this browser
        only — it never reaches disk or the repository.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={saving || value.trim() === ''}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onClear && (
          <button type="button" className="secondary" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </section>
  )
}

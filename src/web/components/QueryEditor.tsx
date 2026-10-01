import type { JSX } from 'react'
import { useState } from 'react'

interface Props {
  initial: string
  onSave: (query: string) => Promise<void>
  onCancel?: () => void
}

const EXAMPLE = 'org:YOUR_ORG is:pr is:open label:YOUR_LABEL'

export function QueryEditor({ initial, onSave, onCancel }: Props): JSX.Element {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
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
        placeholder={EXAMPLE}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }}
      />
      <p className="muted">
        Same syntax as GitHub search. Example: <code>{EXAMPLE}</code>
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
      </div>
    </section>
  )
}

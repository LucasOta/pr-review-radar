import fs from 'node:fs'
import path from 'node:path'
import type { OperatorConfig } from '../../shared/types.js'
import { CONFIG_DIR, CONFIG_FILE } from '../paths.js'
import { DEFAULT_CONFIG, operatorConfigSchema, partialOperatorConfigSchema } from './schema.js'

/**
 * Keys that must never be written to disk, even if a client sends them: credentials, and the
 * search query — which belongs to the operator's browser (FR-002). Zod would strip unknown keys
 * anyway; naming them here makes the intent explicit and survives a schema change.
 */
const FORBIDDEN_KEYS = new Set(['token', 'githubToken', 'GITHUB_TOKEN', 'searchQuery', 'query'])

export class ConfigStore {
  private current: OperatorConfig
  private readonly file: string

  constructor(file: string = CONFIG_FILE) {
    this.file = file
    this.current = this.load()
  }

  get(): OperatorConfig {
    return { ...this.current }
  }

  /** Merge a partial update, validate the result, persist it. Throws ZodError on invalid input. */
  update(patch: unknown): OperatorConfig {
    const stripped = stripForbidden(patch)
    const parsedPatch = partialOperatorConfigSchema.parse(stripped)
    const merged = operatorConfigSchema.parse({ ...this.current, ...parsedPatch })
    this.current = merged
    this.persist()
    return this.get()
  }

  private load(): OperatorConfig {
    if (!fs.existsSync(this.file)) {
      return { ...DEFAULT_CONFIG }
    }
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
    // A config file written by an older version may miss keys; defaults fill the gaps.
    return operatorConfigSchema.parse(stripForbidden(raw))
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.current, null, 2) + '\n', 'utf8')
  }

  get configPath(): string {
    return this.file
  }

  get configDir(): string {
    return path.dirname(this.file) || CONFIG_DIR
  }
}

function stripForbidden(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!FORBIDDEN_KEYS.has(key)) out[key] = val
  }
  return out
}

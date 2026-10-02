import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from '../../src/server/config/store.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function trackedFiles(): string[] {
  return git('ls-files').split('\n').filter(Boolean)
}

function isIgnored(relative: string): boolean {
  try {
    git('check-ignore', '-q', relative)
    return true
  } catch {
    return false
  }
}

/** Shapes of GitHub credentials. A match in a tracked file is a leak, not a style issue. */
const TOKEN_PATTERNS = [/\bghp_[A-Za-z0-9]{20,}/, /\bgho_[A-Za-z0-9]{20,}/, /\bghs_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/]

describe('nothing personal is committable', () => {
  it('ignores the operator config and the local cache', () => {
    expect(isIgnored('config/config.json')).toBe(true)
    expect(isIgnored('data/radar.sqlite')).toBe(true)
    expect(isIgnored('data')).toBe(true)
  })

  it('still commits the config example so a teammate can see the knobs', () => {
    expect(isIgnored('config/config.example.json')).toBe(false)
    expect(trackedFiles()).toContain('config/config.example.json')
  })

  it('tracks no config file, database, or env file', () => {
    const offenders = trackedFiles().filter(
      (file) =>
        file === 'config/config.json' ||
        file.startsWith('data/') ||
        file.endsWith('.sqlite') ||
        file === '.env',
    )
    expect(offenders).toEqual([])
  })

  it('has no credential-shaped string in any tracked file', () => {
    const offenders: string[] = []
    for (const file of trackedFiles()) {
      const full = path.join(ROOT, file)
      if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) continue
      const content = fs.readFileSync(full, 'utf8')
      for (const pattern of TOKEN_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${file} matches ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // Shipped code, config, and docs must not name anyone's org. Test fixtures use org:acme.
  it('ships no real search query — only the placeholder example', () => {
    const offenders = trackedFiles()
      .filter((file) => file.startsWith('src/') || file.startsWith('config/') || file.startsWith('prompts/') || file.endsWith('.md'))
      .filter((file) => !file.startsWith('tests/'))
      .filter((file) => {
        const full = path.join(ROOT, file)
        if (!fs.existsSync(full)) return false
        const content = fs.readFileSync(full, 'utf8')
        // A committed query naming a real org would make this one person's tool.
        // YOUR_ORG is the placeholder; acme is the documented fictional example.
        const matches = content.match(/\borg:[A-Za-z0-9_-]+/g) ?? []
        return matches.some((match) => !['org:YOUR_ORG', 'org:acme'].includes(match))
      })
    expect(offenders).toEqual([])
  })

  it('writes the config outside anything git tracks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-secrets-'))
    const file = path.join(dir, 'config.json')
    const store = new ConfigStore(file)
    store.update({ maxConcurrentRuns: 2 })

    expect(fs.existsSync(file)).toBe(true)
    expect(store.configPath).toBe(file)
    // The real location is ignored by git, so the same write in-tree stays uncommittable.
    expect(isIgnored('config/config.json')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('never persists a token or a query, whatever a client sends', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-secrets-'))
    const file = path.join(dir, 'config.json')
    const store = new ConfigStore(file)

    store.update({
      maxConcurrentRuns: 2,
      // Split so this file does not itself contain a credential-shaped string.
      token: ['ghp', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_'),
      searchQuery: 'org:acme is:pr is:open label:squad',
    } as never)

    const onDisk = fs.readFileSync(file, 'utf8')
    expect(onDisk).not.toContain('ghp')
    expect(onDisk).not.toContain('org:acme')
    expect(onDisk).not.toContain('searchQuery')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

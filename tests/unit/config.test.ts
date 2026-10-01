import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConfigStore } from '../../src/server/config/store.js'
import { DEFAULT_CONFIG } from '../../src/server/config/schema.js'

const tempDirs: string[] = []

function tempConfigFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'))
  tempDirs.push(dir)
  return path.join(dir, 'config.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('ConfigStore', () => {
  it('starts from defaults when no file exists', () => {
    const store = new ConfigStore(tempConfigFile())
    expect(store.get()).toEqual(DEFAULT_CONFIG)
  })

  it('persists updates and reloads them', () => {
    const file = tempConfigFile()
    const store = new ConfigStore(file)
    store.update({ searchQuery: 'org:acme is:pr is:open label:squad' })

    const reloaded = new ConfigStore(file)
    expect(reloaded.get().searchQuery).toBe('org:acme is:pr is:open label:squad')
    expect(reloaded.get().maxConcurrentRuns).toBe(DEFAULT_CONFIG.maxConcurrentRuns)
  })

  it('rejects out-of-range values', () => {
    const store = new ConfigStore(tempConfigFile())
    expect(() => store.update({ maxConcurrentRuns: 99 })).toThrow()
    expect(() => store.update({ refreshIntervalMs: 5 })).toThrow()
    expect(() => store.update({ searchQuery: '' })).toThrow()
  })

  it('never writes a credential, even when one is sent', () => {
    const file = tempConfigFile()
    const store = new ConfigStore(file)
    store.update({ searchQuery: 'org:acme is:pr', token: 'ghp_secret' } as never)

    const onDisk = fs.readFileSync(file, 'utf8')
    expect(onDisk).not.toContain('ghp_secret')
    expect(onDisk).not.toContain('token')
    expect(JSON.stringify(store.get())).not.toContain('ghp_secret')
  })

  it('fills in keys missing from an older config file', () => {
    const file = tempConfigFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ searchQuery: 'org:acme is:pr' }))

    const store = new ConfigStore(file)
    expect(store.get().port).toBe(DEFAULT_CONFIG.port)
    expect(store.get().searchQuery).toBe('org:acme is:pr')
  })
})

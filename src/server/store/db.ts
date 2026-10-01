import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_FILE } from '../paths.js'

const SCHEMA_FILE = fileURLToPath(new URL('./schema.sql', import.meta.url))

/**
 * Opens the local cache database, creating it if absent. Deleting this file is a supported
 * operation (Constitution II) — the board rebuilds from GitHub, losing only run history.
 */
export function openDatabase(file: string = DB_FILE): DatabaseSync {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8')
  db.exec(schema)
}

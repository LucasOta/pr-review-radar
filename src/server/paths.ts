import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Project root resolved from this file's location, so paths work the same whether the server
 * runs from src/ via tsx or from dist/ after a build.
 */
function findRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // src/server -> src -> root, or dist/server/server -> dist/server -> dist -> root
  const marker = path.sep + 'dist' + path.sep
  if (here.includes(marker)) {
    return here.slice(0, here.indexOf(marker))
  }
  return path.resolve(here, '..', '..')
}

export const ROOT_DIR = findRoot()
export const CONFIG_DIR = path.join(ROOT_DIR, 'config')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
export const DATA_DIR = path.join(ROOT_DIR, 'data')
export const DB_FILE = path.join(DATA_DIR, 'radar.sqlite')
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'dist', 'web')

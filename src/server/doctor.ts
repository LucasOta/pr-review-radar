import fs from 'node:fs'
import path from 'node:path'
import { preflight, PreflightError, formatPreflightError } from './preflight.js'
import { ConfigStore } from './config/store.js'
import { CONFIG_FILE, DB_FILE, ROOT_DIR, WEB_DIST_DIR } from './paths.js'
import { createClients } from './github/client.js'

/** `npm run doctor` — report what the app can see, without starting it. */
async function main(): Promise<void> {
  const checks = await preflight()
  const config = new ConfigStore()
  const settings = config.get()

  const clients = createClients(checks.token)
  const identity = await clients.identity()
  const { data } = await clients.rest.rateLimit.get()

  const lines = [
    `node         ${checks.nodeVersion}`,
    `gh           ${checks.ghVersion}`,
    `claude       ${checks.claudeVersion}`,
    `account      ${identity.login}`,
    `config       ${describe(CONFIG_FILE, 'using built-in defaults')}`,
    `database     ${describe(DB_FILE, 'not created yet — it appears on first refresh')}`,
    `ui bundle    ${describe(`${WEB_DIST_DIR}/index.html`, 'not built — run `npm run build:web`')}`,
    `prompts      ${describe(settings.reviewPromptPath, 'MISSING')} / ${describe(settings.rereviewPromptPath, 'MISSING')}`,
    `query        stored in your browser (localStorage), not on disk`,
    `port         127.0.0.1:${settings.port}`,
    `concurrency  ${settings.maxConcurrentRuns} run(s), ${Math.round(settings.runTimeoutMs / 1000)}s timeout`,
    `rate limit   ${data.resources.core.remaining}/${data.resources.core.limit} core, ` +
      `${data.resources.graphql?.remaining ?? '?'}/${data.resources.graphql?.limit ?? '?'} graphql`,
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function describe(file: string, missing: string): string {
  const resolved = path.isAbsolute(file) ? file : path.join(ROOT_DIR, file)
  return fs.existsSync(resolved) ? file : missing
}

main().catch((error: unknown) => {
  if (error instanceof PreflightError) {
    process.stderr.write(formatPreflightError(error) + '\n')
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

import { preflight, PreflightError, formatPreflightError } from './preflight.js'
import { ConfigStore } from './config/store.js'
import { CONFIG_FILE, DB_FILE } from './paths.js'
import { createClients } from './github/client.js'

/** `npm run doctor` — report what the app can see, without starting it. */
async function main(): Promise<void> {
  const checks = await preflight()
  const config = new ConfigStore()
  void config

  const clients = createClients(checks.token)
  const identity = await clients.identity()
  const { data } = await clients.rest.rateLimit.get()

  const lines = [
    `node        ${checks.nodeVersion}`,
    `gh          ${checks.ghVersion}`,
    `claude      ${checks.claudeVersion}`,
    `account     ${identity.login}`,
    `config      ${CONFIG_FILE}`,
    `database    ${DB_FILE}`,
    `query       stored in your browser (localStorage), not on disk`,
    `rate limit  ${data.resources.core.remaining}/${data.resources.core.limit} core, ` +
      `${data.resources.graphql?.remaining ?? '?'}/${data.resources.graphql?.limit ?? '?'} graphql`,
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

main().catch((error: unknown) => {
  if (error instanceof PreflightError) {
    process.stderr.write(formatPreflightError(error) + '\n')
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

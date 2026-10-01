// tsc emits only JS; the SQL schema travels alongside it.
import fs from 'node:fs'
import path from 'node:path'

const from = path.resolve('src/server/store/schema.sql')
const to = path.resolve('dist/server/server/store/schema.sql')
fs.mkdirSync(path.dirname(to), { recursive: true })
fs.copyFileSync(from, to)
console.log(`copied ${path.relative(process.cwd(), to)}`)

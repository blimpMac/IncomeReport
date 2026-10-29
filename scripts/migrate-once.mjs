import migrate from '../api/migrate.js'

if (!process.env.MIGRATION_SOURCE_URL || !process.env.MIGRATION_RUN_TOKEN) {
  console.log('One-time migration env not present; skipping migration.')
  process.exit(0)
}

let statusCode = 200
let payload = null
const req = {
  method: 'GET',
  query: {
    token: process.env.MIGRATION_RUN_TOKEN,
    sourceUrl: process.env.MIGRATION_SOURCE_URL,
  },
}
const res = {
  status(code) { statusCode = code; return this },
  json(value) { payload = value; return value },
}

await migrate(req, res)
if (statusCode >= 400 || !payload?.ok) {
  throw new Error(`Workbook migration failed: ${payload?.error || `HTTP ${statusCode}`}`)
}
console.log(`Workbook migration complete: ${payload.referenceRows} reference rows, ${payload.qbTransactions} QB transactions, ${payload.rawContextRows} source context rows.`)

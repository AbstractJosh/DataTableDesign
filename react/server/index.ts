/**
 * The dev API server: `node server/index.ts`.
 *
 * No build step and no transpiler — Node strips the types on the way in, which
 * is why every `src/lib` module this reaches for is one whose own runtime
 * import list is empty (`db.ts`'s header explains what that constraint costs
 * and why it is worth it).
 *
 * It binds to loopback only. This serves an unauthenticated read-write API over
 * a demo database and has no business being reachable from anywhere else.
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { ensureSeeded, openDatabase } from './db.ts'
import { createHandler } from './http.ts'

const DB_FILE = process.env.DB_FILE ?? fileURLToPath(new URL('./records.db', import.meta.url))
const PORT = Number(process.env.API_PORT ?? 5174)
const HOST = process.env.API_HOST ?? '127.0.0.1'

/**
 * A hundred thousand, which is the number the whole exercise is calibrated to:
 * big enough that handing the set to the browser is visibly the wrong idea,
 * small enough to seed in about a second and to hold in a file you can delete.
 * The first seventeen are still the hand-checked ones — see `createDemoRecords`.
 */
const SEED_COUNT = Number(process.env.SEED_COUNT ?? 100_000)

const db = openDatabase(DB_FILE)

const started = Date.now()
const { seeded, rows } = ensureSeeded(db, SEED_COUNT)
if (seeded) {
  console.log(`[api] seeded ${rows.toLocaleString('en-GB')} records in ${Date.now() - started}ms`)
} else {
  console.log(`[api] ${rows.toLocaleString('en-GB')} records already in ${DB_FILE}`)
}

const server = createServer(createHandler(db, SEED_COUNT))

server.listen(PORT, HOST, () => {
  console.log(`[api] http://${HOST}:${PORT}`)
})

/**
 * Closing the database on the way out matters more than it looks: WAL leaves a
 * `-wal` sidecar that is only folded back into the main file on a clean close,
 * and `npm run dev` kills this process on every restart.
 */
function shutdown(signal: string) {
  console.log(`[api] ${signal}, closing`)
  server.close(() => {
    db.close()
    process.exit(0)
  })
  // A hung keep-alive socket should not hold the restart up.
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

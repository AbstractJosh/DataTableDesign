/**
 * Rebuilds the database from the generator: `npm run db:seed -- 250000`.
 *
 * Destructive on purpose. The server seeds an empty database on its own, so
 * this is the command for the other two cases — changing the row count, and
 * putting back a set that an afternoon of editing has moved away from the
 * hand-checked one the tests describe.
 */
import { fileURLToPath } from 'node:url'

import { ensureSchema, openDatabase, seed } from './db.ts'

const DB_FILE = process.env.DB_FILE ?? fileURLToPath(new URL('./records.db', import.meta.url))

const argument = process.argv[2]
const count = Number(argument ?? process.env.SEED_COUNT ?? 100_000)

if (!Number.isInteger(count) || count < 0) {
  console.error(`[seed] "${argument}" is not a row count`)
  process.exit(1)
}

const db = openDatabase(DB_FILE)
ensureSchema(db)

const started = Date.now()
const rows = seed(db, count)
db.close()

console.log(
  `[seed] ${rows.toLocaleString('en-GB')} records into ${DB_FILE} in ${Date.now() - started}ms`,
)

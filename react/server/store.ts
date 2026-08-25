/**
 * Writes.
 *
 * The table is not a report — a row can be edited in place, deleted behind a
 * confirmation, added as a draft pinned above the page, and dragged into a new
 * position by its grip. All four arrive at the host as one thing:
 * `onRecordsChange` with the whole next array. That is the right shape for a
 * component holding seventeen records and the wrong one for a database holding
 * a hundred thousand, so `src/lib/recordsApi.ts` diffs the two arrays on the
 * client and sends what actually changed. This file is the other end of that.
 *
 * ## Position, and why it is a float
 *
 * Row order is data here: the grips move rows and a reload has to find them
 * where they were left. Storing it as 1, 2, 3 means a row dragged from the
 * bottom to the top renumbers every row it passed — a hundred thousand writes
 * for one drag. Storing it as a float means a row dropped between two others
 * takes the midpoint of their two `ord` values and nothing else is touched.
 *
 * The cost is that halving the same gap runs out of double precision after
 * about fifty drops into it. `rebalance` renumbers the whole table 1..n when
 * that happens, which is the expensive operation the scheme exists to avoid —
 * but it now happens once every fifty drags into one spot rather than on every
 * drag anywhere.
 */
import type { DatabaseSync } from 'node:sqlite'

import {
  DERIVED_COLUMNS,
  INSERT_SQL,
  RECORD_FIELDS,
  SELECT_FIELDS,
  derive,
  insertParams,
  rowToRecord,
} from './db.ts'
import type { DataTableRecord } from '../src/lib/types.ts'

/** Below this the midpoint of two neighbours stops being strictly between them. */
const MIN_GAP = 1e-9

export function getRecord(db: DatabaseSync, id: string): DataTableRecord | null {
  const row = db
    .prepare(`SELECT ${SELECT_FIELDS} FROM records WHERE "id" = ?`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToRecord(row) : null
}

/**
 * Every record, in the table's own order.
 *
 * `limit` is the demo harness's row-count selector rather than a page: it takes
 * the first n of the set so the screen can be opened at a size worth looking at
 * without waiting for the rest. The table still derives everything it renders
 * from whatever comes back — this endpoint is the *old* contract, kept working
 * on purpose while the windowed one in `query.ts` waits for a virtualised table
 * to have a use for it.
 */
export function listRecords(db: DatabaseSync, limit?: number): DataTableRecord[] {
  const sql =
    `SELECT ${SELECT_FIELDS} FROM records ORDER BY ord` +
    (limit === undefined ? '' : ' LIMIT ?')
  const stmt = db.prepare(sql)
  const rows = (limit === undefined ? stmt.all() : stmt.all(limit)) as Record<
    string,
    unknown
  >[]
  return rows.map(rowToRecord)
}

/* ---- position ------------------------------------------------------- */

function ordOf(db: DatabaseSync, id: string): number | null {
  const row = db.prepare('SELECT ord FROM records WHERE "id" = ?').get(id) as
    | { ord: number }
    | undefined
  return row ? Number(row.ord) : null
}

function bounds(db: DatabaseSync): { min: number; max: number } {
  const row = db.prepare('SELECT MIN(ord) AS lo, MAX(ord) AS hi FROM records').get() as {
    lo: number | null
    hi: number | null
  }
  return { min: row.lo === null ? 1 : Number(row.lo), max: row.hi === null ? 0 : Number(row.hi) }
}

/** The ord immediately after `after`, or null at the end of the table. */
function ordAfter(db: DatabaseSync, after: number): number | null {
  const row = db
    .prepare('SELECT MIN(ord) AS next FROM records WHERE ord > ?')
    .get(after) as { next: number | null }
  return row.next === null ? null : Number(row.next)
}

/**
 * Renumbers every row 1..n in its current order.
 *
 * Called only when a gap has been halved past the point where a midpoint is
 * still strictly between its neighbours. Everything downstream reads `ord`
 * relatively, so this changes no order and no response — only the numbers
 * behind them.
 */
export function rebalance(db: DatabaseSync): void {
  const ids = (db.prepare('SELECT "id" FROM records ORDER BY ord').all() as {
    id: string
  }[]).map((r) => r.id)
  const stmt = db.prepare('UPDATE records SET ord = ? WHERE "id" = ?')
  db.exec('BEGIN')
  try {
    for (let i = 0; i < ids.length; i += 1) stmt.run(i + 1, ids[i])
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * The `ord` a row should take to sit directly after `afterId`.
 *
 * `null` means the top of the table. Rebalances and retries once when the gap
 * it lands in has been used up — the retry cannot fail, because renumbering
 * leaves every gap at exactly 1.
 */
function ordFor(db: DatabaseSync, afterId: string | null, retry = true): number {
  const { min, max } = bounds(db)

  if (afterId === null) return min - 1

  const prev = ordOf(db, afterId)
  if (prev === null) return max + 1

  const next = ordAfter(db, prev)
  if (next === null) return prev + 1

  if (next - prev < MIN_GAP) {
    if (!retry) throw new Error('cannot place a row: ord gap exhausted after a rebalance')
    rebalance(db)
    return ordFor(db, afterId, false)
  }
  return (prev + next) / 2
}

/* ---- one record at a time ------------------------------------------- */

export function insertRecord(
  db: DatabaseSync,
  record: DataTableRecord,
  afterId: string | null = null,
): DataTableRecord {
  db.prepare(INSERT_SQL).run(...insertParams(record, ordFor(db, afterId)))
  return record
}

/**
 * A whole record by id — every field, not a patch.
 *
 * The client sends the record it has rather than the fields that moved, because
 * that is what `onRecordsChange` gives it and inferring a patch from a whole
 * array is guesswork. Rewriting all twelve columns plus the derived ones is one
 * statement either way.
 */
export function updateRecord(db: DatabaseSync, record: DataTableRecord): boolean {
  const derived = derive(record)
  // Everything but the id, which is the key rather than a value, and `ord`,
  // which an edit must never move.
  const fields = RECORD_FIELDS.filter((f) => f !== 'id')
  const sets = [...fields, ...DERIVED_COLUMNS].map((c) => `"${c}" = ?`)
  const params = [
    ...fields.map((f) => String(record[f] ?? '')),
    ...DERIVED_COLUMNS.map((c) => derived[c]),
    record.id,
  ]

  const result = db
    .prepare(`UPDATE records SET ${sets.join(', ')} WHERE "id" = ?`)
    .run(...params)
  return Number(result.changes) > 0
}

export function deleteRecord(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM records WHERE "id" = ?').run(id)
  return Number(result.changes) > 0
}

/** Moves one row to sit directly after `afterId`, or to the top when null. */
export function moveRecord(db: DatabaseSync, id: string, afterId: string | null): boolean {
  if (id === afterId) return false
  if (ordOf(db, id) === null) return false
  db.prepare('UPDATE records SET ord = ? WHERE "id" = ?').run(ordFor(db, afterId), id)
  return true
}

/** The id sitting immediately above `ord`, or null at the top of the table. */
function idBefore(db: DatabaseSync, ord: number): string | null {
  const row = db
    .prepare('SELECT "id" FROM records WHERE ord < ? ORDER BY ord DESC LIMIT 1')
    .get(ord) as { id: string } | undefined
  return row ? row.id : null
}

/**
 * A drag, in the two ids the table made it out of.
 *
 * The asymmetry is the behaviour and it has to match `applyToArray` on the
 * client exactly: a row dropped **downwards** lands after its target, and one
 * dropped **upwards** lands before it. Which of the two a given pair is comes
 * from where the rows currently sit, so it is decided here rather than sent.
 */
export function moveRelative(db: DatabaseSync, fromId: string, toId: string): boolean {
  if (fromId === toId) return false
  const from = ordOf(db, fromId)
  const to = ordOf(db, toId)
  if (from === null || to === null) return false
  // Dropped downwards: sit directly after the target.
  if (from < to) return moveRecord(db, fromId, toId)
  // Dropped upwards: take the target's place, which means anchoring to
  // whatever was above it.
  return moveRecord(db, fromId, idBefore(db, to))
}

/**
 * The id a new record should take: the `REC-<n>` series continued from the
 * highest one the table holds.
 *
 * `nextRecordId` on the client is the same rule over an array. The extra
 * comparison is what keeps the pattern strict — `GLOB 'REC-[0-9]*'` would
 * accept `REC-12abc`, and casting a suffix back to its own text rejects
 * anything that is not exactly an integer.
 */
export function nextId(db: DatabaseSync): string {
  const row = db
    .prepare(
      `SELECT MAX(CAST(SUBSTR("id", 5) AS INTEGER)) AS n FROM records
       WHERE "id" GLOB 'REC-[0-9]*'
         AND CAST(CAST(SUBSTR("id", 5) AS INTEGER) AS TEXT) = SUBSTR("id", 5)`,
    )
    .get() as { n: number | null }
  return 'REC-' + ((row.n === null ? 4813 : Number(row.n)) + 7)
}

/** The records behind a set of ids, in table order. */
export function recordsByIds(db: DatabaseSync, ids: string[]): DataTableRecord[] {
  if (ids.length === 0) return []
  const holes = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT ${SELECT_FIELDS} FROM records WHERE "id" IN (${holes}) ORDER BY ord`)
    .all(...ids) as Record<string, unknown>[]
  return rows.map(rowToRecord)
}

/**
 * Rewrites the whole order from a list of ids, for the case the client could
 * not describe as a single move.
 *
 * Ids the table does not hold are skipped; rows the list does not mention keep
 * their place after the ones it does, because renumbering from 1 puts the named
 * rows below every untouched `ord` rather than interleaving them arbitrarily.
 */
export function reorderAll(db: DatabaseSync, ids: string[]): number {
  const stmt = db.prepare('UPDATE records SET ord = ? WHERE "id" = ?')
  let moved = 0
  db.exec('BEGIN')
  try {
    for (let i = 0; i < ids.length; i += 1) {
      moved += Number(stmt.run(i + 1, ids[i]).changes)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return moved
}

/* ---- the batch the client actually sends ----------------------------- */

export interface SyncPayload {
  added?: { record: DataTableRecord; afterId: string | null }[]
  updated?: DataTableRecord[]
  removed?: string[]
  moved?: { id: string; afterId: string | null }[]
  /**
   * A drag as the table describes it — two ids, no position. `moveRelative`
   * works out which way it went. This is what a windowed client sends, because
   * it has only one page of rows and cannot name the anchor itself.
   */
  dragged?: { fromId: string; toId: string }[]
  /** The complete id order, when the change was not one recognisable move. */
  order?: string[]
}

export interface SyncResult {
  added: number
  updated: number
  removed: number
  moved: number
  reordered: number
  rows: number
}

/**
 * One edit's worth of changes, applied in the order that keeps them meaningful:
 * removals first so an id can be reused, then additions, then field updates,
 * then position.
 *
 * Not wrapped in a single transaction, because `ordFor` may need to rebalance
 * mid-flight and that runs its own. The payload is one user action — a rename,
 * a delete, a drag — so a partial apply is at worst one action half-done, and
 * the client holds the authoritative array either way.
 */
export function applySync(db: DatabaseSync, payload: SyncPayload): SyncResult {
  let removed = 0
  for (const id of payload.removed ?? []) if (deleteRecord(db, id)) removed += 1

  let added = 0
  for (const entry of payload.added ?? []) {
    insertRecord(db, entry.record, entry.afterId)
    added += 1
  }

  let updated = 0
  for (const record of payload.updated ?? []) if (updateRecord(db, record)) updated += 1

  let moved = 0
  for (const move of payload.moved ?? []) if (moveRecord(db, move.id, move.afterId)) moved += 1
  for (const drag of payload.dragged ?? []) if (moveRelative(db, drag.fromId, drag.toId)) moved += 1

  const reordered = payload.order ? reorderAll(db, payload.order) : 0

  const count = db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }
  return { added, updated, removed, moved, reordered, rows: Number(count.n) }
}

/**
 * The SQLite side of the records screen.
 *
 * `src/lib/demoData.ts` still generates the rows — this file only decides how
 * they are *stored*, which is a different question and the one that starts to
 * matter once there are a hundred thousand of them. The public shape is
 * unchanged: a row round-trips to exactly the `DataTableRecord` the table
 * already renders, and every column this file adds beyond those twelve fields
 * is derived, is written by the server, and never leaves it.
 *
 * ## Why there are derived columns at all
 *
 * `DataTable` filters in JavaScript, over an array it holds: `Number(cell)` for
 * a count, `parseTableDate(cell)` for a date, `cell.trim().toLowerCase()` for
 * text. Asking SQLite to reproduce that per row per query means a full scan
 * that reparses `19 August, 2026` a hundred thousand times — and it means
 * SQLite's `lower()`, which is ASCII-only and would quietly disagree with
 * JavaScript's the moment a name has a S-cedilla in it.
 *
 * So each of those conversions is done **once, in JavaScript, at write time**,
 * by the same functions the table uses, and stored beside the row. The filter
 * then becomes a comparison against an indexed column, and the answer is the
 * one the client would have reached, because the same code produced it.
 *
 * ## Why the search subject is folded twice and the rest once
 *
 * The two are not folded the same way, and following the component rather than
 * assuming is the whole trick. `norm` in `filters.ts` — what the text operators
 * compare — is a plain `toLowerCase()` on both the cell and the operand, with
 * no locale. The toolbar *search* is not: it folds with the table's own
 * language tag, because `'ISTANBUL'` with a dotted capital I folds to an i with
 * a *combining dot* under the default rules and stops matching a typed `i`,
 * which `toLocaleLowerCase('tr-TR')` gets right.
 *
 * So `name_lc` and `address_lc` are stored once, plainly folded, and
 * `search_lc` is stored twice — once per language — and a query picks the one
 * its locale asks for. One extra text column, and the search box finds the same
 * rows the client-side one does in both languages.
 *
 * ## Loading this file
 *
 * It runs under plain `node server/index.ts`: Node strips the types, it does
 * *not* resolve extensionless specifiers, and the three `src/lib` modules it
 * imports are exactly the three whose own runtime import lists are empty. That
 * is not a coincidence and it is load-bearing — see the header of
 * `src/lib/tableDate.ts` for why the date parser had to move out of
 * `filters.ts` to get here.
 */
import { DatabaseSync } from 'node:sqlite'

import { createDemoRecords } from '../src/lib/demoData.ts'
import { LOCALE_TAGS } from '../src/lib/i18n.ts'
import { parseTableDate } from '../src/lib/tableDate.ts'
import { RECORD_FIELDS } from '../src/lib/types.ts'
import type { Locale } from '../src/lib/i18n.ts'
import type { DataTableRecord } from '../src/lib/types.ts'

/**
 * Re-exported rather than redeclared. Every `SELECT` names these twelve columns
 * explicitly, so a derived column cannot leak into a response by way of
 * `SELECT *` — and naming them from the same list the component and the client
 * diff read means the three cannot disagree about what a record is.
 */
export { RECORD_FIELDS }
export type { RecordField } from '../src/lib/types.ts'

/** Quoted throughout: `date`, `plan` and `status` all read as keywords. */
export const SELECT_FIELDS = RECORD_FIELDS.map((f) => `"${f}"`).join(', ')

/**
 * Bumped whenever the DDL below changes. `ensureSchema` drops and rebuilds on a
 * mismatch rather than migrating: this database is seeded from a deterministic
 * generator and holds nothing a person typed, so a rebuild costs seconds and a
 * migration path would cost attention for the rest of the project's life. Point
 * it at data someone cares about and that trade stops being the right one.
 */
export const SCHEMA_VERSION = 1

/**
 * `ord` is a float, not an integer, because rows are drag-reordered and that
 * order is data. Dropping a row between two others sets its `ord` to the
 * midpoint of theirs — one `UPDATE` of one row, whatever the row count.
 * Renumbering 1..n instead would turn a single drag near the top of a hundred
 * thousand rows into a hundred thousand writes. `rebalance` in `store.ts` is
 * the escape hatch for when repeated halving runs out of float, which takes
 * about fifty splits inside the same gap.
 */
const SCHEMA = `
CREATE TABLE records (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL,
  "date"            TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "solvedCases"     TEXT NOT NULL,
  "favouriteSeason" TEXT NOT NULL,
  "address"         TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "owner"           TEXT NOT NULL,
  "activity"        TEXT NOT NULL,
  "plan"            TEXT NOT NULL,
  "note"            TEXT NOT NULL,

  -- The row's place in the table's own order. The grips move it and that has
  -- to survive a reload, so it is stored rather than implied by rowid.
  ord               REAL NOT NULL,

  -- parseTableDate(date). NULL when the string does not parse, which is the
  -- same "cannot be placed on the timeline" the client-side filter means by it.
  date_ms           INTEGER,
  -- Number(solvedCases) when finite, else NULL. Same reasoning.
  solved_num        REAL,

  -- value.trim().toLowerCase(), which is norm() in filters.ts exactly: the
  -- text operators are not locale-aware, so neither are these.
  name_lc           TEXT NOT NULL,
  address_lc        TEXT NOT NULL,

  -- name, email and address joined by spaces and folded, untrimmed, because
  -- that is the toolbar search's subject exactly. Twice, because that one *is*
  -- locale-aware — see the header.
  search_lc         TEXT NOT NULL,
  search_lc_tr      TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/**
 * Kept apart from the table so a bulk load can drop them first.
 *
 * Six indexes maintained row by row is most of the cost of seeding: the same
 * hundred thousand records take about ten seconds inserted into an indexed
 * table and about three with the indexes built afterwards, in one pass over
 * data that is already in order. `seed` does the second.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS records_ord     ON records(ord);
CREATE INDEX IF NOT EXISTS records_name    ON records(name_lc);
CREATE INDEX IF NOT EXISTS records_date_ms ON records(date_ms);
CREATE INDEX IF NOT EXISTS records_solved  ON records(solved_num);
CREATE INDEX IF NOT EXISTS records_status  ON records("status");
CREATE INDEX IF NOT EXISTS records_season  ON records("favouriteSeason");
`

const DROP_INDEXES = [
  'records_ord',
  'records_name',
  'records_date_ms',
  'records_solved',
  'records_status',
  'records_season',
]
  .map((name) => `DROP INDEX IF EXISTS ${name};`)
  .join('\n')

/* ---- derived columns ---------------------------------------------- */

export interface Derived {
  date_ms: number | null
  solved_num: number | null
  name_lc: string
  address_lc: string
  search_lc: string
  search_lc_tr: string
}

/**
 * The only characters whose lowercase mapping Turkish disagrees with the
 * default one about: dotted capital I, and plain capital I.
 *
 * Unicode's special-casing rules for `tr` and `az` cover exactly those two —
 * `I` to dotless-i, and dotted-I to plain `i` where the default leaves a
 * combining dot behind. Every other string folds identically, so a string
 * holding neither can take the fast path. Worth the check: locale-tagged
 * folding is roughly sixty times slower than the default one, and seeding calls
 * it once per record.
 */
const TURKISH_I = /[Iİ]/

/** Case folding in one of the table's two languages, and nothing else. */
export const foldCase = (value: string, locale: Locale): string =>
  locale === 'tr' && TURKISH_I.test(value)
    ? value.toLocaleLowerCase(LOCALE_TAGS.tr)
    : value.toLowerCase()

/**
 * `norm` in filters.ts, character for character. Deliberately not locale-aware:
 * the text operators fold the cell and the operand with the plain rules, and a
 * server that folded the cell in Turkish would stop matching an operand the
 * client had folded in English.
 */
const norm = (value: string) => value.trim().toLowerCase()

/**
 * Every stored conversion of one record, computed the way the client computes
 * it. This is the only place a derived column is produced — seeding, inserts
 * and updates all come through here — so a row cannot end up carrying a
 * `date_ms` that disagrees with its own `date`.
 */
export function derive(r: DataTableRecord): Derived {
  const solved = Number(r.solvedCases)
  // `Number('')` is 0, so a blank must not pass for a number here. compareCells
  // and the number filter both guard the same way.
  const numeric = String(r.solvedCases).trim() !== '' && Number.isFinite(solved)
  const subject = `${r.name} ${r.email} ${r.address}`

  return {
    date_ms: parseTableDate(r.date),
    solved_num: numeric ? solved : null,
    name_lc: norm(r.name),
    address_lc: norm(r.address),
    // Untrimmed, because the client does not trim its subject either — it
    // folds `${name} ${email} ${address}` whole and asks whether it contains
    // the (trimmed) query.
    search_lc: foldCase(subject, 'en'),
    search_lc_tr: foldCase(subject, 'tr'),
  }
}

/* ---- rows in and out ----------------------------------------------- */

/** A row as SQLite hands it back, narrowed to the twelve public fields. */
export function rowToRecord(row: Record<string, unknown>): DataTableRecord {
  const out: Record<string, string> = {}
  for (const field of RECORD_FIELDS) out[field] = String(row[field] ?? '')
  return out as unknown as DataTableRecord
}

/**
 * The columns the server computes and the record does not carry. Exported
 * because `store.ts` writes them too, and a second hand-kept list of them is
 * how a column ends up updated in one code path and stale in the other.
 */
export const DERIVED_COLUMNS = [
  'date_ms',
  'solved_num',
  'name_lc',
  'address_lc',
  'search_lc',
  'search_lc_tr',
] as const

/** Takes exactly `insertParams`, in this order. */
export const INSERT_SQL = `
INSERT INTO records (${SELECT_FIELDS}, ord, ${DERIVED_COLUMNS.join(', ')})
VALUES (${[...RECORD_FIELDS, 'ord', ...DERIVED_COLUMNS].map(() => '?').join(', ')})
`

export type SqlParam = string | number | null

/** Positional parameters for `INSERT_SQL`, in its column order. */
export function insertParams(r: DataTableRecord, ord: number): SqlParam[] {
  const d = derive(r)
  return [
    ...RECORD_FIELDS.map((f) => String(r[f] ?? '')),
    ord,
    ...DERIVED_COLUMNS.map((c) => d[c]),
  ]
}

/* ---- opening and seeding ------------------------------------------- */

/**
 * WAL so a read during a write does not block, and `synchronous = NORMAL`
 * because losing the last transaction of a demo database to a power cut is not
 * a loss worth paying for on every insert. Neither is a correctness choice;
 * together they are most of why seeding a hundred thousand rows is a few
 * seconds rather than a few minutes.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  // Before anything writes: page_size only takes on an empty database.
  db.exec('PRAGMA page_size = 8192')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  // Negative is kibibytes rather than pages — 64 MiB, enough to build the
  // indexes after a bulk load without spilling to a temp file.
  db.exec('PRAGMA cache_size = -65536')
  db.exec('PRAGMA temp_store = MEMORY')
  return db
}

function schemaVersion(db: DatabaseSync): number | null {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get()
  if (!table) return null
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : null
}

/** Drops and rebuilds when the stored version is missing or stale. */
export function ensureSchema(db: DatabaseSync): boolean {
  if (schemaVersion(db) === SCHEMA_VERSION) return false
  db.exec('DROP TABLE IF EXISTS records')
  db.exec('DROP TABLE IF EXISTS meta')
  db.exec(SCHEMA)
  db.exec(INDEXES)
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION),
  )
  return true
}

export function rowCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }
  return Number(row.n)
}

/**
 * Writes `records` in the order given, `ord` running from `startOrd` by ones.
 *
 * One transaction and one prepared statement for the whole set: a hundred
 * thousand autocommitted inserts is a hundred thousand fsyncs and takes
 * minutes, where the same rows inside one transaction take about two seconds.
 */
export function insertAll(db: DatabaseSync, records: DataTableRecord[], startOrd = 1): void {
  const stmt = db.prepare(INSERT_SQL)
  db.exec('BEGIN')
  try {
    for (let i = 0; i < records.length; i += 1) {
      stmt.run(...insertParams(records[i], startOrd + i))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Empties the table and refills it from the generator.
 *
 * The first seventeen records are the hand-checked ones whatever `count` is —
 * that is `createDemoRecords`' own promise and every behaviour test in the repo
 * leans on it, so the database inherits it rather than reshuffling.
 */
export function seed(db: DatabaseSync, count: number): number {
  const records = createDemoRecords(count)
  db.exec('DELETE FROM records')
  // Indexes off for the load and rebuilt after it — see the note on INDEXES.
  db.exec(DROP_INDEXES)
  insertAll(db, records)
  db.exec(INDEXES)
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('seed_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(records.length))
  return records.length
}

/** Schema first, then seed — but only if the table came up empty. */
export function ensureSeeded(
  db: DatabaseSync,
  count: number,
): { seeded: boolean; rows: number } {
  ensureSchema(db)
  const existing = rowCount(db)
  if (existing > 0) return { seeded: false, rows: existing }
  return { seeded: true, rows: seed(db, count) }
}

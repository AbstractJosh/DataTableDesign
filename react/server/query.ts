/**
 * The filter dock, the search box and the sort header, expressed as SQL.
 *
 * This is the module the whole server exists for. `DataTable` derives its rows
 * in a fixed order — filter by the dock's conditions, then by the query, then
 * sort, then slice a page out — and every one of those steps is a pass over an
 * array it holds in memory. That is exactly right for the seventeen records the
 * component ships with and exactly wrong for a hundred thousand, where the
 * array is forty megabytes of JSON before the first row is drawn.
 *
 * So the same four steps are written here as one statement, and the client asks
 * for the window it needs instead of the set. Nothing about the *semantics*
 * moved: this reproduces what `matchesAll` and `compareCells` already do, row
 * for row, and `query.test.ts` is a differential test that says so — it runs
 * both implementations over the same records and asserts the same ids come back
 * in the same order.
 *
 * ## What is not identical, and why
 *
 * Ordering. `compareCells` falls back to `String.localeCompare`, which is ICU
 * collation: in Turkish, c-cedilla sorts after `c` rather than folding into it.
 * SQLite has no equivalent it can reach without a registered collation, and
 * `node:sqlite` does not expose one. `ORDER BY` here is byte order over the
 * pre-folded column, which agrees with `localeCompare` for the ASCII the demo
 * data is made of and diverges on accented letters.
 *
 * That divergence is invisible today — the demo loads the whole set through
 * `/api/records/all` and sorts it client-side, exactly as before — and it is
 * the one thing to settle before a virtualised table takes its ordering from
 * this file. The fix is a precomputed rank column per sortable column per
 * locale, written at seed time by `compareCells` itself; it is not here because
 * nothing needs it yet and it has to be reranked on every write.
 */
import type { DatabaseSync } from 'node:sqlite'

import { SELECT_FIELDS, rowToRecord } from './db.ts'
import { LOCALE_TAGS } from '../src/lib/i18n.ts'
import { parseTableDate } from '../src/lib/tableDate.ts'
import type { Locale } from '../src/lib/i18n.ts'
import type { ColumnType, FilterCondition, FilterOp } from '../src/lib/filters.ts'
import type { ColumnKey, DataTableRecord } from '../src/lib/types.ts'

/**
 * How each column is filtered and sorted, and the one place that knows the
 * derived columns exist.
 *
 * The `type` field duplicates `COLUMN_TYPES` in `filters.ts` on purpose — this
 * module cannot import that file at runtime (see `db.ts`'s header) — and
 * `query.test.ts` asserts the two agree, so the duplication cannot drift
 * without a test going red.
 */
interface ColumnPlan {
  type: ColumnType
  /**
   * The plainly-folded text column. Text columns only, and not per-locale:
   * `norm` in filters.ts is a bare `toLowerCase()`, so the text operators mean
   * the same thing in both languages.
   */
  lc?: string
  /** The comparable numeric column. Number and date columns only. */
  num?: string
  /** The raw column, compared verbatim. Enum columns only. */
  raw?: string
}

const COLUMNS: Record<ColumnKey, ColumnPlan> = {
  name: { type: 'text', lc: 'name_lc' },
  date: { type: 'date', num: 'date_ms' },
  status: { type: 'enum', raw: '"status"' },
  solvedCases: { type: 'number', num: 'solved_num' },
  favouriteSeason: { type: 'enum', raw: '"favouriteSeason"' },
  address: { type: 'text', lc: 'address_lc' },
}

export const SORTABLE = Object.keys(COLUMNS) as ColumnKey[]

/**
 * The server's opinion of each column's type, exposed for one reason: so
 * `query.test.ts` can assert it equals `COLUMN_TYPES` in `filters.ts`. The two
 * tables cannot be the same object — this module is loaded by a Node process
 * that cannot resolve `filters.ts` — so the next best thing is a test that goes
 * red the moment they disagree.
 */
export const COLUMN_SQL_TYPES: Record<ColumnKey, ColumnType> = Object.fromEntries(
  SORTABLE.map((key) => [key, COLUMNS[key].type]),
) as Record<ColumnKey, ColumnType>

export const isColumnKey = (value: string): value is ColumnKey =>
  Object.prototype.hasOwnProperty.call(COLUMNS, value)

/**
 * The `ORDER BY` expression for a column.
 *
 * Text sorts on the folded column so casing does not split a name from itself,
 * which is what `localeCompare` does too. `date` deliberately sorts on the raw
 * string rather than on `date_ms`: the table sorts dates lexicographically —
 * a documented handoff gotcha kept on purpose — and a server that quietly
 * sorted them chronologically would put the rows in an order the client would
 * never produce.
 */
function orderExpression(key: ColumnKey): string {
  const plan = COLUMNS[key]
  if (plan.type === 'text') return plan.lc!
  if (plan.type === 'number') return plan.num!
  if (plan.type === 'date') return '"date"'
  return plan.raw!
}

/* ---- the request --------------------------------------------------- */

export interface RecordQuery {
  offset: number
  limit: number
  /** The toolbar search box, verbatim. Folded here, not by the caller. */
  q: string
  /** The dock's chips. ANDed, and inactive ones are skipped. */
  where: FilterCondition[]
  sort: ColumnKey | null
  dir: 'asc' | 'desc'
  /** Decides the case folding, and nothing about which records exist. */
  locale: Locale
}

export interface RecordPage {
  rows: DataTableRecord[]
  /** Matching rows before the window is taken — what the pager counts. */
  total: number
  /**
   * Rows in the table before any filter at all.
   *
   * The header's first stat, and the one number a windowed client cannot work
   * out for itself — it has never seen the unfiltered set. Cheap enough to send
   * with every window that making it a second request would cost more than it
   * saved.
   */
  grandTotal: number
  offset: number
  limit: number
}

/** High enough for any scroll window, low enough that it is not a whole-set download. */
export const MAX_LIMIT = 5000
export const DEFAULT_LIMIT = 100

export const EMPTY_QUERY: RecordQuery = {
  offset: 0,
  limit: DEFAULT_LIMIT,
  q: '',
  where: [],
  sort: null,
  dir: 'asc',
  locale: 'en',
}

/* ---- conditions to SQL ---------------------------------------------- */

type Fragment = { sql: string; params: (string | number)[] }

const TRUE: Fragment = { sql: '1 = 1', params: [] }
const FALSE: Fragment = { sql: '0 = 1', params: [] }

/**
 * `isActive` from `filters.ts`, and the rule that makes the dock usable: a
 * condition with no operand yet filters *nothing*. Drop it here and a column
 * dragged into the dock would blank the table before anything was typed into
 * it, which reads as a broken drop.
 */
function isActive(c: FilterCondition, type: ColumnType): boolean {
  if (type === 'enum') return c.values.length > 0
  if (c.value.trim() === '') return false
  // `between` needs both ends; one end alone is not half a range, it is nothing.
  if (c.op === 'between') return c.value2.trim() !== ''
  return true
}

/** Inclusive, and tolerant of a range typed backwards — swap rather than fail. */
const lo = (a: number, b: number) => Math.min(a, b)
const hi = (a: number, b: number) => Math.max(a, b)

function textFragment(col: string, op: FilterOp, operand: string): Fragment {
  const value = operand.trim().toLowerCase()
  switch (op) {
    case 'contains':
      return { sql: `instr(${col}, ?) > 0`, params: [value] }
    case 'notContains':
      return { sql: `instr(${col}, ?) = 0`, params: [value] }
    case 'is':
      return { sql: `${col} = ?`, params: [value] }
    case 'startsWith':
      return { sql: `instr(${col}, ?) = 1`, params: [value] }
    default:
      // An operator the column's type does not offer never reaches a condition,
      // and `matchesCondition` returns true for one that somehow does.
      return TRUE
  }
}

/**
 * Shared by number and date: both compare one stored number against one or two
 * parsed operands, and both throw the row away when either side will not parse.
 * The only difference is how the operand becomes a number, which the caller has
 * already done.
 */
function numericFragment(
  col: string,
  op: FilterOp,
  a: number | null,
  b: number | null,
): Fragment {
  if (a === null) return FALSE
  const present = `${col} IS NOT NULL`
  switch (op) {
    case 'is':
    case 'on':
      return { sql: `${present} AND ${col} = ?`, params: [a] }
    case 'gte':
      return { sql: `${present} AND ${col} >= ?`, params: [a] }
    case 'lte':
      return { sql: `${present} AND ${col} <= ?`, params: [a] }
    case 'gt':
    case 'after':
      return { sql: `${present} AND ${col} > ?`, params: [a] }
    case 'lt':
    case 'before':
      return { sql: `${present} AND ${col} < ?`, params: [a] }
    case 'between':
      if (b === null) return FALSE
      return { sql: `${present} AND ${col} BETWEEN ? AND ?`, params: [lo(a, b), hi(a, b)] }
    default:
      return TRUE
  }
}

function enumFragment(col: string, op: FilterOp, values: string[]): Fragment {
  const holes = values.map(() => '?').join(', ')
  const negate = op === 'isNoneOf'
  return { sql: `${col} ${negate ? 'NOT IN' : 'IN'} (${holes})`, params: [...values] }
}

/**
 * One chip. `TRUE` when it has nothing in it yet.
 *
 * No locale: none of the four operator families is locale-sensitive. The text
 * ones fold plainly on both sides, the enum ones compare canonical English
 * values verbatim, and numbers and dates are already numbers by the time they
 * get here. The search box is the one part of the query that has a language,
 * and it is handled in `buildWhere`.
 */
export function conditionFragment(c: FilterCondition): Fragment {
  const plan = COLUMNS[c.key]
  if (!plan) return TRUE
  if (!isActive(c, plan.type)) return TRUE

  switch (plan.type) {
    case 'enum':
      return enumFragment(plan.raw!, c.op, c.values)
    case 'number': {
      const a = Number(c.value)
      const b = Number(c.value2)
      return numericFragment(
        plan.num!,
        c.op,
        Number.isFinite(a) ? a : null,
        Number.isFinite(b) ? b : null,
      )
    }
    case 'date':
      return numericFragment(
        plan.num!,
        c.op,
        parseTableDate(c.value),
        parseTableDate(c.value2),
      )
    default:
      return textFragment(plan.lc!, c.op, c.value)
  }
}

/**
 * The whole `WHERE`, in the table's own derive order: the dock's conditions
 * ANDed, then the search box.
 *
 * Order is presentation only here — `AND` commutes — but it is written the way
 * the component reads so the two can be compared line by line.
 */
export function buildWhere(query: RecordQuery): Fragment {
  const parts: string[] = []
  const params: (string | number)[] = []

  for (const condition of query.where) {
    const fragment = conditionFragment(condition)
    if (fragment.sql === TRUE.sql) continue
    parts.push(`(${fragment.sql})`)
    params.push(...fragment.params)
  }

  const q = query.q.trim().toLocaleLowerCase(LOCALE_TAGS[query.locale])
  if (q) {
    parts.push(`(instr(${query.locale === 'tr' ? 'search_lc_tr' : 'search_lc'}, ?) > 0)`)
    params.push(q)
  }

  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params }
}

/**
 * `ord` is always the last term, never the only one dropped.
 *
 * `Array.prototype.sort` is stable, so two records the comparator calls equal
 * keep the order they were already in — which, for the table, is the order the
 * grips put them in. Without the tiebreak SQLite is free to return ties in any
 * order it likes, and a page boundary that falls inside a run of equal values
 * would then show a row twice or not at all as the window moved.
 */
export function buildOrder(query: RecordQuery): string {
  if (!query.sort) return 'ORDER BY ord'
  const expression = orderExpression(query.sort)
  const direction = query.dir === 'desc' ? 'DESC' : 'ASC'
  // NULLs are the rows whose cell would not parse as a number. The comparator
  // cannot place them either; keeping them together at the end is at least a
  // stable answer rather than an arbitrary one.
  return `ORDER BY ${expression} ${direction} NULLS LAST, ord ASC`
}

/* ---- running it ------------------------------------------------------ */

export function countRecords(db: DatabaseSync, query: RecordQuery): number {
  const where = buildWhere(query)
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where.sql}`)
    .get(...where.params) as { n: number }
  return Number(row.n)
}

/** One window, plus the total it was taken from. */
export function queryRecords(db: DatabaseSync, query: RecordQuery): RecordPage {
  const where = buildWhere(query)
  const sql =
    `SELECT ${SELECT_FIELDS} FROM records WHERE ${where.sql} ` +
    `${buildOrder(query)} LIMIT ? OFFSET ?`

  const rows = db
    .prepare(sql)
    .all(...where.params, query.limit, query.offset) as Record<string, unknown>[]

  const all = db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }

  return {
    rows: rows.map(rowToRecord),
    total: countRecords(db, query),
    grandTotal: Number(all.n),
    offset: query.offset,
    limit: query.limit,
  }
}

/**
 * Every value in one column, across the matching set, in the query's order.
 *
 * The whole-column selection: a hundred thousand cells taken at once, which the
 * table needs in order to read them, copy them and write them to a file. One
 * column of strings is a couple of megabytes where the same rows as records are
 * forty, and the other eleven fields are ones nothing downstream reads — see
 * `CellRow` in `cellRange.ts`.
 */
export function columnValues(db: DatabaseSync, key: ColumnKey, query: RecordQuery): string[] {
  const where = buildWhere(query)
  const rows = db
    .prepare(`SELECT "${key}" AS v FROM records WHERE ${where.sql} ${buildOrder(query)}`)
    .all(...where.params) as { v: unknown }[]
  return rows.map((row) => String(row.v ?? ''))
}

/* ---- parsing a request ----------------------------------------------- */

export type ParseResult =
  | { ok: true; query: RecordQuery }
  | { ok: false; error: string }

function integer(raw: string | null, fallback: number, min: number, max: number) {
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n)) return null
  return Math.min(max, Math.max(min, n))
}

/**
 * A `RecordQuery` out of a URL's search params, or the reason it is not one.
 *
 * Everything is optional and everything is clamped rather than trusted:
 * `limit` is capped at `MAX_LIMIT` so a mistyped URL cannot ask for the whole
 * table through the window endpoint, and an unknown `sort` column is an error
 * rather than a silent fall back to natural order, because a sorted table
 * quietly serving unsorted rows is the kind of bug that gets shipped.
 */
export function parseRecordQuery(params: URLSearchParams): ParseResult {
  const offset = integer(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  if (offset === null) return { ok: false, error: 'offset must be a whole number' }

  const limit = integer(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  if (limit === null) return { ok: false, error: 'limit must be a whole number' }

  const sortRaw = params.get('sort')
  let sort: ColumnKey | null = null
  if (sortRaw !== null && sortRaw !== '') {
    if (!isColumnKey(sortRaw)) {
      return {
        ok: false,
        error: `unknown sort column "${sortRaw}" — one of ${SORTABLE.join(', ')}`,
      }
    }
    sort = sortRaw
  }

  const dirRaw = params.get('dir') ?? 'asc'
  if (dirRaw !== 'asc' && dirRaw !== 'desc') {
    return { ok: false, error: 'dir must be asc or desc' }
  }

  const localeRaw = params.get('locale') ?? 'en'
  if (localeRaw !== 'en' && localeRaw !== 'tr') {
    return { ok: false, error: 'locale must be en or tr' }
  }

  const whereRaw = params.get('where')
  let where: FilterCondition[] = []
  if (whereRaw !== null && whereRaw.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(whereRaw)
    } catch {
      return { ok: false, error: 'where must be JSON' }
    }
    if (!Array.isArray(parsed)) return { ok: false, error: 'where must be a JSON array' }
    const checked = parsed.map(normaliseCondition)
    for (const entry of checked) {
      if (typeof entry === 'string') return { ok: false, error: entry }
    }
    where = checked as FilterCondition[]
  }

  return {
    ok: true,
    query: {
      offset,
      limit,
      q: params.get('q') ?? '',
      where,
      sort,
      dir: dirRaw,
      locale: localeRaw,
    },
  }
}

/** A condition, or the message explaining why it is not one. */
function normaliseCondition(value: unknown): FilterCondition | string {
  if (typeof value !== 'object' || value === null) return 'each where entry must be an object'
  const c = value as Partial<FilterCondition>
  if (typeof c.key !== 'string' || !isColumnKey(c.key)) {
    return `unknown filter column "${String(c.key)}"`
  }
  if (typeof c.op !== 'string') return 'each where entry needs an op'
  const values = Array.isArray(c.values) ? c.values.map(String) : []
  return {
    id: typeof c.id === 'string' ? c.id : c.key,
    key: c.key,
    op: c.op as FilterOp,
    values,
    value: typeof c.value === 'string' ? c.value : '',
    value2: typeof c.value2 === 'string' ? c.value2 : '',
  }
}

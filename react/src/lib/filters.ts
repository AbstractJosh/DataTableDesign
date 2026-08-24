/**
 * PORT ADDITION: the filter engine behind the filter dock.
 *
 * The prototype had one "Status" dropdown and a single `filter` string
 * (data-table.html's `state.filter`). The dock replaces it: a column dragged out
 * of the table header by its ⠿ grip becomes a *condition* — one column, one
 * operator, and however many operands that operator takes. Conditions combine
 * with AND, and the operators a condition may offer are decided entirely by the
 * column's `ColumnType`, so nothing here needs to know which column it is
 * looking at beyond `COLUMN_TYPES[key]`.
 *
 * `FilterCondition` is flat rather than a discriminated union on type. The
 * reducer patches one field at a time (`setConditionOp`, `setConditionValue`,
 * `toggleConditionValue`) and the chip renders from `COLUMN_TYPES[key]`, so a
 * union would buy a narrowing dance at every one of those call sites and no
 * safety that `OPS_FOR_TYPE` does not already give: an op that a column's type
 * does not list is never offered, so it never reaches a condition.
 *
 * The rule that makes the whole feature usable lives in `isActive`: a condition
 * with no operand yet matches everything. Read it before changing anything here.
 */
import { EN, readEnum, type Strings } from './i18n'
import {
  SEASONS,
  STATUSES,
  type ColumnKey,
  type DataTableRecord,
} from './types'

export type ColumnType = 'text' | 'number' | 'date' | 'enum'

/**
 * Every filterable column's type. `solvedCases` and `date` are held as strings
 * on the record like everything else — the type is about how a *filter* reads
 * them, not about how they are stored.
 */
export const COLUMN_TYPES: Record<ColumnKey, ColumnType> = {
  name: 'text',
  date: 'date',
  status: 'enum',
  solvedCases: 'number',
  favouriteSeason: 'enum',
  address: 'text',
}

/**
 * The options a chip offers for an enum column, in the order the popup lists
 * them. `toggleConditionValue` keeps a condition's `values` in this order too,
 * so the chip's summary text does not reshuffle as options are ticked.
 */
export const ENUM_OPTIONS: Partial<Record<ColumnKey, readonly string[]>> = {
  status: STATUSES,
  favouriteSeason: SEASONS,
}

export type TextOp = 'contains' | 'notContains' | 'is' | 'startsWith'
export type NumberOp = 'is' | 'gte' | 'lte' | 'gt' | 'lt' | 'between'
export type DateOp = 'on' | 'before' | 'after' | 'between'
export type EnumOp = 'isAnyOf' | 'isNoneOf'
export type FilterOp = TextOp | NumberOp | DateOp | EnumOp

/**
 * The first entry of each list is what a freshly dropped column starts on, so
 * each one leads with the operator that column is most often filtered by.
 */
export const OPS_FOR_TYPE: Record<ColumnType, readonly FilterOp[]> = {
  text: ['contains', 'notContains', 'is', 'startsWith'],
  number: ['is', 'gte', 'lte', 'gt', 'lt', 'between'],
  date: ['on', 'before', 'after', 'between'],
  enum: ['isAnyOf', 'isNoneOf'],
}

/**
 * Sentence case, and phrased to read left to right after the column label:
 * "Solved cases · is at least 100". The chip uppercases it in CSS, so these
 * stay lower case here.
 *
 * The English reference, and the exported one — a host reading a condition back
 * gets a stable word for each operator whatever the table is currently set to.
 * What the chip renders is `Strings.ops`, which `i18n.ts` keeps in step with
 * this table by declaring the same `Record<FilterOp, string>`; adding an
 * operator here fails to compile until every locale has named it.
 */
export const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  startsWith: 'starts with',
  gte: 'is at least',
  lte: 'is at most',
  gt: 'is over',
  lt: 'is under',
  between: 'is between',
  on: 'is on',
  before: 'is before',
  after: 'is after',
  isAnyOf: 'is any of',
  isNoneOf: 'is none of',
}

/**
 * Flat rather than a discriminated union: the reducer patches one field at a
 * time and the chip renders from COLUMN_TYPES[key], so a union would cost a
 * narrowing dance at every call site for no safety this shape does not already
 * get from OPS_FOR_TYPE.
 *
 * Operands are always held as strings — they come straight off an `<input>` and
 * are parsed at match time, so a half-typed "20" in a date field is a value the
 * condition can hold rather than an error it has to represent.
 */
export interface FilterCondition {
  id: string
  key: ColumnKey
  op: FilterOp
  /** Enum only: the ticked options, in `ENUM_OPTIONS` order. */
  values: string[]
  /** Text / number / date: the single operand, or the low end of `between`. */
  value: string
  /** The second operand of `between`; blank for every other operator. */
  value2: string
}

/**
 * A module counter rather than `Math.random` or `Date.now`: ids are React keys
 * and the auto-open logic diffs them, so the tests need them to be predictable.
 */
let conditionSeq = 0

export function nextConditionId(): string {
  conditionSeq += 1
  return `f${conditionSeq}`
}

/** A fresh, inert condition for `key` — first operator, no operands. */
export function newCondition(key: ColumnKey): FilterCondition {
  return {
    id: nextConditionId(),
    key,
    op: OPS_FOR_TYPE[COLUMN_TYPES[key]][0],
    values: [],
    value: '',
    value2: '',
  }
}

export function conditionType(c: FilterCondition): ColumnType {
  return COLUMN_TYPES[c.key]
}

/**
 * Whether a condition has enough of an operand to mean anything yet.
 *
 * An inactive condition filters *nothing* — `matchesAll` skips it. That is not
 * an oversight to be tightened later: a column dropped into the dock arrives
 * with no operand, and if an empty condition matched nothing the table would go
 * blank the instant the user let go of the grip, which reads as a broken drop.
 * The chip renders itself `.dt-idle` with the value text "Any" to say so.
 */
export function isActive(c: FilterCondition): boolean {
  if (conditionType(c) === 'enum') return c.values.length > 0
  if (c.value.trim() === '') return false
  // `between` needs both ends; one end alone is not half a range, it is nothing.
  if (c.op === 'between') return c.value2.trim() !== ''
  return true
}

/**
 * The chip's value text. Callers uppercase it in CSS — do not shout here.
 *
 * The dictionary is optional and defaults to English, so a host calling this to
 * label its own copy of a condition is unaffected. Three things in it are the
 * locale's rather than this function's: the operator word, the enum values
 * (which are canonical English on the record and read as the language on
 * screen), and the whole shape of `between` — English puts the operator first
 * and joins with "and", Turkish puts the postposition last ("1 ile 5
 * arasında"), so `betweenText` builds that clause rather than this.
 */
export function describeCondition(c: FilterCondition, t: Strings = EN): string {
  if (!isActive(c)) return t.any

  if (conditionType(c) === 'enum') {
    const list = c.values.map((value) => readEnum(t, c.key, value)).join(', ')
    return c.op === 'isNoneOf' ? t.noneOf(list) : list
  }

  if (c.op === 'between') {
    return t.betweenText(c.value.trim(), c.value2.trim())
  }

  return `${t.ops[c.op]} ${c.value.trim()}`
}

/* ---- the month table ---------------------------------------------- */

/**
 * The record format is `'19 August, 2026'`, which `new Date(string)` parses
 * only by luck: it is not an ISO string, so the result is implementation- and
 * locale-defined. Match the month name against this table instead so the same
 * record filters identically on every host.
 */
const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

/** `'2026-08-19'` — what an `<input type="date">` hands back. */
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
/** `'19 August, 2026'` — the record format. The comma is optional. */
const NAMED_DATE = /^(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})$/

/**
 * Both date shapes to a UTC epoch at midnight, or null when neither matches.
 *
 * UTC, not local: the two operands being compared may come from different
 * shapes, and a local-midnight parse would put them on different sides of a DST
 * boundary for the same calendar day.
 *
 * Note the asymmetry with sorting, which is *not* a bug: `DataTable` still
 * sorts dates with `String(a[key]).localeCompare(...)`, lexicographically, the
 * way the prototype did — a documented handoff gotcha kept on purpose so the
 * port stays faithful. Filtering has no prototype behaviour to be faithful to,
 * so it parses properly. Swap in a real comparator alongside real data.
 */
export function parseTableDate(value: string): number | null {
  const text = value.trim()
  if (!text) return null

  const iso = ISO_DATE.exec(text)
  if (iso) return utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))

  const named = NAMED_DATE.exec(text)
  if (!named) return null

  const month = MONTHS[named[2].toLowerCase()]
  if (month === undefined) return null
  return utc(Number(named[3]), month, Number(named[1]))
}

/** Rejects a rolled-over day (`31 February`) rather than silently shifting it. */
function utc(year: number, month: number, day: number): number | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const ms = Date.UTC(year, month, day)
  return new Date(ms).getUTCDate() === day ? ms : null
}

/* ---- matching ------------------------------------------------------ */

const norm = (value: string) => value.trim().toLowerCase()

/** Inclusive, and tolerant of a range typed backwards — swap rather than fail. */
function withinRange(subject: number, a: number, b: number): boolean {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return subject >= lo && subject <= hi
}

/**
 * Whether one record satisfies one condition.
 *
 * An inactive condition returns true here as well as being skipped by
 * `matchesAll`, so a caller that reaches for a single condition on its own gets
 * the same answer the table does.
 */
export function matchesCondition(record: DataTableRecord, c: FilterCondition): boolean {
  if (!isActive(c)) return true

  const raw = String(record[c.key] ?? '')

  switch (conditionType(c)) {
    case 'enum': {
      const hit = c.values.includes(raw)
      return c.op === 'isNoneOf' ? !hit : hit
    }

    case 'number': {
      const subject = Number(raw)
      const operand = Number(c.value)
      // A non-numeric cell or a half-typed operand fails rather than throwing
      // the row away silently under some other comparison.
      if (!Number.isFinite(subject) || !Number.isFinite(operand)) return false
      switch (c.op) {
        case 'is':
          return subject === operand
        case 'gte':
          return subject >= operand
        case 'lte':
          return subject <= operand
        case 'gt':
          return subject > operand
        case 'lt':
          return subject < operand
        case 'between': {
          const other = Number(c.value2)
          if (!Number.isFinite(other)) return false
          return withinRange(subject, operand, other)
        }
        default:
          return true
      }
    }

    case 'date': {
      const subject = parseTableDate(raw)
      const operand = parseTableDate(c.value)
      // Either side unparseable and the row cannot be placed on the timeline.
      if (subject === null || operand === null) return false
      switch (c.op) {
        case 'on':
          return subject === operand
        case 'before':
          return subject < operand
        case 'after':
          return subject > operand
        case 'between': {
          const other = parseTableDate(c.value2)
          if (other === null) return false
          return withinRange(subject, operand, other)
        }
        default:
          return true
      }
    }

    default: {
      // Text: both sides trimmed and lower-cased, so filtering matches the
      // toolbar search's case-insensitive feel rather than the cell's casing.
      const subject = norm(raw)
      const operand = norm(c.value)
      switch (c.op) {
        case 'contains':
          return subject.includes(operand)
        case 'notContains':
          return !subject.includes(operand)
        case 'is':
          return subject === operand
        case 'startsWith':
          return subject.startsWith(operand)
        default:
          return true
      }
    }
  }
}

/**
 * AND across the active conditions. No conditions — or none of them filled in
 * yet — and every record matches.
 */
export function matchesAll(record: DataTableRecord, conditions: FilterCondition[]): boolean {
  for (const c of conditions) {
    if (!isActive(c)) continue
    if (!matchesCondition(record, c)) return false
  }
  return true
}

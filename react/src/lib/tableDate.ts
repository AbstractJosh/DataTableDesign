/**
 * Parsing the record's `date` string, split out of `filters.ts` so it can be
 * read by something that is not a browser.
 *
 * The SQLite server (`server/`) precomputes a `date_ms` column at write time so
 * a date filter can be a `BETWEEN` on an indexed integer rather than a scan
 * that parses 100k strings. It runs under Node's type stripping, which resolves
 * import specifiers the way ESM does — extensionless — so it can only load a
 * module whose *runtime* import list is empty. `filters.ts` imports `i18n.ts`
 * for `describeCondition`, so this half moves here and `filters.ts` re-exports
 * it. Nothing else about it changed, and there is deliberately no second copy
 * of the month table: the server parsing a date one way and the table filtering
 * it another is the exact bug this arrangement exists to make impossible.
 *
 * KEEP THIS FILE IMPORT-FREE. A single runtime import breaks the server.
 */

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

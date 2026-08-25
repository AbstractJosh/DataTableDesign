/**
 * How one cell sorts against another, split out of `DataTable.tsx` for the same
 * reason `parseTableDate` was split out of `filters.ts`: something that is not
 * a browser needs to agree with it.
 *
 * The SQLite server in `server/` can sort a hundred thousand rows without
 * sending them, and `server/query.test.ts` is the test that says its `ORDER BY`
 * puts them where this function would. That test can only be written if this
 * function is reachable from outside the component — a copy of it in the test
 * would assert that the copy agrees with SQLite, which is not the question.
 *
 * KEEP THIS FILE IMPORT-FREE, like `tableDate.ts`: the server loads it under
 * Node's type stripping, which does not resolve extensionless specifiers.
 */

/**
 * The prototype sorts every column with `localeCompare`, which is lexicographic
 * even for dates — that stands, and swapping in real comparators is still the
 * note for whoever wires this to an API. Two numbers are the exception: text
 * order puts 100 before 20, which is plainly wrong on a column of case counts
 * and would be read as a bug in the sum beside it.
 */
export function compareCells(a: string, b: string, locale?: string): number {
  const x = Number(a)
  const y = Number(b)
  // `Number('')` is 0, so a blank must not pass for a number here
  if (a.trim() && b.trim() && Number.isFinite(x) && Number.isFinite(y)) return x - y
  /* The table's own language decides the collation, not the host machine's.
     Turkish orders ç after c and ş after s rather than folding them together,
     so a name column sorted on an English laptop would put Çetin in the wrong
     place for the person reading it. Undefined keeps the host's own order, which
     is what this did before there were two languages. */
  return a.localeCompare(b, locale)
}

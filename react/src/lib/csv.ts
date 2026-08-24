/**
 * PORT ADDITION: the Export button's file.
 *
 * The prototype's Export is a stub (L-12) and the port's first pass only
 * forwarded the checked records to a prop. What is here is the export itself —
 * the component writes the `.csv`, and `onExport` becomes a notification rather
 * than the implementation.
 *
 * The split is the same one `cellRange.ts` makes for the clipboard: the shape
 * of the export (`ExportPlan`) and the text it comes to (`planCsv`) are pure
 * and testable, and only `downloadCsv` touches the DOM.
 *
 * Note there are *three* things the button can be asked to export, because the
 * table has three ways of selecting something (see the header of cellRange.ts):
 * a rectangle of cells over the page, one whole column over every page, and the
 * checkbox selection of whole records. `ExportPlan` is the one shape all three
 * flatten to — a list of columns, a list of records, and which of the three it
 * came from.
 */
import { COLUMN_LABELS, type ColumnKey, type DataTableRecord } from './types'

/** Which selection the file was built from. Decides its default name. */
export type ExportSource = 'cells' | 'column' | 'rows'

export interface ExportPlan {
  source: ExportSource
  /** The columns the file carries, left to right, in their on-screen order. */
  columns: ColumnKey[]
  /** The records its rows come from, top to bottom. */
  records: DataTableRecord[]
}

/** Cells in the file, its header row excluded. */
export function planSize(plan: ExportPlan): number {
  return plan.columns.length * plan.records.length
}

/**
 * RFC 4180: a value carrying a comma, a quote or a line break is wrapped in
 * quotes with its own quotes doubled. Deliberately a shade wider than the rule
 * — a leading or trailing space is quoted too, because a spreadsheet that trims
 * it silently changes the data.
 *
 * This is the comma-separated sibling of `tsvCell` in cellRange.ts, and the two
 * stay apart on purpose: the clipboard's flavour is tab-separated because that
 * is what Excel reads off a paste, and a file's is comma-separated because that
 * is what `.csv` means. Merging them would mean one of the two lying about its
 * own name.
 */
export function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value) && value === value.trim()) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * CRLF between records, as RFC 4180 asks. Excel, Sheets and Numbers all read LF
 * as well; the older Windows tools that do not are exactly the ones likely to
 * be opening a file this button wrote.
 */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * The plan as CSV text, header row first.
 *
 * The header is the one place this parts company with the clipboard, which
 * copies a rectangle bare (`rangeText`). A paste lands next to the columns it
 * came from and needs no labels; a file is opened days later by someone who was
 * not there, and two columns of bare numbers are worth nothing to them.
 *
 * Which is also the argument for `labels`: the component passes the language it
 * is set to, so someone reading a Turkish table exports a file headed `Ad`,
 * `Tarih`, `Durum` rather than one headed in a language they did not choose.
 * The *cells* stay canonical either way — a status is the string `Success` in
 * the file as it is on the record — so the export is still something a second
 * system can read back. Omitting it keeps the English headers this always had.
 */
export function planCsv(
  plan: ExportPlan,
  labels: Record<ColumnKey, string> = COLUMN_LABELS,
): string {
  const header = plan.columns.map((key) => labels[key])
  const body = plan.records.map((record) =>
    plan.columns.map((key) => String(record[key] ?? '')),
  )
  return toCsv([header, ...body])
}

/* ---- naming ------------------------------------------------------- */

const FALLBACK_NAME = 'export'

/**
 * Lower-case, non-alphanumerics folded to single hyphens, trimmed of them.
 *
 * Accented letters are folded to their base rather than thrown away, or a
 * Turkish column would name its file after the holes left behind: `Çözülen vaka`
 * went to `z-len-vaka` when everything outside `a-z0-9` was simply a separator.
 * NFD splits a letter from its marks and the marks are then dropped — which
 * handles ç ğ ö ş ü, but not ı, whose dotlessness *is* the letter and so
 * decomposes to nothing. The two i's are mapped by hand first, before the
 * lower-casing that would otherwise turn İ into an i with a combining dot.
 */
const FOLD: Record<string, string> = { 'ı': 'i', 'İ': 'i', 'I': 'i' }

export function slug(value: string): string {
  return value
    .replace(/[ıİI]/g, (letter) => FOLD[letter])
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * What the name box opens on. It is a suggestion and nothing more — the box
 * exists so the user can replace it — so it says what is in the file rather
 * than trying to be unique: the table's own title, then the shape of the
 * selection. A whole column names the column, since that is the only thing
 * distinguishing one column export from the next.
 */
export function defaultExportName(
  plan: ExportPlan,
  title: string,
  labels: Record<ColumnKey, string> = COLUMN_LABELS,
): string {
  const base = slug(title) || 'data-table'
  if (plan.source === 'column') {
    return `${base}-${slug(labels[plan.columns[0]])}`
  }
  if (plan.source === 'cells') return `${base}-cells`
  return `${base}-${plan.records.length}-record${plan.records.length === 1 ? '' : 's'}`
}

/**
 * The typed name as a file name: no path separators, no characters Windows
 * refuses, no leading dot, and exactly one `.csv` on the end however many the
 * user typed. An empty box saves as `export.csv` rather than refusing — the
 * file is already built by the time the box is on screen, and losing it to a
 * blank field would be the wrong half of the transaction to cancel.
 */
export function csvFileName(typed: string): string {
  const stem = typed
    // control characters, then the set Windows refuses in a file name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // however many the user typed, exactly one goes back on below
    .replace(/(\.csv)+$/i, '')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
  return `${stem || FALLBACK_NAME}.csv`
}

/* ---- the download ------------------------------------------------- */

/** Written out rather than pasted in, so it survives an editor that strips it. */
const BOM = '\uFEFF'

/**
 * Hand the file to the browser. `false` means it refused — the same contract as
 * `writeClipboard`, and for the same reason: both are one of the few things a
 * component can ask for and be told no, so both report it rather than pretend.
 *
 * The BOM is not decoration. Excel on Windows reads a BOM-less `.csv` in the
 * system code page, so a name carrying `ı`, `ş` or `ğ` comes out mangled in the
 * one application most likely to open this file. Every other reader skips it.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false

  const url = URL.createObjectURL(
    new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.cssText = 'position:fixed;left:-9999px'
  document.body.appendChild(link)
  try {
    link.click()
  } catch {
    link.remove()
    URL.revokeObjectURL(url)
    return false
  }
  link.remove()
  // Not revoked inline: some browsers read the URL after `click()` has already
  // returned, and a revoke on the same tick loses them the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}

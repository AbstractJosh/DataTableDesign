/**
 * Excel-style cell-range selection.
 *
 * The range is a rectangle over what is *on screen* — a row index inside the
 * current page's rows and a column index inside `state.cols` — not a set of
 * record ids. That is deliberate: a spreadsheet range means "these cells, where
 * they are", so anything that reshuffles the page (a query, a sort, a page
 * change, a reorder) drops it rather than dragging a stale rectangle along.
 * The rule lives in `KEEPS_RANGE` in state.ts.
 *
 * Checkbox row selection is the opposite: keyed by id and kept across paging.
 * The two are independent and can be live at the same time.
 */
import { EN, type Strings } from './i18n'
import { type ColumnKey, type DataTableRecord } from './types'

/** A cell, addressed by its position on the page. */
export interface CellRef {
  row: number
  col: number
}

/** Where the drag or the keyboard extension started, and where it is now. */
export interface CellRange {
  anchor: CellRef
  focus: CellRef
}

/** The same range, normalised to inclusive bounds. */
export interface RangeRect {
  top: number
  left: number
  bottom: number
  right: number
}

export function rangeRect(range: CellRange): RangeRect {
  const { anchor, focus } = range
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  }
}

/**
 * Trim a rectangle to a grid that may have shrunk under it — a controlled host
 * can drop records without any action passing through the reducer.
 */
export function clampRect(rect: RangeRect, rows: number, cols: number): RangeRect | null {
  if (rows <= 0 || cols <= 0) return null
  if (rect.top >= rows || rect.left >= cols) return null
  return {
    top: Math.max(0, rect.top),
    left: Math.max(0, rect.left),
    bottom: Math.min(rows - 1, rect.bottom),
    right: Math.min(cols - 1, rect.right),
  }
}

export function rangeSize(rect: RangeRect) {
  const rows = rect.bottom - rect.top + 1
  const cols = rect.right - rect.left + 1
  return { rows, cols, cells: rows * cols }
}

/** What the live region says when a range changes or is copied. */
export function describeRange(
  rect: RangeRect,
  cols: ColumnKey[],
  rowCount: number,
  t: Strings = EN,
): string {
  const size = rangeSize(rect)
  if (size.cells === 1) {
    return t.cellSelected(t.columns[cols[rect.left]], rect.top + 1, rowCount)
  }
  return t.rangeSelected(size.rows, size.cols, size.cells)
}

/**
 * PORT ADDITION: what the live region says when a whole column is taken.
 *
 * Deliberately not measured the way `describeRange` measures a rectangle. A
 * rectangle is "3 rows by 2 columns" because it is a shape on the page; a
 * column is one count — every row the filters left — and the page total beside
 * it is the part worth saying out loud, since the cells being announced are
 * mostly ones the reader cannot see.
 */
export function describeWholeColumn(
  key: ColumnKey,
  cells: number,
  pages: number,
  t: Strings = EN,
): string {
  return t.columnSelected(t.columns[key], cells, pages)
}

const cellValue = (record: DataTableRecord, key: ColumnKey) => String(record[key] ?? '')

/**
 * Excel's own quoting rule: a value carrying a tab, a newline or a double quote
 * is wrapped in quotes with its quotes doubled. None of the demo data needs it,
 * real data will.
 */
function tsvCell(value: string): string {
  if (!/["\t\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Tab-separated, one line per row — what a spreadsheet reads as cells. */
export function rangeText(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
): string {
  const lines: string[] = []
  for (let r = rect.top; r <= rect.bottom; r += 1) {
    const record = rows[r]
    if (!record) continue
    const cells: string[] = []
    for (let c = rect.left; c <= rect.right; c += 1) {
      cells.push(tsvCell(cellValue(record, cols[c])))
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/**
 * The `text/html` flavour of the same rectangle. Sheets and Excel both prefer
 * it over the plain text when it is on the clipboard, and it survives a paste
 * into a rich-text editor as a real table.
 */
export function rangeHtml(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
): string {
  const body: string[] = []
  for (let r = rect.top; r <= rect.bottom; r += 1) {
    const record = rows[r]
    if (!record) continue
    const cells: string[] = []
    for (let c = rect.left; c <= rect.right; c += 1) {
      cells.push(`<td>${escapeHtml(cellValue(record, cols[c]))}</td>`)
    }
    body.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table><tbody>${body.join('')}</tbody></table>`
}

/* ---- the sum readout --------------------------------------------- */

export interface RangeSum {
  /** Already rounded to `decimals`, so no float noise reaches the screen. */
  total: number
  /** How many cells went into it — blanks are not among them. */
  count: number
  decimals: number
}

/**
 * The sum of the rectangle, or `null` when it does not have one.
 *
 * A cell that is not a number rules the whole selection out — the point is to
 * answer "what do these add up to", and a column of names has no answer. Blank
 * cells are skipped rather than counted as zero, the way a spreadsheet skips
 * them, and one lone number is not a sum worth floating a panel for.
 */
export function rangeSum(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
): RangeSum | null {
  let total = 0
  let count = 0
  let decimals = 0

  for (let r = rect.top; r <= rect.bottom; r += 1) {
    const record = rows[r]
    if (!record) continue
    for (let c = rect.left; c <= rect.right; c += 1) {
      const raw = cellValue(record, cols[c]).trim()
      if (!raw) continue

      const value = Number(raw)
      if (!Number.isFinite(value)) return null

      total += value
      count += 1
      const point = raw.indexOf('.')
      if (point >= 0) decimals = Math.max(decimals, raw.length - point - 1)
    }
  }

  if (count < 2) return null
  decimals = Math.min(decimals, 6)
  // 0.1 + 0.2 is 0.30000000000000004 until it is put back to one decimal
  return { total: Number(total.toFixed(decimals)), count, decimals }
}

/**
 * Grouped in the reader's locale, and never with more decimals than went in.
 *
 * The tag is the table's own language when one is passed — the switch beside the
 * title is what a reader has to go on, so a table set to TÜRKÇE has to point its
 * decimals the Turkish way whatever the machine underneath it is set to.
 * Omitted, it falls back to the host's locale, which is what this always did.
 */
export function formatSum({ total, decimals }: RangeSum, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(total)
}

/**
 * Three routes to the clipboard, in descending order of fidelity: the async API
 * with both flavours, the async API with text only, and the old
 * selection + `execCommand` dance for insecure contexts (a plain `http://`
 * intranet host, where `navigator.clipboard` is not exposed at all).
 */
export async function writeClipboard(text: string, html: string): Promise<boolean> {
  const clipboard = navigator?.clipboard

  if (clipboard?.write && typeof ClipboardItem === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return true
    } catch {
      // a browser that refuses the two-flavour write still takes plain text
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }

  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const doc = document
  if (typeof doc.execCommand !== 'function') return false

  const area = doc.createElement('textarea')
  area.value = text
  // off-screen but still selectable; `display: none` would not be
  area.setAttribute('aria-hidden', 'true')
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
  doc.body.appendChild(area)

  const previous = doc.activeElement as HTMLElement | null
  area.select()
  let ok = false
  try {
    ok = doc.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  previous?.focus?.()
  return ok
}

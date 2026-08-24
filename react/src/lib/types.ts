/**
 * Public types for the Data table component.
 *
 * Ported from the `data-table.html` prototype in this repo; the written spec
 * lives in `design_handoff_data_table/README.md`.
 */
import type { CSSProperties, ReactNode } from 'react'

import type { Locale } from './i18n'
import type { MetricPrefs, MetricPrefsSeed } from './metrics'

export type RecordStatus = 'Success' | 'In progress' | 'Failed'

/** The six reorderable data columns. The grip, select and action columns are fixed. */
export type ColumnKey = 'name' | 'date' | 'status' | 'solvedCases' | 'favouriteSeason' | 'address'

/**
 * PORT ADDITION: a second enum column beside `status`. It exists so the filter
 * dock has two enum chips to combine — one enum column cannot demonstrate an AND.
 */
export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter'

export const SEASONS: Season[] = ['Spring', 'Summer', 'Autumn', 'Winter']

export interface DataTableRecord {
  id: string
  name: string
  date: string
  status: RecordStatus
  /** Held as a string like every other field; the sum readout parses it. */
  solvedCases: string
  favouriteSeason: Season
  address: string
  /**
   * Detail-pane fields. `email` used to be a column; it moved down here when
   * `favouriteSeason` took its slot, but the toolbar search still reads it.
   */
  email: string
  owner: string
  activity: string
  plan: string
  note: string
}

/** The unsaved new record pinned above the page rows. It has no id yet. */
export type DraftRecord = Pick<
  DataTableRecord,
  'name' | 'date' | 'status' | 'solvedCases' | 'favouriteSeason' | 'address'
>

export type SortState = { key: ColumnKey; dir: 'asc' | 'desc' } | null

/**
 * `'auto'`  — honour the OS `prefers-reduced-motion` setting (default).
 * `'always'` — animate regardless, the way the prototype does when presenting.
 * `'never'`  — no motion.
 */
export type MotionPreference = 'auto' | 'always' | 'never'

export interface DataTableProps {
  /** Controlled record list. Omit to let the component own its records. */
  records?: DataTableRecord[]
  /** Initial records when uncontrolled. Defaults to the bundled demo set. */
  defaultRecords?: DataTableRecord[]
  /** Called with the next list whenever a record is added, edited, deleted or reordered. */
  onRecordsChange?: (next: DataTableRecord[]) => void

  /** Initial column order. Defaults to name, date, status, solvedCases, favouriteSeason, address. */
  columns?: ColumnKey[]

  /** Drives the header bar, primary button, active filter/page, selection rules. */
  accentColor?: string
  density?: 'comfortable' | 'compact'
  /**
   * The page size the table opens on. The toolbar's slider owns it after that
   * — pass `onRowsPerPageChange` to follow it.
   */
  rowsPerPage?: number
  onRowsPerPageChange?: (rows: number) => void
  /**
   * What each *kind* of cell content should read as in the flow block: the
   * metrics for numbers, the metrics for each enum column's values. Which set a
   * given cell selection uses is not set here and is not settable — the
   * rectangle decides, by what is in it. Drag across counts and the block reads
   * the `number` metrics; drag across statuses and the same block reads the
   * `status` ones.
   *
   * A category takes a list, and the block prints every metric in it:
   * `{ number: ['sum', 'mean', 'highest'] }` reads a run of counts three ways at
   * once, in the order the cog's panel lists them rather than the order they are
   * written here. A bare key is the shorthand for a list of one, so
   * `{ number: 'mean' }` still means what it always did.
   *
   * Partial, and merged over the defaults (Sum, Success rate, Spring rate), so
   * a host that only cares about one category names only that one. Read once,
   * like `rowsPerPage`: the toolbar's metric cog owns the record after that and
   * reports every change through `onMetricsChange`.
   *
   * A preference that names no metric is dropped and the default kept — the
   * rate keys are a template literal type, so `'rate:nonsense'` type-checks —
   * and so is a real metric filed under the wrong category, since
   * `{ status: 'mean' }` is not a question a rectangle of statuses can answer.
   * A category left with nothing valid in it, `[]` included, keeps its default:
   * there is no such thing as a kind of cell that reads as nothing.
   */
  metrics?: MetricPrefsSeed
  /** The whole record after a change, not just the category that moved. */
  onMetricsChange?: (prefs: MetricPrefs) => void
  zebraRows?: boolean

  /**
   * The language the chrome is in. Controlled when passed — the switch beside
   * the title then only *reports* a press through `onLocaleChange`, and nothing
   * moves until the host sends the next value back, exactly as `records` works.
   * Omit it to let the component own the choice and seed it with
   * `defaultLocale`.
   *
   * It never touches the records. A status is the string `'Success'` in every
   * language and a date keeps the format it was stored in — what changes is how
   * they read on screen. See `i18n.ts` for where that line is drawn.
   */
  locale?: Locale
  /** The language to open in when uncontrolled. Defaults to English. */
  defaultLocale?: Locale
  /** Fired by the switch, with the language pressed. */
  onLocaleChange?: (locale: Locale) => void
  /** Hides the switch beside the title without taking the header away. */
  showLanguageSwitch?: boolean

  /**
   * Defaults to the current language's own word for it — "Data table" in
   * English, "Veri Tablosu" in Turkish — so a host that does not name the
   * screen gets one that follows the switch. A host that *does* name it owns
   * the string in every language, which is the right trade: nothing here can
   * translate a title it has never seen.
   */
  title?: string
  kicker?: string
  showHeader?: boolean
  /** `null` hides the logo cell's image. Defaults to the bundled ALP mark. */
  logoSrc?: string | null

  motion?: MotionPreference

  /**
   * Excel-style cell-range selection: drag across cells, Shift+click or
   * Shift+arrow to extend, Ctrl/Cmd+C to copy the rectangle as TSV.
   * Turning it off restores plain text selection inside the cells.
   */
  cellSelection?: boolean

  /**
   * Fired when an export is **saved**, not when Export is pressed: the press
   * only starts the bar, and the file does not exist until the name box is
   * confirmed. The component writes the `.csv` itself — this is a notification,
   * so a host that wants to log the export or mark the records exported can,
   * without having to reimplement the download.
   *
   * The records are the ones the exported cells came from, top to bottom. For a
   * cell rectangle or a whole column that is *more* than the file holds: the
   * file has the selected columns, this has the whole record behind each row.
   */
  onExport?: (exported: DataTableRecord[]) => void
  onSelectionChange?: (ids: string[]) => void
  /** Fired by the pencil when a row is armed for editing. */
  onEditRecord?: (record: DataTableRecord) => void

  className?: string
  style?: CSSProperties
  /** Slot rendered between the toolbar and the table. */
  children?: ReactNode
}

export const DEFAULT_COLUMNS: ColumnKey[] = [
  'name',
  'date',
  'status',
  'solvedCases',
  'favouriteSeason',
  'address',
]

/**
 * The English labels, and the stable ones. This is what a host reads a column
 * back as and what a `.csv` header falls back to; the words the table actually
 * *renders* come from the language in force — `Strings.columns` in `i18n.ts`,
 * which declares the same record type so a new column cannot be added here
 * without every language naming it.
 */
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: 'Name',
  date: 'Date',
  status: 'Status',
  solvedCases: 'Solved cases',
  favouriteSeason: 'Favourite season',
  address: 'Address',
}

export const COLUMN_WIDTHS: Record<ColumnKey, string> = {
  name: '200px',
  date: '140px',
  status: '140px',
  solvedCases: '150px',
  // Wider than the longest season by some margin: the cell is uppercased value
  // text at .12em tracking, and "Favourite season" is the widest header label.
  favouriteSeason: '170px',
  address: '300px',
}

export const STATUSES: RecordStatus[] = ['Success', 'In progress', 'Failed']

export const PILL_CLASS: Record<RecordStatus, string> = {
  Success: 'dt-success',
  'In progress': 'dt-progress',
  Failed: 'dt-failed',
}

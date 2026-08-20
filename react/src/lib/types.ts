/**
 * Public types for the Data table component.
 *
 * Ported from the `data-table.html` prototype in this repo; the written spec
 * lives in `design_handoff_data_table/README.md`.
 */
import type { CSSProperties, ReactNode } from 'react'

import type { MetricPrefs } from './metrics'

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
   * What each *kind* of cell content should read as in the flow block: a metric
   * for numbers, one for each enum column's values. Which of them a given cell
   * selection uses is not set here and is not settable — the rectangle decides,
   * by what is in it. Drag across counts and the block reads the `number`
   * preference; drag across statuses and the same block reads the `status` one.
   *
   * Partial, and merged over the defaults (Sum, Success rate, Spring rate), so
   * a host that only cares about one category names only that one. Read once,
   * like `rowsPerPage`: the toolbar's **Show** selector owns the record after
   * that and reports every change through `onMetricsChange`.
   *
   * A preference that names no metric is dropped and the default kept — the
   * rate keys are a template literal type, so `'rate:nonsense'` type-checks —
   * and so is a real metric filed under the wrong category, since
   * `{ status: 'mean' }` is not a question a rectangle of statuses can answer.
   */
  metrics?: Partial<MetricPrefs>
  /** The whole record after a change, not just the preference that moved. */
  onMetricsChange?: (prefs: MetricPrefs) => void
  zebraRows?: boolean

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

  onExport?: (selected: DataTableRecord[]) => void
  onArchive?: (selected: DataTableRecord[]) => void
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

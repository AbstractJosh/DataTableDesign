/**
 * Public types for the Data table component.
 *
 * Ported from the `data-table.html` prototype in this repo; the written spec
 * lives in `design_handoff_data_table/README.md`.
 */
import type { CSSProperties, ReactNode } from 'react'

export type RecordStatus = 'Success' | 'In progress' | 'Failed'

/** The six reorderable data columns. The grip, select and action columns are fixed. */
export type ColumnKey = 'name' | 'date' | 'status' | 'mobile' | 'email' | 'address'

export type StatusFilter = 'All' | RecordStatus

export interface DataTableRecord {
  id: string
  name: string
  date: string
  status: RecordStatus
  mobile: string
  email: string
  address: string
  /** Detail-pane fields. */
  owner: string
  activity: string
  plan: string
  note: string
}

/** The unsaved new record pinned above the page rows. It has no id yet. */
export type DraftRecord = Pick<
  DataTableRecord,
  'name' | 'date' | 'status' | 'mobile' | 'email' | 'address'
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

  /** Initial column order. Defaults to name, date, status, mobile, email, address. */
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
  'mobile',
  'email',
  'address',
]

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: 'Name',
  date: 'Date',
  status: 'Status',
  mobile: 'Mobile no',
  email: 'Email ID',
  address: 'Address',
}

export const COLUMN_WIDTHS: Record<ColumnKey, string> = {
  name: '200px',
  date: '140px',
  status: '140px',
  mobile: '170px',
  email: '210px',
  address: '300px',
}

export const STATUS_FILTERS: StatusFilter[] = ['All', 'Success', 'In progress', 'Failed']

export const STATUSES: RecordStatus[] = ['Success', 'In progress', 'Failed']

export const PILL_CLASS: Record<RecordStatus, string> = {
  Success: 'dt-success',
  'In progress': 'dt-progress',
  Failed: 'dt-failed',
}

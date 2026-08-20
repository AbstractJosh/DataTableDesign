export { DataTable, default } from './lib/DataTable'
export { createDemoRecords, DEMO_RECORDS } from './lib/demoData'
export { ALP_LOGO_DATA_URI } from './lib/logo'
export type { CellRange, CellRef, RangeRect } from './lib/cellRange'
export {
  COLUMN_LABELS,
  COLUMN_WIDTHS,
  DEFAULT_COLUMNS,
  SEASONS,
  STATUSES,
  type ColumnKey,
  type DataTableProps,
  type DataTableRecord,
  type DraftRecord,
  type MotionPreference,
  type RecordStatus,
  type Season,
  type SortState,
} from './lib/types'
/**
 * The filter dock's engine. A host that wants to seed or read the dock's
 * conditions needs the op tables to build one, and `matchesAll` to apply the
 * same rules to its own copy of the records.
 */
export {
  COLUMN_TYPES,
  ENUM_OPTIONS,
  OPS_FOR_TYPE,
  OP_LABELS,
  matchesAll,
  type ColumnType,
  type FilterCondition,
  type FilterOp,
} from './lib/filters'

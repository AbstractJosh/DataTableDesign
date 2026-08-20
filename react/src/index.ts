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
 * The flow block's metrics — the whole kit for the `metrics` prop, since a host
 * that stores preferences between visits has to be able to build, validate and
 * name them without the component mounted. `normaliseMetricPrefs` is the guard
 * that runs on the way in, so a host can put its own storage through it first;
 * `setMetricPref` files a key under its own category; `metricFor` reads one back
 * out; the grouped list and the labels are for a host offering its own control
 * over the same choice.
 *
 * `rangeMetric`, `rangeCategory` and `metricInForce` stay internal. They answer
 * questions about a cell rectangle, and the rectangle is a view-level thing the
 * host is never handed — there is nothing it could pass them.
 */
export {
  DEFAULT_METRIC_PREFS,
  METRIC_CATEGORIES,
  METRIC_GROUPS,
  METRIC_LIST,
  NUMERIC_METRICS,
  isMetricKey,
  metricCategory,
  metricFor,
  metricLabel,
  normaliseMetricPrefs,
  parseRateMetric,
  rateMetricKey,
  setMetricPref,
  type MetricCategory,
  type MetricGroup,
  type MetricKey,
  type MetricOption,
  type MetricPrefs,
  type NumericMetricKey,
  type RateMetric,
  type RateMetricKey,
} from './lib/metrics'
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

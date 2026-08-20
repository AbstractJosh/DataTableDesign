/**
 * PORT ADDITION: the metrics behind the toolbar's flow block.
 *
 * The prototype has no readout at all. The port grew one for the cell range —
 * `rangeSum` in cellRange.ts, which answers one question, "what do these add up
 * to" — and this file is that readout generalised: the rectangle is still the
 * only trigger, but *what it is asked for* now follows what is in it.
 *
 * The toolbar's selector does not pick the metric. It holds a **preference per
 * category** — one kind of cell content each: numbers, Status values, Favourite
 * season values — set once and left alone. Which of those preferences answers
 * is decided by the selection: the rectangle's cells are read, their category
 * is worked out from their *values*, and that category's preference is what the
 * block shows. Drag across counts and it reads Sum; drag across statuses and
 * the same block reads Success rate, with nothing to set in between. There is
 * no longer such a thing as a rectangle of the wrong kind for the chosen
 * metric.
 *
 * Reading the category off the values rather than off the columns the rectangle
 * happens to cover is what keeps the rule identical to the one the sum already
 * used — "a column of names has no answer" — and what keeps it true when a host
 * swaps the column set out from under it.
 *
 * Two rules run through everything here, and both are inherited from the sum:
 *
 * - **A rectangle with no category returns `null`**, and the panel then stays
 *   away rather than showing a number that means nothing. Names, dates, and any
 *   rectangle that mixes two categories fall here — half numbers and half
 *   statuses is not a question with an answer. `null` is the only signal a
 *   caller needs; it is what the panel's fade-out already keys off.
 * - **Blank cells are skipped, never counted as zero**, the way a spreadsheet
 *   skips them, and one lone cell is never floated as a statistic: every
 *   category wants at least two before it is anything at all.
 *
 * Nothing here touches React or the DOM. It takes the page's rows, the column
 * order and the rectangle, and hands back strings that are ready to render.
 */
import { formatSum, type RangeRect } from './cellRange'
import { ENUM_OPTIONS } from './filters'
import {
  COLUMN_LABELS,
  DEFAULT_COLUMNS,
  type ColumnKey,
  type DataTableRecord,
} from './types'

/* ---- the metric keys ----------------------------------------------- */

/** The six that read the rectangle as numbers. */
export type NumericMetricKey = 'sum' | 'product' | 'mean' | 'median' | 'highest' | 'lowest'

/**
 * One per option of each enum column, as `rate:<column>:<option>` —
 * `rate:status:In progress`, `rate:favouriteSeason:Spring`.
 *
 * Deliberately typed loosely rather than spelled out as a union of every
 * column/option pair: the options come from `ENUM_OPTIONS`, so writing the
 * union here would be a second copy of that table to keep in step. What guards
 * a bad key instead is `parseRateMetric`, which validates it against
 * `ENUM_OPTIONS` at the point of use and answers `null` for anything it does
 * not recognise — including a key that arrives from a host prop.
 */
export type RateMetricKey = `rate:${string}`

export type MetricKey = NumericMetricKey | RateMetricKey

/** The order the selector lists the numeric group in; the first is its default. */
export const NUMERIC_METRICS: NumericMetricKey[] = [
  'sum',
  'product',
  'mean',
  'median',
  'highest',
  'lowest',
]

/** Sentence case: the panel's tag uppercases it, the live region does not. */
const NUMERIC_LABELS: Record<NumericMetricKey, string> = {
  sum: 'Sum',
  product: 'Product',
  mean: 'Mean',
  median: 'Median',
  highest: 'Highest',
  lowest: 'Lowest',
}

const isNumericMetric = (key: string): key is NumericMetricKey =>
  (NUMERIC_METRICS as readonly string[]).includes(key)

/** `Success` → `Success rate`. The column name is the group heading above it. */
const rateLabel = (option: string) => `${option} rate`

export const rateMetricKey = (column: ColumnKey, option: string): RateMetricKey =>
  `rate:${column}:${option}`

export interface RateMetric {
  column: ColumnKey
  /** The option whose share is being asked for. */
  option: string
  /** Every option of that column — the domain the rectangle has to fall inside. */
  options: readonly string[]
}

/**
 * A rate key back into the column and option it names, or `null` when it names
 * neither. An option may itself hold a colon one day, so only the first
 * separator after the prefix is significant.
 */
export function parseRateMetric(metric: string): RateMetric | null {
  if (!metric.startsWith('rate:')) return null

  const rest = metric.slice('rate:'.length)
  const split = rest.indexOf(':')
  if (split < 0) return null

  const column = rest.slice(0, split) as ColumnKey
  const option = rest.slice(split + 1)
  const options = ENUM_OPTIONS[column]
  if (!options || !options.includes(option)) return null

  return { column, option, options }
}

export function isMetricKey(metric: string): metric is MetricKey {
  return isNumericMetric(metric) || parseRateMetric(metric) !== null
}

/* ---- the categories ------------------------------------------------- */

/**
 * A category is a *kind of cell content*, and it is the unit a preference is
 * kept in: `'number'`, plus one per enum column, named by that column's key.
 * Exactly one preference per category, and a rectangle belongs to at most one.
 *
 * One category per enum column rather than a single shared `'enum'` one:
 * "Success rate" is meaningless over a rectangle of seasons, so each enum
 * column has to carry its own pick.
 *
 * `ColumnKey` here is wider than the real set. The enum columns cannot be
 * narrowed at the type level — `ENUM_OPTIONS` is a partial record, so every
 * column key is in its `keyof` — and hand-writing `'status' | 'favouriteSeason'`
 * would be the second copy of that table this file has always refused to keep.
 * `METRIC_CATEGORIES` is the real list and `metricCategory` the way in; `'name'`
 * is a category no cells ever detect as, no group ever offers and no preference
 * is ever stored under.
 */
export type MetricCategory = 'number' | ColumnKey

interface EnumCategory {
  column: ColumnKey
  options: readonly string[]
}

/**
 * The enum columns paired with their options, in the order the table lays them
 * out.
 *
 * Walks `DEFAULT_COLUMNS` rather than `Object.keys(ENUM_OPTIONS)` so the list is
 * ordered the way the table is (Status, then Favourite season) instead of by
 * however the filter table happens to be written — and so a third enum column
 * added there arrives with its category, its default, its group and its
 * detection rule already in place. This is the one derivation; everything below
 * is a use of it.
 */
const ENUM_CATEGORIES: EnumCategory[] = DEFAULT_COLUMNS.flatMap((column) => {
  const options = ENUM_OPTIONS[column]
  return options ? [{ column, options }] : []
})

/** Every category, numbers first — the domain of a `MetricPrefs`. */
export const METRIC_CATEGORIES: MetricCategory[] = [
  'number',
  ...ENUM_CATEGORIES.map((category) => category.column),
]

/**
 * Which category a metric sets the preference for — `'mean'` is the number
 * category's, `rate:status:Success` is Status's. The action that picks a metric
 * therefore does not need to carry its category; this is where that is worked
 * out, so it is worked out in one place.
 *
 * Total and quiet: anything that is not a metric at all answers `null` rather
 * than throwing or handing back an `undefined` for a caller to trip over. A key
 * can arrive from a host prop or out of storage, and "no category" is the
 * honest answer for it.
 */
export function metricCategory(metric: string): MetricCategory | null {
  if (isNumericMetric(metric)) return 'number'
  const rate = parseRateMetric(metric)
  return rate ? rate.column : null
}

/* ---- what the selector renders from -------------------------------- */

export interface MetricOption {
  key: MetricKey
  /** Sentence case, as the selector's button and the live region want it. */
  label: string
}

export interface MetricGroup {
  /** The category this section holds the preference for. One radio group each. */
  category: MetricCategory
  /** The heading over the group. Not selectable — see FilterMenu's groups. */
  label: string
  options: MetricOption[]
}

/** Numbers first, then one group per enum column — one section per category. */
export const METRIC_GROUPS: MetricGroup[] = [
  {
    category: 'number',
    label: 'Numbers',
    options: NUMERIC_METRICS.map((key) => ({ key, label: NUMERIC_LABELS[key] })),
  },
  ...ENUM_CATEGORIES.map(({ column, options }) => ({
    category: column,
    label: COLUMN_LABELS[column],
    options: options.map((option) => ({
      key: rateMetricKey(column, option),
      label: rateLabel(option),
    })),
  })),
]

/**
 * Every metric flattened, in group order. The selector's arrow keys stay inside
 * one group — each section is its own radio group — so this is not a navigation
 * order; it is the full domain, for a host rendering its own control or
 * checking a key it has stored.
 */
export const METRIC_LIST: MetricOption[] = METRIC_GROUPS.flatMap((group) => group.options)

export function metricLabel(metric: MetricKey): string {
  if (isNumericMetric(metric)) return NUMERIC_LABELS[metric]
  const rate = parseRateMetric(metric)
  return rate ? rateLabel(rate.option) : ''
}

/* ---- the preferences ------------------------------------------------ */

/**
 * What each category should read as: the whole of what the selector owns, and
 * what the host seeds with `metrics` and follows with `onMetricsChange`.
 *
 * Total over the real categories — `DEFAULT_METRIC_PREFS` seeds every one of
 * them and nothing here ever deletes a key — but written as a partial record
 * over `ColumnKey` because that is as narrow as the type system can be about
 * which columns are enums (see `MetricCategory`). Read it through `metricFor`,
 * which is total, rather than indexing it.
 */
export type MetricPrefs = Partial<Record<ColumnKey, RateMetricKey>> & {
  number: NumericMetricKey
}

/**
 * The first metric of each group: Sum for numbers, Success rate for Status,
 * Spring rate for Favourite season. Derived rather than written out, so a new
 * enum column defaults to its own first option without an edit here.
 */
function buildDefaults(): MetricPrefs {
  const prefs: MetricPrefs = { number: NUMERIC_METRICS[0] }
  for (const { column, options } of ENUM_CATEGORIES) {
    prefs[column] = rateMetricKey(column, options[0])
  }
  return prefs
}

export const DEFAULT_METRIC_PREFS: MetricPrefs = buildDefaults()

/**
 * The metric in force for one category. Total, which is why callers should
 * come through here instead of indexing the record: a section of the selector
 * needs a pick to draw as current even if a host handed over a record missing
 * that key.
 */
export function metricFor(prefs: MetricPrefs, category: MetricCategory): MetricKey {
  // The last arm is the type system's problem rather than the data's:
  // `MetricCategory` admits every `ColumnKey`, so `'name'` type-checks as a
  // category, and every category that can actually be detected is in the
  // defaults.
  return prefs[category] ?? DEFAULT_METRIC_PREFS[category] ?? NUMERIC_METRICS[0]
}

/**
 * The record with one preference changed — the category being whichever one
 * `metric` belongs to.
 *
 * Returns the record it was given when nothing moves, so the reducer can lean
 * on identity to skip a render, and so a key that names no metric quietly
 * changes nothing: the preference a key does not name is not one it should be
 * allowed to overwrite.
 */
export function setMetricPref(prefs: MetricPrefs, metric: string): MetricPrefs {
  if (isNumericMetric(metric)) {
    return prefs.number === metric ? prefs : { ...prefs, number: metric }
  }

  const rate = parseRateMetric(metric)
  if (!rate) return prefs

  // Rebuilt from the parse rather than reused: it is the canonical spelling of
  // the key, and it is a `RateMetricKey` without a cast.
  const key = rateMetricKey(rate.column, rate.option)
  if (prefs[rate.column] === key) return prefs

  const next: MetricPrefs = { ...prefs }
  next[rate.column] = key
  return next
}

/**
 * A host's `metrics` prop merged over the defaults.
 *
 * Anything that is not a real metric for the category it is filed under is
 * dropped and the default kept — an unknown category, a metric that names
 * nothing, and `{ status: 'mean' }`, which is a real metric on the wrong shelf.
 * One comparison covers all three, because `metricCategory` names the only
 * shelf a metric may sit on. The reasoning is the `metric` prop's from before
 * the selector was a preferences panel: a typo in a host's props should leave
 * the block reading something rather than reading blank, or reading a mean over
 * a rectangle of statuses.
 */
export function normaliseMetricPrefs(seed?: Partial<MetricPrefs> | null): MetricPrefs {
  let prefs: MetricPrefs = { ...DEFAULT_METRIC_PREFS }
  if (!seed) return prefs

  for (const [category, metric] of Object.entries(seed)) {
    if (typeof metric !== 'string') continue
    if (metricCategory(metric) !== category) continue
    prefs = setMetricPref(prefs, metric)
  }
  return prefs
}

/* ---- the answer ----------------------------------------------------- */

export interface MetricResult {
  /** Which metric this answers — a caller holding a fading copy needs to know. */
  metric: MetricKey
  /** The panel's tag, already upper case: `SUM`, `SUCCESS RATE`. */
  tag: string
  /** The formatted value: `177`, `62.5%`. */
  value: string
  /**
   * A rate's `5 of 8`, and `null` for every numeric metric. Bare: the
   * parentheses the design draws around it belong to the panel, not to the
   * number, so the muted element can supply them.
   */
  note: string | null
  /**
   * What the live region should say. Sentence case, not the tag's upper case —
   * a screen reader spells `SUM` out letter by letter. The caller supplies the
   * full stop, as it already does for the sum.
   */
  speech: string
}

/** The value and the note, before they are dressed as a `MetricResult`. */
interface Answer {
  value: string
  note: string | null
}

/**
 * Two is the floor everywhere, not just for the sum: "the mean of one number"
 * and "100% of one cell" are as unhelpful as "the total of one cell", and the
 * panel appearing on a single click would be noise. A single cell has no
 * category at all, so this is also the floor on the detection.
 */
const MIN_CELLS = 2

/**
 * The same ceiling `rangeSum` puts on the decimals it will show. Past six
 * places the digits are the float's, not the data's.
 */
const DECIMAL_CAP = 6

/**
 * Where a product stops being a number and becomes a wall. Past 2^53 the
 * trailing digits are float noise anyway, so the exponent form is the more
 * honest readout as well as the one that fits the toolbar.
 */
const PRODUCT_LIMIT = 1e15

/**
 * And where it stops being a number the other way. A product smaller than the
 * last place the readout will show rounds flat to `0` — a reading no one can
 * tell from a rectangle that really does contain a zero, and a wrong one. So
 * the small end folds into the same exponent form the large end does: out of
 * the readable band is out of the readable band, whichever side it left by.
 */
const PRODUCT_FLOOR = 10 ** -DECIMAL_CAP

const number = (value: number, min: number, max: number) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value)

/** Every non-blank cell of the rectangle, trimmed, in reading order. */
function rangeCells(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
): string[] {
  const cells: string[] = []
  for (let r = rect.top; r <= rect.bottom; r += 1) {
    const record = rows[r]
    if (!record) continue
    for (let c = rect.left; c <= rect.right; c += 1) {
      const raw = String(record[cols[c]] ?? '').trim()
      if (raw) cells.push(raw)
    }
  }
  return cells
}

/**
 * What kind of thing the cells are, or `null` for no kind at all.
 *
 * Numbers are tried first — no enum option parses as one, so the order only
 * decides which of two overlapping option sets would win, and the table order
 * is the least surprising tie-break. Every cell has to agree: one status among
 * the counts, or one season among the statuses, and the rectangle is a mixture,
 * which is exactly the case the panel has always stayed away from.
 */
function detect(cells: string[]): MetricCategory | null {
  if (cells.length < MIN_CELLS) return null

  if (cells.every((cell) => Number.isFinite(Number(cell)))) return 'number'

  for (const { column, options } of ENUM_CATEGORIES) {
    if (cells.every((cell) => options.includes(cell))) return column
  }
  return null
}

/**
 * The category of the rectangle itself — which preference is in force over it,
 * and `null` when none is.
 *
 * Not how the component asks. `DataTable` needs the category to mark the
 * selector's section, but it has already read the rectangle by then, so it
 * takes `metricCategory(reading.metric)` off the answer it holds: one scan of
 * the cells instead of two, and no way for the mark and the number to disagree.
 * This is the detection on its own, and it is here so the unit tests can state
 * "these cells are numbers, those cells are nothing" directly instead of
 * inferring it from a metric that came back. Not in the package's exports for
 * the same reason `rangeMetric` is not: a host is never handed a rectangle.
 */
export function rangeCategory(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
): MetricCategory | null {
  return detect(rangeCells(rows, cols, rect))
}

interface NumberScan {
  values: number[]
  /** The most decimal places any one cell carried — the sum's own rule. */
  decimals: number
  /** All of them added up: what a product of those cells can legitimately show. */
  productDecimals: number
}

/**
 * The cells as numbers, or `null` when they are not all numbers. One text cell
 * rules the whole rectangle out, exactly as it does for the sum — the detection
 * has already said as much, and this stays self-contained rather than trusting
 * it.
 */
function scanNumbers(cells: string[]): NumberScan | null {
  const values: number[] = []
  let decimals = 0
  let productDecimals = 0

  for (const raw of cells) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    values.push(value)

    const point = raw.indexOf('.')
    if (point >= 0) {
      const places = raw.length - point - 1
      decimals = Math.max(decimals, places)
      productDecimals += places
    }
  }

  if (values.length < MIN_CELLS) return null
  return {
    values,
    decimals: Math.min(decimals, DECIMAL_CAP),
    productDecimals: Math.min(productDecimals, DECIMAL_CAP),
  }
}

/**
 * A mean or a median is a *derived* number, not one of the cells, so it is
 * allowed two places past what the data carried — otherwise the mean of two
 * integers could never say `.5`. Trailing zeros are dropped: nothing about the
 * input asks for them here.
 */
const derived = (value: number, decimals: number) =>
  number(value, 0, Math.min(decimals + 2, DECIMAL_CAP))

function numericAnswer(cells: string[], metric: NumericMetricKey): Answer | null {
  const scan = scanNumbers(cells)
  if (!scan) return null
  const { values, decimals } = scan

  switch (metric) {
    case 'sum': {
      let total = 0
      for (const value of values) total += value
      // Routed through the sum's own formatter rather than reimplemented, so
      // the default metric reads byte for byte the way it did before the
      // selector existed. 0.1 + 0.2 is 0.30000000000000004 until it is put
      // back to the one decimal that went in.
      return {
        value: formatSum({
          total: Number(total.toFixed(decimals)),
          count: values.length,
          decimals,
        }),
        note: null,
      }
    }

    case 'product': {
      let product = 1
      for (const value of values) product *= value
      // A product big enough to overflow the double has no readout at all.
      if (!Number.isFinite(product)) return null

      // Zero is not "too small": it is exact, and `0` is the true reading of a
      // rectangle with a zero in it. Everything else outside the band goes to
      // the exponent, big end and small end alike.
      const size = Math.abs(product)
      if (size > PRODUCT_LIMIT || (size > 0 && size < PRODUCT_FLOOR)) {
        return {
          value: new Intl.NumberFormat(undefined, {
            notation: 'scientific',
            maximumFractionDigits: 3,
          }).format(product),
          note: null,
        }
      }

      // Multiplying two 2-decimal cells legitimately produces four places, so
      // the product's own budget is the cells' places added, not their widest.
      const places = scan.productDecimals
      // `|| 0` is about the *signed* zero: `Intl` spells `-0` with its minus,
      // which is not a reading any rule here asks for. The floor above is what
      // keeps a small negative product from rounding down to one in the first
      // place, and this keeps that true if the cap ever moves.
      return { value: number(Number(product.toFixed(places)) || 0, 0, places), note: null }
    }

    case 'mean': {
      let total = 0
      for (const value of values) total += value
      return { value: derived(total / values.length, decimals), note: null }
    }

    case 'median': {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      const median =
        sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      return { value: derived(median, decimals), note: null }
    }

    case 'highest':
    case 'lowest': {
      // A loop rather than `Math.max(...values)`: a rectangle over a long page
      // is thousands of cells, and spreading that many arguments blows the
      // call stack.
      let found = values[0]
      for (const value of values) {
        if (metric === 'highest' ? value > found : value < found) found = value
      }
      // Shown the way the cells were: never more places than went in, and the
      // same number of them, so a column formatted to two decimals stays so.
      return { value: number(found, decimals, decimals), note: null }
    }
  }
}

/**
 * The share of the rectangle reading `rate.option`.
 *
 * The domain check is the detection's again, kept here so the arithmetic cannot
 * be handed cells it does not belong to: a rectangle over Status cannot answer
 * "Spring rate". Matching is exact, as the enum filter's is — these are
 * canonical values, not typed operands.
 */
function rateAnswer(cells: string[], rate: RateMetric): Answer | null {
  if (cells.length < MIN_CELLS) return null

  let hits = 0
  for (const raw of cells) {
    if (!rate.options.includes(raw)) return null
    if (raw === rate.option) hits += 1
  }

  const percent = new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(hits / cells.length)

  return { value: percent, note: `${number(hits, 0, 0)} of ${number(cells.length, 0, 0)}` }
}

/**
 * What the rectangle says, under the preference for whatever kind of thing it
 * turns out to hold — or `null` when it holds no one kind, which is the panel's
 * cue to stay away (or fade out).
 */
export function rangeMetric(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
  prefs: MetricPrefs = DEFAULT_METRIC_PREFS,
): MetricResult | null {
  const cells = rangeCells(rows, cols, rect)
  const category = detect(cells)
  if (!category) return null

  const metric = metricFor(prefs, category)

  if (category === 'number') {
    // Unreachable through `normaliseMetricPrefs`, which files every preference
    // under its own category; a hand-built record from a host can still say
    // otherwise, and a missing panel is the right way to answer "not that".
    if (!isNumericMetric(metric)) return null
    const answer = numericAnswer(cells, metric)
    return answer && dress(metric, NUMERIC_LABELS[metric], answer)
  }

  const rate = parseRateMetric(metric)
  if (!rate || rate.column !== category) return null

  const answer = rateAnswer(cells, rate)
  return answer && dress(metric, rateLabel(rate.option), answer)
}

/**
 * The metric the selector's button should name: the one the block is displaying,
 * and the number preference when the block is displaying nothing. The button
 * tracks the selection, so what it reads has to come from the same answer the
 * block does rather than from a second guess at the rectangle.
 */
export function metricInForce(prefs: MetricPrefs, result: MetricResult | null): MetricKey {
  return result ? result.metric : metricFor(prefs, 'number')
}

function dress(metric: MetricKey, label: string, answer: Answer): MetricResult {
  return {
    metric,
    tag: label.toUpperCase(),
    value: answer.value,
    note: answer.note,
    speech: `${label} ${answer.value}`,
  }
}

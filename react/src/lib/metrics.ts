/**
 * PORT ADDITION: the metrics behind the toolbar's flow block.
 *
 * The prototype has no readout at all. The port grew one for the cell range —
 * `rangeSum` in cellRange.ts, which answers one question, "what do these add up
 * to" — and this file is that readout generalised: the rectangle is still the
 * only trigger, but *what it is asked for* now follows what is in it.
 *
 * The toolbar's selector does not pick the metric. It holds a **set of
 * preferences per category** — one kind of cell content each: numbers, Status
 * values, Favourite season values — set once and left alone. Which of those
 * sets answers is decided by the selection: the rectangle's cells are read,
 * their category is worked out from their *values*, and that category's set is
 * what the block shows — all of it, one reading per metric. Ask numbers for a
 * sum, a mean and a highest and a run of counts prints all three; drag one
 * column left onto statuses and the same block prints whichever rates Status
 * holds, with nothing to set in between. There is no longer such a thing as a
 * rectangle of the wrong kind for the chosen metric.
 *
 * A category holds at least one metric and never none. The floor is what keeps
 * the thing this file is built on — a rectangle with a category has an answer
 * — from growing a second way to fail: "nothing switched on" would look, on
 * screen, exactly like "these cells are not one kind of thing", and the two are
 * nothing alike.
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
 * Several metrics over one rectangle add a third rule that only means anything
 * now there are several: **a metric that cannot answer drops out of the reading
 * rather than taking the reading away**. A product big enough to overflow a
 * double has no readout, and it used to leave the block blank; now it leaves
 * the block reading whatever else that category asked for, and only a rectangle
 * where nothing at all answers comes back `null`.
 *
 * Nothing here touches React or the DOM. It takes the page's rows, the column
 * order and the rectangle, and hands back strings that are ready to render.
 */
import { formatSum, type RangeRect } from './cellRange'
import { ENUM_OPTIONS } from './filters'
import { EN, LOCALE_TAGS, readEnum, type Strings } from './i18n'
import {
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

/**
 * Sentence case: the panel's tag uppercases it, the live region does not.
 *
 * The words themselves live in `i18n.ts` now, one set per locale, and every
 * function below takes the dictionary as an optional last argument defaulting
 * to English — so a host calling `metricLabel` or `metricNames` without one
 * still gets exactly what it got before there were two languages.
 */
const numericLabel = (t: Strings, key: NumericMetricKey) => t.metric[key]

const isNumericMetric = (key: string): key is NumericMetricKey =>
  (NUMERIC_METRICS as readonly string[]).includes(key)

/**
 * `Success` → `Success rate` / `Başarılı oranı`. The column name is the group
 * heading above it.
 *
 * The option arrives as the canonical English value — it is half of the metric
 * *key* — so it is read into the locale first and only then wrapped. Getting
 * that order wrong would print `Success oranı`.
 */
const rateLabel = (t: Strings, column: ColumnKey, option: string) =>
  t.rateLabel(readEnum(t, column, option))

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

/**
 * Numbers first, then one group per enum column — one section per category.
 *
 * A function of the locale, because every `label` in it is display text. The
 * *keys* are not: they are the same thirteen strings in every language, which
 * is what lets `METRIC_ORDER`, `normaliseMetricPrefs` and a host's stored
 * preferences all go on using the English-built table below without caring what
 * the table currently reads as.
 */
export const metricGroups = (t: Strings = EN): MetricGroup[] => [
  {
    category: 'number',
    label: t.metricNumbers,
    options: NUMERIC_METRICS.map((key) => ({ key, label: numericLabel(t, key) })),
  },
  ...ENUM_CATEGORIES.map(({ column, options }) => ({
    category: column,
    label: t.columns[column],
    options: options.map((option) => ({
      key: rateMetricKey(column, option),
      label: rateLabel(t, column, option),
    })),
  })),
]

/**
 * The English groups, kept as a constant: it is the public shape a host reads,
 * and it is what the order table and the option list below are built from.
 */
export const METRIC_GROUPS: MetricGroup[] = metricGroups(EN)

/**
 * Every metric flattened, in group order. The selector's arrow keys stay inside
 * one group — each section is its own radio group — so this is not a navigation
 * order; it is the full domain, for a host rendering its own control or
 * checking a key it has stored.
 */
export const METRIC_LIST: MetricOption[] = METRIC_GROUPS.flatMap((group) => group.options)

export function metricLabel(metric: MetricKey, t: Strings = EN): string {
  if (isNumericMetric(metric)) return numericLabel(t, metric)
  const rate = parseRateMetric(metric)
  return rate ? rateLabel(t, rate.column, rate.option) : ''
}

/**
 * Several metrics named as one phrase: `Sum`, or `Sum, Mean, Highest`. The cog's
 * accessible name and its tooltip are the callers — a cog has no words of its
 * own, so what is in force has to reach a screen reader and a pointer some other
 * way.
 */
export function metricNames(metrics: readonly MetricKey[], t: Strings = EN): string {
  return metrics.map((metric) => metricLabel(metric, t)).join(', ')
}

/**
 * Every metric's place inside its own category — the order a set is stored in
 * and the order the block lays a reading out in: Sum before Mean before
 * Highest, whichever of them was switched on first.
 *
 * Selection order was the alternative and it is the worse one. The block would
 * re-order itself under the reader as they set preferences, and the same three
 * metrics would read left to right differently for two people who had switched
 * them on in a different sequence. The panel's own order is the one both of
 * them can see, so it is the one the block uses.
 *
 * Only ever compared within a category, so the indices do not have to be unique
 * across the table.
 */
const METRIC_ORDER = new Map<string, number>(
  METRIC_GROUPS.flatMap((group) =>
    group.options.map((option, index) => [option.key, index] as const),
  ),
)

/** One category's metrics in the panel's order. Never sorts across categories. */
const inPanelOrder = (metrics: readonly MetricKey[]): MetricKey[] =>
  [...metrics].sort((a, b) => (METRIC_ORDER.get(a) ?? 0) - (METRIC_ORDER.get(b) ?? 0))

/* ---- the preferences ------------------------------------------------ */

/**
 * What each category should read as: the whole of what the selector owns, and
 * what the host seeds with `metrics` and follows with `onMetricsChange`.
 *
 * One **list** per category rather than one metric — a kind of cell content can
 * be asked for several things at once, and the block prints every one of them.
 * A list is kept in the panel's order (see `METRIC_ORDER`), holds no
 * duplicates, and is never empty: `toggleMetricPref` refuses the press that
 * would empty one, and `normaliseMetricPrefs` puts the default back if a host
 * sends `[]`.
 *
 * Total over the real categories — `DEFAULT_METRIC_PREFS` seeds every one of
 * them and nothing here ever deletes a key — but written as a partial record
 * over `ColumnKey` because that is as narrow as the type system can be about
 * which columns are enums (see `MetricCategory`). Read it through `metricsFor`,
 * which is total, rather than indexing it.
 */
export type MetricPrefs = Partial<Record<ColumnKey, RateMetricKey[]>> & {
  number: NumericMetricKey[]
}

/**
 * What a host may hand over: a list per category, or a bare key where it only
 * wants the one. The shorthand is not sugar for its own sake — it is the shape
 * the `metrics` prop had when a category held exactly one metric, so a host
 * written against that still means precisely what it said.
 */
export type MetricPrefsSeed = Partial<
  Record<ColumnKey, RateMetricKey | readonly RateMetricKey[]>
> & {
  number?: NumericMetricKey | readonly NumericMetricKey[]
}

/**
 * The first metric of each group, and only the first: Sum for numbers, Success
 * rate for Status, Spring rate for Favourite season. Derived rather than written
 * out, so a new enum column defaults to its own first option without an edit
 * here.
 *
 * One each rather than the lot. The block is a strip in a toolbar, and the
 * default has to be the reading that fits there; wanting three at once is
 * something a reader asks for, not something they should have to switch off.
 */
function buildDefaults(): MetricPrefs {
  const prefs: MetricPrefs = { number: [NUMERIC_METRICS[0]] }
  for (const { column, options } of ENUM_CATEGORIES) {
    prefs[column] = [rateMetricKey(column, options[0])]
  }
  return prefs
}

export const DEFAULT_METRIC_PREFS: MetricPrefs = buildDefaults()

/**
 * The metrics in force for one category, in the panel's order. Total, which is
 * why callers should come through here instead of indexing the record: a
 * section of the selector needs picks to draw as current even if a host handed
 * over a record missing that key, and the block needs at least one metric for
 * every category a rectangle can be detected as.
 *
 * `readonly`, and the stored array itself rather than a copy — the component
 * maps over it on every render, and everything here that changes a preference
 * builds a new one.
 */
export function metricsFor(
  prefs: MetricPrefs,
  category: MetricCategory,
): readonly MetricKey[] {
  const picked = prefs[category]
  if (picked && picked.length > 0) return picked
  // The last arm is the type system's problem rather than the data's:
  // `MetricCategory` admits every `ColumnKey`, so `'name'` type-checks as a
  // category, and every category that can actually be detected is in the
  // defaults.
  return DEFAULT_METRIC_PREFS[category] ?? [NUMERIC_METRICS[0]]
}

/**
 * One category's list replaced. The cast is the one `MetricPrefs` needs
 * everywhere: the type system cannot say which columns are enums, so which
 * flavour of key belongs on which shelf is `metricCategory`'s to know, and this
 * writes down what it was told.
 */
function withMetrics(
  prefs: MetricPrefs,
  category: MetricCategory,
  metrics: MetricKey[],
): MetricPrefs {
  if (category === 'number') return { ...prefs, number: metrics as NumericMetricKey[] }
  const next: MetricPrefs = { ...prefs }
  next[category] = metrics as RateMetricKey[]
  return next
}

/**
 * The record with one metric switched on or off, the category being whichever
 * one `metric` belongs to.
 *
 * Toggling rather than setting: the panel's options are a multi-select, so a
 * press on one means "show this as well" or "stop showing this", never "show
 * this instead".
 *
 * Returns the record it was given whenever nothing moves, so the reducer can
 * lean on identity to skip a render. A key that names no metric changes no
 * preference at all — the preference a key does not name is not one it should
 * be allowed to overwrite. And the press that would switch off a category's
 * last metric is refused, which is the one rule this function enforces rather
 * than merely records: an empty category would have the block read nothing over
 * cells that plainly have a reading, and that is the state this design does not
 * have.
 */
export function toggleMetricPref(prefs: MetricPrefs, metric: string): MetricPrefs {
  const category = metricCategory(metric)
  if (!category) return prefs

  // `metricCategory` has already vouched for the key, so this is a narrowing
  // rather than a check.
  const key = metric as MetricKey
  const current = metricsFor(prefs, category)
  const on = current.includes(key)
  if (on && current.length === 1) return prefs

  return withMetrics(
    prefs,
    category,
    on ? current.filter((held) => held !== key) : inPanelOrder([...current, key]),
  )
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
 *
 * A list is taken whole, de-duplicated and put in the panel's order; a bare key
 * is the one-metric shorthand; and a list with nothing valid left in it — `[]`,
 * or three typos — leaves that category on its default, for the same reason
 * `toggleMetricPref` will not empty one.
 */
export function normaliseMetricPrefs(seed?: MetricPrefsSeed | null): MetricPrefs {
  let prefs: MetricPrefs = { ...DEFAULT_METRIC_PREFS }
  if (!seed) return prefs

  for (const [category, asked] of Object.entries(seed)) {
    const wanted: MetricKey[] = []
    for (const metric of typeof asked === 'string' ? [asked] : (asked ?? [])) {
      if (typeof metric !== 'string') continue
      if (metricCategory(metric) !== category) continue
      const key = metric as MetricKey
      if (!wanted.includes(key)) wanted.push(key)
    }
    // Nothing valid under this heading — including a heading that is not a
    // category at all, whose every entry fails the comparison above — so the
    // default stands and nothing is written under a name that means nothing.
    if (wanted.length === 0) continue
    prefs = withMetrics(prefs, category as MetricCategory, inPanelOrder(wanted))
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
   * A rate's `5 of 8` — where that rate's column shows one, see
   * `RATE_COUNTS_OFF` — and `null` for every numeric metric. Bare: the
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

/**
 * Everything one rectangle came to: a result per metric its category has
 * switched on, in the panel's order, plus the two things about the set as a
 * whole that no single result carries.
 *
 * Never empty. A reading with no results is a `null` reading instead, because
 * the block draws nothing either way and one absent-answer for a caller to
 * check is better than two.
 */
export interface MetricReading {
  /** The kind the cells turned out to be — the section the selector marks. */
  category: MetricCategory
  /** At least one, in the panel's order. */
  results: MetricResult[]
  /**
   * What the live region should say about the lot: the results' own sentences,
   * comma-joined. `Sum 177, Mean 59`. The caller supplies the full stop, as it
   * always has.
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

/**
 * Grouped and pointed the way the *table's* language does it, not the way the
 * host machine does. The switch is the promise: turn it to TÜRKÇE and a mean of
 * 1234.5 reads `1.234,5`. Following `navigator.language` instead would leave a
 * Turkish table printing English separators on an English laptop, which is the
 * one place the readout has no other way to say which language it is in.
 */
const number = (t: Strings, value: number, min: number, max: number) =>
  new Intl.NumberFormat(LOCALE_TAGS[t.locale], {
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
 * takes the `category` off the reading it holds: one scan of the cells instead
 * of two, and no way for the mark and the numbers to disagree.
 * This is the detection on its own, and it is here so the unit tests can state
 * "these cells are numbers, those cells are nothing" directly instead of
 * inferring it from a metric that came back. Not in the package's exports for
 * the same reason `rangeMetrics` is not: a host is never handed a rectangle.
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
const derived = (t: Strings, value: number, decimals: number) =>
  number(t, value, 0, Math.min(decimals + 2, DECIMAL_CAP))

function numericAnswer(
  cells: string[],
  metric: NumericMetricKey,
  t: Strings,
): Answer | null {
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
        value: formatSum(
          { total: Number(total.toFixed(decimals)), count: values.length, decimals },
          LOCALE_TAGS[t.locale],
        ),
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
          value: new Intl.NumberFormat(LOCALE_TAGS[t.locale], {
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
      return { value: number(t, Number(product.toFixed(places)) || 0, 0, places), note: null }
    }

    case 'mean': {
      let total = 0
      for (const value of values) total += value
      return { value: derived(t, total / values.length, decimals), note: null }
    }

    case 'median': {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      const median =
        sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      return { value: derived(t, median, decimals), note: null }
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
      return { value: number(t, found, decimals, decimals), note: null }
    }
  }
}

/**
 * The enum columns whose rates do *not* print the count they were taken over.
 *
 * `62.5% (5 of 8)` is the working behind the percentage, and it earns its width
 * where the share is a figure the table is read *for*: how many cases succeeded
 * is the question this screen exists to answer, so Status shows its working.
 * Favourite season is a categorisation rather than a result — nobody checks a
 * season count against the percentage — and it is the column that pays most for
 * the habit: four options against Status's three, so four rates can be on at
 * once and each would drag its own parenthetical along the strip.
 *
 * An opt-*out* rather than an opt-in, so this stays the exception it is: a
 * fourth enum column added to `ENUM_OPTIONS` arrives showing its working, along
 * with its category, its default, its group and its detection rule, and only a
 * column that has been looked at and judged noisy is named here.
 */
const RATE_COUNTS_OFF: ReadonlySet<ColumnKey> = new Set<ColumnKey>(['favouriteSeason'])

/**
 * The share of the rectangle reading `rate.option`.
 *
 * The domain check is the detection's again, kept here so the arithmetic cannot
 * be handed cells it does not belong to: a rectangle over Status cannot answer
 * "Spring rate". Matching is exact, as the enum filter's is — these are
 * canonical values, not typed operands.
 */
function rateAnswer(cells: string[], rate: RateMetric, t: Strings): Answer | null {
  if (cells.length < MIN_CELLS) return null

  let hits = 0
  for (const raw of cells) {
    if (!rate.options.includes(raw)) return null
    if (raw === rate.option) hits += 1
  }

  const percent = new Intl.NumberFormat(LOCALE_TAGS[t.locale], {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(hits / cells.length)

  // The count is dropped from the readout, not from the arithmetic: the
  // percentage above is the same figure either way, and the cells it was taken
  // over are still every non-blank one in the rectangle.
  const note = RATE_COUNTS_OFF.has(rate.column)
    ? null
    : t.rateNote(number(t, hits, 0, 0), number(t, cells.length, 0, 0))

  return { value: percent, note }
}

/**
 * One metric's answer over cells already known to be `category`'s, or `null`
 * when that metric has none of its own — a product too big for a double, or a
 * preference a hand-built host record filed under the wrong kind. A `null` here
 * drops one reading and leaves the rest of the set standing.
 */
function readAs(
  cells: string[],
  category: MetricCategory,
  metric: MetricKey,
  t: Strings,
): MetricResult | null {
  if (category === 'number') {
    // Unreachable through `normaliseMetricPrefs`, which files every preference
    // under its own category; a hand-built record from a host can still say
    // otherwise, and a missing reading is the right way to answer "not that".
    if (!isNumericMetric(metric)) return null
    const answer = numericAnswer(cells, metric, t)
    return answer && dress(metric, numericLabel(t, metric), answer, t)
  }

  const rate = parseRateMetric(metric)
  if (!rate || rate.column !== category) return null

  const answer = rateAnswer(cells, rate, t)
  return answer && dress(metric, rateLabel(t, rate.column, rate.option), answer, t)
}

/**
 * What the rectangle says, under every preference for whatever kind of thing it
 * turns out to hold — or `null` when it holds no one kind, which is the panel's
 * cue to stay away (or fade out).
 *
 * The cells are scanned once and every metric of that category is asked of the
 * same array, which is the reason this is one function and not a loop around an
 * old one-metric version: six numeric metrics over a whole-column rectangle is
 * six passes over the values and would have been six passes over the *cells*
 * as well.
 *
 * A metric with no answer is left out rather than emptying the reading; only a
 * category where nothing at all answers comes back `null`.
 */
export function rangeMetrics(
  rows: DataTableRecord[],
  cols: ColumnKey[],
  rect: RangeRect,
  prefs: MetricPrefs = DEFAULT_METRIC_PREFS,
  t: Strings = EN,
): MetricReading | null {
  const cells = rangeCells(rows, cols, rect)
  const category = detect(cells)
  if (!category) return null

  const results: MetricResult[] = []
  for (const metric of metricsFor(prefs, category)) {
    const result = readAs(cells, category, metric, t)
    if (result) results.push(result)
  }
  if (results.length === 0) return null

  return {
    category,
    results,
    speech: results.map((result) => result.speech).join(', '),
  }
}

/**
 * The metrics the selector's button should name: the ones the block is
 * displaying, and the number preferences when the block is displaying nothing.
 * The button tracks the selection, so what it reads has to come from the same
 * reading the block does rather than from a second guess at the rectangle.
 */
export function metricsInForce(
  prefs: MetricPrefs,
  reading: MetricReading | null,
): readonly MetricKey[] {
  return reading ? reading.results.map((result) => result.metric) : metricsFor(prefs, 'number')
}

/**
 * `toLocaleUpperCase`, not `toUpperCase`: Turkish uppercases a dotless ı to I
 * and a dotted i to İ, and the unqualified method gets both wrong — "Çarpım"
 * would come out "ÇARPIM" only by luck and "içinde" would lose its dot. The tag
 * is the one string here that is shouted, so it is the one that has to say
 * which language it is shouting in.
 */
function dress(
  metric: MetricKey,
  label: string,
  answer: Answer,
  t: Strings,
): MetricResult {
  return {
    metric,
    tag: label.toLocaleUpperCase(LOCALE_TAGS[t.locale]),
    value: answer.value,
    note: answer.note,
    speech: `${label} ${answer.value}`,
  }
}

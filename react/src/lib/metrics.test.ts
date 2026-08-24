/**
 * The metric engine on its own.
 *
 * The panel and the selector are covered through the component in
 * DataTable.test.tsx; this file pins the arithmetic, the detection and the
 * preference rules, which are far easier to state as a column of strings than
 * to drag a rectangle over — and which are where the feature is actually
 * decided: what a rectangle turns out to be, which preferences that puts in
 * force, what rules a rectangle out entirely, and how many decimals reach the
 * screen.
 *
 * Formatting is asserted through locale-tolerant patterns. `Intl` uses whatever
 * locale the host runs in, and a test that hard-codes `1,000` fails on a
 * machine set to de-DE for no good reason.
 */
import { describe, expect, it } from 'vitest'

import { formatSum, rangeSum, type RangeRect } from './cellRange'
import {
  DEFAULT_METRIC_PREFS,
  METRIC_CATEGORIES,
  METRIC_GROUPS,
  METRIC_LIST,
  isMetricKey,
  metricCategory,
  metricLabel,
  metricNames,
  metricsFor,
  metricsInForce,
  normaliseMetricPrefs,
  rangeCategory,
  rangeMetrics,
  rateMetricKey,
  toggleMetricPref,
  type MetricKey,
  type MetricPrefs,
  type MetricPrefsSeed,
} from './metrics'
import type { ColumnKey, DataTableRecord } from './types'

/**
 * A row whose named columns read exactly what is passed and whose every other
 * field is blank. The enum columns are cast because a blank Status is not
 * representable on the record type — but it is exactly what real data hands
 * over, and skipping blanks is one of the rules under test.
 */
const record = (cells: Partial<Record<ColumnKey, string>>, i: number): DataTableRecord => ({
  id: `r${i}`,
  name: '',
  date: '',
  status: 'Success',
  solvedCases: '',
  favouriteSeason: 'Spring',
  address: '',
  email: '',
  owner: '',
  activity: '',
  plan: '',
  note: '',
  ...(cells as Partial<DataTableRecord>),
})

/** Rows, the column order on screen, and the rectangle over them. */
interface Grid {
  rows: DataTableRecord[]
  cols: ColumnKey[]
  rect: RangeRect
}

/** One column of cells, and the rectangle that covers all of it. */
const column = (key: ColumnKey, values: string[]): Grid => ({
  rows: values.map((value, i) => record({ [key]: value }, i)),
  cols: [key],
  rect: { top: 0, left: 0, bottom: values.length - 1, right: 0 },
})

/** Several columns side by side — one array of cells per row, left to right. */
const grid = (cols: ColumnKey[], cells: string[][]): Grid => ({
  rows: cells.map((row, i) =>
    record(
      Object.fromEntries(cols.map((key, c) => [key, row[c]])) as Partial<
        Record<ColumnKey, string>
      >,
      i,
    ),
  ),
  cols,
  rect: { top: 0, left: 0, bottom: cells.length - 1, right: cols.length - 1 },
})

/**
 * The defaults with a category or two replaced — what a user leaves behind.
 *
 * Replaced rather than toggled on top of: naming `'mean'` here means "a
 * rectangle of numbers reads Mean", which is what almost every test below wants
 * to say, where toggling it on would leave Sum switched on beside it and every
 * one of them reading two figures. Naming two metrics of one category is how
 * the multi-metric tests ask for both.
 */
const prefsWith = (...metrics: string[]): MetricPrefs => {
  const seed: Record<string, string[]> = {}
  for (const metric of metrics) {
    // A key that names no category is filed under itself, so it is dropped by
    // the same rule that drops a metric on the wrong shelf.
    const category = metricCategory(metric) ?? metric
    ;(seed[category] ||= []).push(metric)
  }
  return normaliseMetricPrefs(seed as MetricPrefsSeed)
}

const categoryOf = (g: Grid) => rangeCategory(g.rows, g.cols, g.rect)
/** Everything the rectangle came to, under those preferences. */
const readAll = (g: Grid, ...metrics: string[]) =>
  rangeMetrics(g.rows, g.cols, g.rect, prefsWith(...metrics))
/**
 * The one figure a one-metric category produces — what most of this file is
 * about, and what the readout was for the whole of its life before a category
 * could hold two.
 */
const read = (g: Grid, ...metrics: string[]) => readAll(g, ...metrics)?.results[0] ?? null

const ask = (key: ColumnKey, values: string[], ...metrics: string[]) =>
  read(column(key, values), ...metrics)

/** The default subject: a run of Solved cases counts. */
const cases = (values: string[], ...metrics: string[]) =>
  ask('solvedCases', values, ...metrics)
const shown = (values: string[], ...metrics: string[]) => cases(values, ...metrics)?.value

const NUMERIC: MetricKey[] = ['sum', 'product', 'mean', 'median', 'highest', 'lowest']

describe('the metric list', () => {
  it('is grouped Numbers, Status, Favourite season, in that order', () => {
    expect(METRIC_GROUPS.map((group) => group.label)).toEqual([
      'Numbers',
      'Status',
      'Favourite season',
    ])
  })

  it('names the numeric metrics the way the panel tags them', () => {
    expect(METRIC_GROUPS[0].options.map((o) => o.label)).toEqual([
      'Sum', 'Product', 'Mean', 'Median', 'Highest', 'Lowest',
    ])
    expect(DEFAULT_METRIC_PREFS.number).toEqual([METRIC_GROUPS[0].options[0].key])
    expect(DEFAULT_METRIC_PREFS.number).toEqual(['sum'])
  })

  it('turns every enum option into a rate, in the option order the dock uses', () => {
    expect(METRIC_GROUPS[1].options.map((o) => o.label)).toEqual([
      'Success rate', 'In progress rate', 'Failed rate',
    ])
    expect(METRIC_GROUPS[2].options.map((o) => o.label)).toEqual([
      'Spring rate', 'Summer rate', 'Autumn rate', 'Winter rate',
    ])
    expect(METRIC_GROUPS[1].options[1].key).toBe('rate:status:In progress')
  })

  it('flattens to every metric in group order — the whole domain, headings aside', () => {
    expect(METRIC_LIST).toHaveLength(6 + 3 + 4)
    expect(METRIC_LIST.map((o) => o.key)).toEqual(
      METRIC_GROUPS.flatMap((group) => group.options.map((o) => o.key)),
    )
    expect(METRIC_LIST.every((o) => isMetricKey(o.key))).toBe(true)
  })

  it('labels a key on its own, for the selector button and the live region', () => {
    expect(metricLabel('median')).toBe('Median')
    expect(metricLabel(rateMetricKey('favouriteSeason', 'Autumn'))).toBe('Autumn rate')
  })

  it('refuses a key it does not recognise', () => {
    expect(isMetricKey('total')).toBe(false)
    expect(isMetricKey('rate:status')).toBe(false)
    // a real column, an option it does not have
    expect(isMetricKey('rate:status:Pending')).toBe(false)
    // a real option, a column that is not an enum
    expect(isMetricKey('rate:name:Success')).toBe(false)
  })
})

describe('the categories', () => {
  it('is numbers plus one per enum column, in table order', () => {
    expect(METRIC_CATEGORIES).toEqual(['number', 'status', 'favouriteSeason'])
  })

  it('gives every group its category, and every metric in it belongs there', () => {
    expect(METRIC_GROUPS.map((group) => group.category)).toEqual(METRIC_CATEGORIES)
    for (const group of METRIC_GROUPS) {
      for (const option of group.options) {
        expect(metricCategory(option.key)).toBe(group.category)
      }
    }
  })

  it('has a category for nothing it does not recognise, rather than throwing', () => {
    expect(metricCategory('total')).toBeNull()
    expect(metricCategory('rate:status:Pending')).toBeNull()
    expect(metricCategory('rate:name:Success')).toBeNull()
    expect(metricCategory('')).toBeNull()
  })
})

describe('what the rectangle turns out to be', () => {
  it('reads a run of numbers as numbers', () => {
    expect(categoryOf(column('solvedCases', ['128', '42']))).toBe('number')
    // it is the values, not the column: numbers typed into a text column count
    expect(categoryOf(column('name', ['1', '2']))).toBe('number')
  })

  it('reads a run of one enum column as that column', () => {
    expect(categoryOf(column('status', ['Success', 'Failed']))).toBe('status')
    expect(categoryOf(column('favouriteSeason', ['Spring', 'Winter']))).toBe(
      'favouriteSeason',
    )
  })

  it('has no category for text or for dates', () => {
    expect(categoryOf(column('name', ['Amelia Hart', 'Marcus Reed']))).toBeNull()
    expect(categoryOf(column('date', ['19 August, 2026', '2 May, 2026']))).toBeNull()
  })

  it('has no category for a rectangle mixing numbers and statuses', () => {
    expect(
      categoryOf(grid(['status', 'solvedCases'], [['Success', '128'], ['Failed', '42']])),
    ).toBeNull()
  })

  it('has no category for a rectangle spanning both enum columns', () => {
    // "Success rate" over a rectangle of seasons is the meaningless question
    // the per-column categories exist to prevent
    expect(
      categoryOf(
        grid(
          ['status', 'favouriteSeason'],
          [['Success', 'Spring'], ['Failed', 'Winter']],
        ),
      ),
    ).toBeNull()
  })

  it('is not fooled by one stray cell of another category', () => {
    expect(categoryOf(column('status', ['Success', 'Failed', 'Spring']))).toBeNull()
    expect(categoryOf(column('solvedCases', ['128', '42', 'many']))).toBeNull()
  })

  it('wants two non-blank cells before it calls the rectangle anything', () => {
    for (const [key, value] of [
      ['solvedCases', '128'],
      ['status', 'Success'],
      ['favouriteSeason', 'Spring'],
    ] as [ColumnKey, string][]) {
      expect(categoryOf(column(key, [value]))).toBeNull()
      // blanks are skipped rather than counted, so this is still one cell
      expect(categoryOf(column(key, [value, '', '   ']))).toBeNull()
      expect(categoryOf(column(key, ['']))).toBeNull()
      expect(categoryOf(column(key, [value, value]))).not.toBeNull()
    }
  })
})

describe('numeric metrics', () => {
  const RUN = ['128', '42', '7']

  it('adds, multiplies, averages and picks the ends of a run', () => {
    expect(shown(RUN, 'sum')).toBe('177')
    expect(shown(RUN, 'mean')).toBe('59')
    expect(shown(RUN, 'median')).toBe('42')
    expect(shown(RUN, 'highest')).toBe('128')
    expect(shown(RUN, 'lowest')).toBe('7')
    expect(shown(['2', '3', '4'], 'product')).toBe('24')
  })

  it('leaves the sum exactly as the readout formatted it before the selector', () => {
    // The default preference must not have moved a digit: same total, same grouping.
    const { rows, cols, rect } = column('solvedCases', ['1024', '2048', '7.5'])
    const old = rangeSum(rows, cols, rect)
    expect(old).not.toBeNull()
    const only = (prefs?: MetricPrefs) =>
      rangeMetrics(rows, cols, rect, prefs)?.results[0]?.value
    expect(only(prefsWith('sum'))).toBe(formatSum(old!))
    // and the preferences argument is optional, defaulting to that same sum
    expect(only()).toBe(formatSum(old!))
  })

  it('averages an even count off the two middle values', () => {
    expect(shown(['1', '2', '3', '10'], 'median')).toBe('2.5')
    // and is not fooled by the cells arriving out of order
    expect(shown(['10', '1', '3', '2'], 'median')).toBe('2.5')
  })

  it('keeps float noise off the screen', () => {
    expect(shown(['0.1', '0.2'], 'sum')).toMatch(/^0[.,]3$/)
    expect(shown(['0.1', '0.2'], 'mean')).toMatch(/^0[.,]15$/)
    expect(shown(['0.1', '0.2'], 'product')).toMatch(/^0[.,]02$/)
    expect(shown(['0.1', '0.2'], 'median')).toMatch(/^0[.,]15$/)
  })

  it('lets a derived value say .5 but never invents places on a cell', () => {
    // mean and median may go two past the data; highest and lowest are cells,
    // and are shown the way the cells were
    expect(shown(['1', '2'], 'mean')).toMatch(/^1[.,]5$/)
    expect(shown(['1.5', '2.25'], 'highest')).toMatch(/^2[.,]25$/)
    expect(shown(['1.5', '2.25'], 'lowest')).toMatch(/^1[.,]50$/)
    // a product of two 2-decimal cells legitimately has four places
    expect(shown(['1.25', '1.25'], 'product')).toMatch(/^1[.,]5625$/)
  })

  it('skips blanks rather than counting them as zero', () => {
    expect(shown(['10', '', '20'], 'sum')).toBe('30')
    expect(shown(['10', '   ', '20'], 'mean')).toBe('15') // not 10
    expect(shown(['10', '', '20'], 'lowest')).toBe('10') // not 0
    expect(shown(['10', '', '20'], 'product')).toBe('200') // not 0
  })

  it('has no answer for fewer than two numbers', () => {
    for (const metric of NUMERIC) {
      expect(cases(['128'], metric)).toBeNull()
      expect(cases(['128', ''], metric)).toBeNull()
      expect(cases([''], metric)).toBeNull()
    }
  })

  it('is ruled out entirely by one cell that is not a number', () => {
    for (const metric of NUMERIC) {
      expect(cases(['128', '42', 'many'], metric)).toBeNull()
      // a column of names has no answer at all
      expect(ask('name', ['Amelia Hart', 'Marcus Reed'], metric)).toBeNull()
    }
  })

  it('rules out a rectangle that catches a text column beside the numbers', () => {
    const wide = grid(['name', 'solvedCases'], [
      ['Amelia Hart', '128'],
      ['Marcus Reed', '42'],
    ])
    const narrow: Grid = { ...wide, rect: { top: 0, left: 1, bottom: 1, right: 1 } }
    expect(read(wide, 'sum')).toBeNull()
    expect(read(narrow, 'sum')?.value).toBe('170')
  })

  it('folds a product too big to read into exponent form', () => {
    // a dozen three-digit numbers is a 36-digit wall, and past 2^53 the tail of
    // it is the float's digits rather than the data's
    const huge = shown(Array.from({ length: 12 }, () => '999'), 'product')
    expect(huge).toMatch(/^9[.,]\d+E35$/)
    expect(huge).not.toMatch(/\d{16}/)

    // the switch is at 1e15: 1e18 folds, 1e12 does not
    expect(shown(['1000000', '1000000', '1000000'], 'product')).toBe('1E18')
    expect(shown(['1000000', '1000000'], 'product')).not.toMatch(/E/)
  })

  it('folds a product too small to read into exponent form as well', () => {
    // 1e-8 through the six places the readout shows is "0.000000", which reads
    // as a flat 0 — indistinguishable from a rectangle that holds a real zero,
    // and a wrong answer rather than a coarse one
    expect(shown(['0.0001', '0.0001'], 'product')).toBe('1E-8')
    expect(shown(['0.01', '0.01', '0.01', '0.01'], 'product')).toBe('1E-8')
    // the switch is that sixth place: 1e-6 still reads as itself
    expect(shown(['0.001', '0.001'], 'product')).toMatch(/^0[.,]000001$/)

    // zero is exact, not small: it is the true reading and it keeps it
    expect(shown(['0', '42'], 'product')).toBe('0')
    // and no reading is ever the signed zero Intl spells with a minus
    expect(shown(['-1', '0'], 'product')).toBe('0')
    expect(shown(['-0.01', '0.01', '0.01', '0.01'], 'product')).toBe('-1E-8')
  })
})

describe('rates', () => {
  const status = (values: string[], ...metrics: string[]) =>
    ask('status', values, ...metrics)

  it('reads how much of the selection is that option, with the count beside it', () => {
    const result = status(['Success', 'Success', 'Failed', 'In progress'])
    expect(result?.value).toMatch(/^50\s?%$/)
    expect(result?.note).toBe('2 of 4')
  })

  it('carries at most one decimal', () => {
    // the spec's own example: five of eight
    const eight = ['Success', 'Success', 'Failed', 'Success', 'In progress', 'Success', 'Success', 'Failed']
    const result = status(eight)
    expect(result?.value).toMatch(/^62[.,]5\s?%$/)
    expect(result?.note).toBe('5 of 8')

    // a third of three does not spill digits across the toolbar
    expect(status(['Success', 'Failed', 'Failed'])?.value).toMatch(/^33[.,]3\s?%$/)
  })

  it('says 0% rather than disappearing when nothing in range matches', () => {
    // the rectangle can answer the question; the answer is simply none
    const result = status(['Failed', 'In progress'])
    expect(result?.value).toMatch(/^0\s?%$/)
    expect(result?.note).toBe('0 of 2')
  })

  it('says 100% when every cell matches', () => {
    const result = status(['Success', 'Success', 'Success'])
    expect(result?.value).toMatch(/^100\s?%$/)
    expect(result?.note).toBe('3 of 3')
  })

  it('leaves the count off a season, which is where it only costs width', () => {
    // The working behind the percentage is worth the strip's width where the
    // share is a figure the table is read for — Status — and not where it is a
    // categorisation. The arithmetic is the same either way.
    const result = ask('favouriteSeason', ['Spring', 'Spring', 'Summer', 'Autumn'])
    expect(result?.value).toMatch(/^50\s?%$/)
    expect(result?.note).toBeNull()
    // and the speech is the value alone, as it is for every numeric metric
    expect(result?.speech).toBe(`Spring rate ${result?.value}`)
  })

  it('skips blanks, which are not a failure to be that option', () => {
    const result = status(['Success', '', 'Failed'])
    expect(result?.value).toMatch(/^50\s?%$/)
    expect(result?.note).toBe('1 of 2')
  })

  it('has no answer for fewer than two cells', () => {
    expect(status(['Success'])).toBeNull()
    expect(status(['Success', ''])).toBeNull()
    expect(ask('favouriteSeason', ['Spring'])).toBeNull()
  })

  it('has no answer for a rectangle spread across two option sets', () => {
    // one stray cell is enough, exactly as it is for the numbers
    expect(status(['Success', 'Failed', 'Spring'])).toBeNull()
  })
})

describe('the preferences', () => {
  const EIGHT = ['Success', 'Success', 'Failed', 'Success', 'In progress', 'Success', 'Success', 'Failed']

  it('opens on Sum, Success rate and Spring rate — the first of each group, one each', () => {
    expect(DEFAULT_METRIC_PREFS).toEqual({
      number: ['sum'],
      status: ['rate:status:Success'],
      favouriteSeason: ['rate:favouriteSeason:Spring'],
    })
    for (const group of METRIC_GROUPS) {
      expect(metricsFor(DEFAULT_METRIC_PREFS, group.category)).toEqual([
        group.options[0].key,
      ])
    }
  })

  it('answers the same rectangle differently as the preference for it moves', () => {
    const statuses = column('status', EIGHT)
    expect(read(statuses)?.tag).toBe('SUCCESS RATE')
    expect(read(statuses)?.value).toMatch(/^62[.,]5\s?%$/)

    const failed = read(statuses, 'rate:status:Failed')
    expect(failed?.tag).toBe('FAILED RATE')
    expect(failed?.value).toMatch(/^25\s?%$/)
    expect(failed?.note).toBe('2 of 8')

    const counts = column('solvedCases', ['128', '42', '7'])
    expect(read(counts)?.value).toBe('177')
    expect(read(counts, 'mean')?.value).toBe('59')
  })

  it('never has to be matched to the selection by hand', () => {
    // One record of preferences, three rectangles: each reads its own.
    const prefs = normaliseMetricPrefs({ number: 'mean', status: 'rate:status:Failed' })
    const answer = (g: Grid) => rangeMetrics(g.rows, g.cols, g.rect, prefs)?.results[0]

    expect(answer(column('solvedCases', ['10', '20']))?.tag).toBe('MEAN')
    expect(answer(column('status', ['Success', 'Failed']))?.tag).toBe('FAILED RATE')
    // the category nobody touched is still on its default
    expect(answer(column('favouriteSeason', ['Spring', 'Winter']))?.tag).toBe('SPRING RATE')
  })

  it('does not let a preference for one category reach another', () => {
    // Setting a season rate does not change what a rectangle of statuses says…
    const seasoned = prefsWith('rate:favouriteSeason:Winter')
    const statuses = column('status', ['Success', 'Failed'])
    expect(
      rangeMetrics(statuses.rows, statuses.cols, statuses.rect, seasoned)?.results[0].tag,
    ).toBe('SUCCESS RATE')
    // …and a rectangle of counts reads the number preference however the rate
    // preferences are set. Under the old single-metric selector this pairing
    // was the dead end that took the block away.
    expect(cases(['128', '42'], 'rate:status:Success')).not.toBeNull()
    expect(shown(['128', '42'], 'rate:status:Success')).toBe('170')
    expect(shown(['128', '42'], 'rate:favouriteSeason:Winter')).toBe('170')
  })

  it('switches a metric on under its own category, and changes nothing else', () => {
    const next = toggleMetricPref(DEFAULT_METRIC_PREFS, 'rate:favouriteSeason:Autumn')
    expect(next).toEqual({
      ...DEFAULT_METRIC_PREFS,
      // added to Spring rather than replacing it: the panel is a multi-select
      favouriteSeason: ['rate:favouriteSeason:Spring', 'rate:favouriteSeason:Autumn'],
    })
    expect(toggleMetricPref(next, 'median').number).toEqual(['sum', 'median'])
  })

  it('switches one back off, and never the last one of a category', () => {
    const two = toggleMetricPref(DEFAULT_METRIC_PREFS, 'median')
    expect(two.number).toEqual(['sum', 'median'])
    expect(toggleMetricPref(two, 'sum').number).toEqual(['median'])

    // and the press that would empty a category is refused, not obeyed: an
    // empty category would put the block back to reading nothing over cells
    // that plainly read as something
    const one = toggleMetricPref(two, 'median')
    expect(one.number).toEqual(['sum'])
    expect(toggleMetricPref(one, 'sum')).toBe(one)
  })

  it('hands back the very same record when nothing moves', () => {
    // The reducer leans on this identity to skip a render.
    expect(toggleMetricPref(DEFAULT_METRIC_PREFS, 'sum')).toBe(DEFAULT_METRIC_PREFS)
    expect(toggleMetricPref(DEFAULT_METRIC_PREFS, 'rate:status:Success')).toBe(
      DEFAULT_METRIC_PREFS,
    )
    // and a key that names no metric changes no preference at all
    expect(toggleMetricPref(DEFAULT_METRIC_PREFS, 'rate:status:Pending')).toBe(
      DEFAULT_METRIC_PREFS,
    )
    expect(toggleMetricPref(DEFAULT_METRIC_PREFS, 'total')).toBe(DEFAULT_METRIC_PREFS)
  })

  it('keeps a category in the panel\'s order, not the order it was switched on', () => {
    // Highest is last of the six and Product second, whichever way round they
    // are pressed — the block must not re-order itself under the reader
    const prefs = ['highest', 'product'].reduce(toggleMetricPref, DEFAULT_METRIC_PREFS)
    expect(prefs.number).toEqual(['sum', 'product', 'highest'])
    expect(normaliseMetricPrefs({ number: ['highest', 'product'] }).number).toEqual([
      'product',
      'highest',
    ])
  })

  it('takes a partial record from the host over the defaults', () => {
    expect(normaliseMetricPrefs()).toEqual(DEFAULT_METRIC_PREFS)
    expect(normaliseMetricPrefs()).not.toBe(DEFAULT_METRIC_PREFS)
    expect(normaliseMetricPrefs({ status: ['rate:status:Failed'] })).toEqual({
      ...DEFAULT_METRIC_PREFS,
      status: ['rate:status:Failed'],
    })
  })

  it('takes a bare key as the list of one it always was', () => {
    // The shape the prop had before a category could hold two, and a host
    // written against it still means exactly what it said.
    expect(normaliseMetricPrefs({ number: 'median' })).toEqual({
      ...DEFAULT_METRIC_PREFS,
      number: ['median'],
    })
  })

  it('de-duplicates a list and drops the junk inside one', () => {
    expect(
      normaliseMetricPrefs({
        number: ['mean', 'mean', 'sum', 'nonsense', 'rate:status:Success'],
      } as unknown as MetricPrefsSeed).number,
    ).toEqual(['sum', 'mean'])
  })

  it('leaves a category on its default rather than empty it', () => {
    // Nothing valid left under the heading — an empty list, or three typos — is
    // the same case, and the same answer: there is no kind of cell that reads
    // as nothing.
    expect(normaliseMetricPrefs({ number: [] })).toEqual(DEFAULT_METRIC_PREFS)
    expect(
      normaliseMetricPrefs({ status: ['rate:status:Pending'] } as unknown as MetricPrefsSeed),
    ).toEqual(DEFAULT_METRIC_PREFS)
  })

  it('drops what a host sends that is not a metric for the category it is under', () => {
    const junk = normaliseMetricPrefs({
      number: 'rate:status:Success', // a rate on the numbers' shelf
      status: 'mean', // a number on Status's shelf
      favouriteSeason: 'rate:status:Failed', // a real rate, the wrong column
      name: 'sum', // a column that is not a category
      total: 'sum', // not a category at all
      solvedCases: undefined,
      // Cast because none of the above type-checks — which is the point: what
      // arrives from a host at runtime has had no such check.
    } as unknown as Partial<MetricPrefs>)
    expect(junk).toEqual(DEFAULT_METRIC_PREFS)
  })

  it('answers for a category a host left out of its record', () => {
    // Total by design: the selector still has to draw a current tick for every
    // section it renders, and the block a figure for every kind it can detect.
    const sparse = { number: ['mean'] } as MetricPrefs
    expect(metricsFor(sparse, 'status')).toEqual(['rate:status:Success'])
    expect(metricsFor(sparse, 'number')).toEqual(['mean'])
    // an empty list is the same case as a missing one
    expect(metricsFor({ number: [] } as MetricPrefs, 'number')).toEqual(['sum'])
  })

  it('names the metrics in force, and the number ones when there are none', () => {
    const prefs = prefsWith('median', 'rate:status:Failed', 'rate:status:Success')
    const statuses = column('status', ['Success', 'Failed'])
    const answer = rangeMetrics(statuses.rows, statuses.cols, statuses.rect, prefs)

    expect(metricsInForce(prefs, answer)).toEqual([
      'rate:status:Success',
      'rate:status:Failed',
    ])
    expect(metricNames(metricsInForce(prefs, answer))).toBe('Success rate, Failed rate')
    // nothing selected: the button falls back to what numbers would read as
    expect(metricsInForce(prefs, null)).toEqual(['median'])
    expect(metricLabel('median')).toBe('Median')
  })
})

describe('several metrics over one rectangle', () => {
  const RUN = ['128', '42', '7']

  it('reads the rectangle once per metric its kind is set to', () => {
    const answer = readAll(column('solvedCases', RUN), 'sum', 'mean', 'highest')
    expect(answer?.results.map((result) => result.tag)).toEqual(['SUM', 'MEAN', 'HIGHEST'])
    expect(answer?.results.map((result) => result.value)).toEqual(['177', '59', '128'])
    expect(answer?.category).toBe('number')
  })

  it("lays them out in the panel's order however they were asked for", () => {
    // Lowest is the sixth option and Median the fourth, whichever order the
    // preferences name them in
    const answer = readAll(column('solvedCases', RUN), 'lowest', 'median')
    expect(answer?.results.map((result) => result.metric)).toEqual(['median', 'lowest'])
  })

  it('reads a run of statuses as every rate that kind is set to', () => {
    const answer = readAll(
      column('status', ['Success', 'Success', 'Failed', 'In progress']),
      'rate:status:Success',
      'rate:status:Failed',
    )
    expect(answer?.results.map((result) => result.tag)).toEqual([
      'SUCCESS RATE',
      'FAILED RATE',
    ])
    expect(answer?.results.map((result) => result.note)).toEqual(['2 of 4', '1 of 4'])
  })

  it('only ever answers with the kind the cells are, however much else is set', () => {
    // Six numeric metrics and every rate of both enum columns switched on at
    // once: a rectangle of counts still reads as numbers and nothing else.
    const answer = readAll(
      column('solvedCases', RUN),
      ...METRIC_LIST.map((option) => option.key),
    )
    expect(answer?.category).toBe('number')
    expect(answer?.results).toHaveLength(6)
    expect(answer?.results.every((result) => metricCategory(result.metric) === 'number'))
      .toBe(true)
  })

  it('drops a metric that cannot answer and keeps the rest', () => {
    // The product of three 1e300s overflows the double and has no readout at
    // all; before the block could hold two figures that took the whole reading
    // away, and now it takes only its own.
    const huge = ['1e300', '1e300', '1e300']
    expect(readAll(column('solvedCases', huge), 'product')).toBeNull()

    const answer = readAll(column('solvedCases', huge), 'sum', 'product', 'highest')
    expect(answer?.results.map((result) => result.metric)).toEqual(['sum', 'highest'])
  })

  it('speaks the lot as one sentence, in the order the block prints them', () => {
    const answer = readAll(column('solvedCases', RUN), 'sum', 'mean')
    // the caller adds the full stop, as it has always done
    expect(answer?.speech).toBe('Sum 177, Mean 59')
  })

  it('still says nothing at all about a rectangle with no kind', () => {
    // Every metric switched on changes none of the rules the sum had: names
    // have no answer, and one figure short of two cells is not a statistic.
    const all = METRIC_LIST.map((option) => option.key)
    expect(readAll(column('name', ['Amelia Hart', 'Marcus Reed']), ...all)).toBeNull()
    expect(readAll(column('solvedCases', ['128']), ...all)).toBeNull()
    expect(
      readAll(
        grid(['status', 'solvedCases'], [['Success', '128'], ['Failed', '42']]),
        ...all,
      ),
    ).toBeNull()
  })
})

describe('what the panel and the live region are handed', () => {
  it('tags the panel in upper case and the live region in sentence case', () => {
    const mean = cases(['10', '20'], 'mean')
    expect(mean).toEqual({
      metric: 'mean',
      tag: 'MEAN',
      value: '15',
      note: null,
      speech: 'Mean 15',
    })
  })

  it('speaks a rate as the selector names it, so the tag is never spelled out', () => {
    const result = ask('status', ['Success', 'Failed'])
    expect(result?.metric).toBe('rate:status:Success')
    expect(result?.tag).toBe('SUCCESS RATE')
    expect(result?.speech).toBe(`Success rate ${result?.value}`)
    // the note stays out of the speech and out of the value: the panel draws
    // the parentheses around it itself
    expect(result?.note).toBe('1 of 2')
  })
})

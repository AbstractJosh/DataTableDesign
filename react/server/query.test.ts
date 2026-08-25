/**
 * @vitest-environment node
 *
 * The differential test: SQL against JavaScript, over the same records.
 *
 * `query.ts` is a second implementation of something the component already
 * does, which is the most dangerous kind of code to write — it is right on the
 * day it is written and drifts silently afterwards. So nothing here asserts
 * that a filter returns "the rows it should"; every case runs the real
 * `matchesAll` and the real `compareCells` over the same array and asserts the
 * database agrees, id for id, in order.
 *
 * That makes the client the specification, which is what it is.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { ensureSchema, insertAll, openDatabase } from './db.ts'
import { COLUMN_SQL_TYPES, EMPTY_QUERY, queryRecords, type RecordQuery } from './query.ts'
import { createDemoRecords } from '../src/lib/demoData'
import { COLUMN_TYPES, matchesAll } from '../src/lib/filters'
import { LOCALE_TAGS } from '../src/lib/i18n'
import { compareCells } from '../src/lib/sort'
import type { FilterCondition, FilterOp } from '../src/lib/filters'
import type { ColumnKey, DataTableRecord } from '../src/lib/types'

/*
 * Enough rows that every case has something to filter out and every sort has
 * ties to break, small enough that a few hundred queries run in a second. The
 * first seventeen are the hand-checked ones, so the Success+Spring overlap the
 * dock's two-chip AND depends on is in here.
 */
const RECORDS = createDemoRecords(400)

let db: DatabaseSync

beforeAll(() => {
  db = openDatabase(':memory:')
  ensureSchema(db)
  insertAll(db, RECORDS)
})

/* ---- the reference implementation, lifted from DataTable ------------- */

/**
 * `DataTable`'s derive, minus the paging: filter by the dock, then by the
 * query, then sort. Copied deliberately — the point is to run the component's
 * own `matchesAll` and `compareCells`, not a description of them.
 */
function derive(query: RecordQuery): DataTableRecord[] {
  const tag = LOCALE_TAGS[query.locale]
  const q = query.q.trim().toLocaleLowerCase(tag)

  const list = RECORDS.filter((r) => {
    if (!matchesAll(r, query.where)) return false
    if (!q) return true
    return `${r.name} ${r.email} ${r.address}`.toLocaleLowerCase(tag).includes(q)
  })

  if (!query.sort) return list

  const { sort, dir } = query
  return list
    .slice()
    .sort(
      (a, b) => compareCells(String(a[sort]), String(b[sort]), tag) * (dir === 'asc' ? 1 : -1),
    )
}

const ids = (records: DataTableRecord[]) => records.map((r) => r.id)

/** Everything matching, in one go — `MAX_LIMIT` is above the 400 rows here. */
const serverIds = (query: Partial<RecordQuery>) =>
  ids(queryRecords(db, { ...EMPTY_QUERY, limit: 5000, ...query }).rows)

const clientIds = (query: Partial<RecordQuery>) =>
  ids(derive({ ...EMPTY_QUERY, ...query }))

function agree(query: Partial<RecordQuery>) {
  expect(serverIds(query)).toEqual(clientIds(query))
}

/* ---- conditions ------------------------------------------------------ */

const cond = (
  key: ColumnKey,
  op: FilterOp,
  extra: Partial<FilterCondition> = {},
): FilterCondition => ({
  id: `${key}:${op}`,
  key,
  op,
  values: [],
  value: '',
  value2: '',
  ...extra,
})

/**
 * What a case is expected to *do*, checked alongside the agreement itself.
 *
 * Without it a case that quietly matched every row, or none, would pass while
 * testing nothing — and the two states are both legitimate answers here, so
 * neither can simply be banned. `all` is the inactive-condition rule (a chip
 * with no operand yet filters nothing); `none` is an operand that cannot be
 * parsed, which throws every row away rather than being ignored.
 */
type Reach = 'some' | 'none' | 'all'

const CASES: [string, Partial<RecordQuery>, Reach?][] = [
  ['no filter at all', {}, 'all'],

  ['search on a name', { q: 'ethan' }],
  ['search on an email domain', { q: 'xyz.com' }],
  ['search that is only whitespace', { q: '   ' }, 'all'],
  ['search that matches nothing', { q: 'zzzzz' }, 'none'],
  ['search on an address fragment', { q: 'new york' }],
  ['search folded against mixed case', { q: 'ETHAN' }],

  ['status is one value', { where: [cond('status', 'isAnyOf', { values: ['Success'] })] }],
  [
    'status is two values',
    { where: [cond('status', 'isAnyOf', { values: ['Success', 'Failed'] })] },
  ],
  ['status is none of one', { where: [cond('status', 'isNoneOf', { values: ['Failed'] })] }],
  [
    'two enum chips ANDed',
    {
      where: [
        cond('status', 'isAnyOf', { values: ['Success'] }),
        cond('favouriteSeason', 'isAnyOf', { values: ['Spring'] }),
      ],
    },
  ],
  ['an enum chip with nothing ticked', { where: [cond('status', 'isAnyOf')] }, 'all'],

  ['name contains', { where: [cond('name', 'contains', { value: 'a' })] }],
  ['name does not contain', { where: [cond('name', 'notContains', { value: 'a' })] }],
  ['name is', { where: [cond('name', 'is', { value: 'Ethan Noah' })] }],
  ['name is, folded', { where: [cond('name', 'is', { value: '  ETHAN NOAH ' })] }],
  ['name starts with', { where: [cond('name', 'startsWith', { value: 'A' })] }],
  ['address contains', { where: [cond('address', 'contains', { value: 'New York' })] }],
  ['a text chip with no operand', { where: [cond('name', 'contains')] }, 'all'],

  ['solved cases is', { where: [cond('solvedCases', 'is', { value: '42' })] }],
  ['solved cases at least', { where: [cond('solvedCases', 'gte', { value: '100' })] }],
  ['solved cases at most', { where: [cond('solvedCases', 'lte', { value: '50' })] }],
  ['solved cases over', { where: [cond('solvedCases', 'gt', { value: '200' })] }],
  ['solved cases under', { where: [cond('solvedCases', 'lt', { value: '10' })] }],
  [
    'solved cases between',
    { where: [cond('solvedCases', 'between', { value: '50', value2: '150' })] },
  ],
  [
    'solved cases between, typed backwards',
    { where: [cond('solvedCases', 'between', { value: '150', value2: '50' })] },
  ],
  [
    'solved cases between with one end missing',
    { where: [cond('solvedCases', 'between', { value: '50' })] },
    'all',
  ],
  [
    'solved cases against a non-number',
    { where: [cond('solvedCases', 'gte', { value: 'many' })] },
    'none',
  ],

  ['date on, in the record format', { where: [cond('date', 'on', { value: '04 March, 2026' })] }],
  ['date on, in ISO', { where: [cond('date', 'on', { value: '2026-03-04' })] }],
  ['date before', { where: [cond('date', 'before', { value: '2026-03-10' })] }],
  ['date after', { where: [cond('date', 'after', { value: '2026-03-10' })] }],
  [
    'date between',
    { where: [cond('date', 'between', { value: '2026-03-01', value2: '2026-04-01' })] },
  ],
  [
    'date against a rolled-over day',
    { where: [cond('date', 'on', { value: '31 February, 2026' })] },
    'none',
  ],
  ['date against nonsense', { where: [cond('date', 'on', { value: 'soon' })] }, 'none'],

  [
    'a chip and the search box together',
    { q: 'a', where: [cond('status', 'isAnyOf', { values: ['In progress'] })] },
  ],
  [
    'three chips of different types',
    {
      q: 'e',
      where: [
        cond('status', 'isNoneOf', { values: ['Failed'] }),
        cond('solvedCases', 'gte', { value: '20' }),
        cond('name', 'contains', { value: 'a' }),
      ],
    },
  ],
]

describe('the same rows as the component', () => {
  it.each(CASES)('%s', (_name, query, reach: Reach = 'some') => {
    const expected = clientIds(query)

    if (reach === 'none') expect(expected).toEqual([])
    else if (reach === 'all') expect(expected).toHaveLength(RECORDS.length)
    else {
      expect(expected.length).toBeGreaterThan(0)
      expect(expected.length).toBeLessThan(RECORDS.length)
    }

    agree(query)
  })
})

/* ---- sorting --------------------------------------------------------- */

const SORTS: ColumnKey[] = ['name', 'date', 'status', 'solvedCases', 'favouriteSeason', 'address']

describe('the same order as the component', () => {
  for (const sort of SORTS) {
    for (const dir of ['asc', 'desc'] as const) {
      it(`${sort} ${dir}`, () => {
        agree({ sort, dir })
      })
    }
  }

  it('keeps the table order for rows the comparator calls equal', () => {
    // `status` has three values across four hundred rows, so almost every
    // comparison is a tie — which is the case a missing tiebreak gets wrong.
    agree({ sort: 'status', dir: 'asc' })
    agree({ sort: 'favouriteSeason', dir: 'desc' })
  })

  it('sorts a filtered set the same way too', () => {
    agree({
      sort: 'solvedCases',
      dir: 'desc',
      where: [cond('status', 'isAnyOf', { values: ['Success', 'In progress'] })],
    })
    agree({ sort: 'name', dir: 'asc', q: 'a' })
  })
})

/* ---- windows --------------------------------------------------------- */

describe('windows', () => {
  const query: Partial<RecordQuery> = {
    sort: 'name',
    dir: 'asc',
    where: [cond('status', 'isNoneOf', { values: ['Failed'] })],
  }

  it('reports the matching total, not the window size', () => {
    const page = queryRecords(db, { ...EMPTY_QUERY, ...query, offset: 0, limit: 10 })
    expect(page.rows).toHaveLength(10)
    expect(page.total).toBe(clientIds(query).length)
  })

  it('walks the whole set in windows without a gap or a repeat', () => {
    const expected = clientIds(query)
    const walked: string[] = []
    for (let offset = 0; offset < expected.length; offset += 7) {
      const page = queryRecords(db, { ...EMPTY_QUERY, ...query, offset, limit: 7 })
      walked.push(...page.rows.map((r) => r.id))
    }
    expect(walked).toEqual(expected)
  })

  it('returns nothing past the end rather than failing', () => {
    const page = queryRecords(db, { ...EMPTY_QUERY, offset: 100_000, limit: 10 })
    expect(page.rows).toEqual([])
    expect(page.total).toBe(RECORDS.length)
  })
})

/* ---- the duplicated table -------------------------------------------- */

describe('the column table it had to copy', () => {
  it('types every column the way filters.ts does', () => {
    expect(COLUMN_SQL_TYPES).toEqual(COLUMN_TYPES)
  })
})

/* ---- language -------------------------------------------------------- */

describe('language', () => {
  it('changes nothing about which records a filter matches', () => {
    const where = [cond('name', 'contains', { value: 'i' })]
    expect(serverIds({ where, locale: 'en' })).toEqual(serverIds({ where, locale: 'tr' }))
  })

  it('folds the search box with the language in force', () => {
    // Not in the demo data, so it is added for the length of this test: the
    // dotted capital I is the whole reason `search_lc_tr` is a separate column.
    const record: DataTableRecord = {
      ...RECORDS[0],
      id: 'REC-TR-1',
      name: 'İSTANBUL Yönetim',
      email: 'istanbul@xyz.com',
      address: '1 Nispetiye, İSTANBUL',
    }
    const scratch = openDatabase(':memory:')
    ensureSchema(scratch)
    insertAll(scratch, [record])

    const found = (q: string, locale: 'en' | 'tr') =>
      queryRecords(scratch, { ...EMPTY_QUERY, q, locale }).rows.map((r) => r.id)

    // Typed lower case, with a dotless i, the way a Turkish keyboard gives it.
    expect(found('i̇stanbul', 'en')).toEqual(['REC-TR-1'])
    expect(found('istanbul', 'tr')).toEqual(['REC-TR-1'])
    scratch.close()
  })
})

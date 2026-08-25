/**
 * @vitest-environment node
 *
 * The two sources, asked the same questions.
 *
 * `arraySource` is the component's own derive, unchanged and covered by 359
 * behaviour tests. `createRemoteSource` is a second implementation of the same
 * contract that answers over HTTP out of SQLite — so the only question worth
 * asking of it is whether it agrees, and that is all this file asks. Every case
 * runs both and compares, which makes the array path the specification and
 * keeps it that way.
 *
 * `query.test.ts` already checks the SQL against `matchesAll` and
 * `compareCells` directly. This is the layer above: the client, the wire, the
 * mapping of a `SourceFilter` onto a query string, and the writes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'

import { ensureSchema, insertAll, openDatabase } from './db.ts'
import { createHandler } from './http.ts'
import { listRecords } from './store.ts'
import { createDemoRecords } from '../src/lib/demoData'
import { createRecordsClient, createRemoteSource } from '../src/lib/recordsApi'
import { applyToArray, arraySource } from '../src/lib/source'
import type { RecordSource, RecordsChange, SourceFilter } from '../src/lib/source'
import type { FilterCondition, FilterOp } from '../src/lib/filters'
import type { ColumnKey, DataTableRecord } from '../src/lib/types'

const RECORDS = createDemoRecords(240)

let db: DatabaseSync
let server: Server
let remote: RecordSource
let local: RecordSource

beforeAll(async () => {
  db = openDatabase(':memory:')
  ensureSchema(db)
  insertAll(db, RECORDS)

  server = createServer(createHandler(db, RECORDS.length))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  remote = createRemoteSource(createRecordsClient({ baseUrl: `http://127.0.0.1:${port}/api` }))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db.close()
})

/* Rebuilt per test so the write cases below cannot leak into one another. */
let held: DataTableRecord[]
beforeEach(() => {
  held = RECORDS.slice()
  local = arraySource(RECORDS)
  db.exec('DELETE FROM records')
  insertAll(db, RECORDS)
})

const cond = (
  key: ColumnKey,
  op: FilterOp,
  extra: Partial<FilterCondition> = {},
): FilterCondition => ({ id: `${key}:${op}`, key, op, values: [], value: '', value2: '', ...extra })

const base: SourceFilter = { q: '', where: [], sort: null, locale: 'en' }
const of = (over: Partial<SourceFilter> = {}): SourceFilter => ({ ...base, ...over })

const CASES: [string, SourceFilter][] = [
  ['no filter', of()],
  ['a search', of({ q: 'ethan' })],
  ['a search matching nothing', of({ q: 'zzzz' })],
  ['a status chip', of({ where: [cond('status', 'isAnyOf', { values: ['Success'] })] })],
  [
    'two enum chips ANDed',
    of({
      where: [
        cond('status', 'isAnyOf', { values: ['Success'] }),
        cond('favouriteSeason', 'isAnyOf', { values: ['Spring'] }),
      ],
    }),
  ],
  [
    'a number range',
    of({ where: [cond('solvedCases', 'between', { value: '20', value2: '200' })] }),
  ],
  ['a date bound', of({ where: [cond('date', 'after', { value: '2026-01-01' })] })],
  ['a text chip', of({ where: [cond('address', 'contains', { value: 'New York' })] })],
  ['sorted by name', of({ sort: { key: 'name', dir: 'asc' } })],
  ['sorted by name, descending', of({ sort: { key: 'name', dir: 'desc' } })],
  ['sorted by a count', of({ sort: { key: 'solvedCases', dir: 'desc' } })],
  ['sorted by a date', of({ sort: { key: 'date', dir: 'asc' } })],
  ['sorted by an enum, which is nearly all ties', of({ sort: { key: 'status', dir: 'asc' } })],
  ['in Turkish', of({ q: 'a', locale: 'tr' })],
  [
    'filtered, searched and sorted at once',
    of({
      q: 'a',
      where: [cond('status', 'isNoneOf', { values: ['Failed'] })],
      sort: { key: 'solvedCases', dir: 'desc' },
    }),
  ],
]

const ids = (records: DataTableRecord[]) => records.map((r) => r.id)

describe('a page', () => {
  it.each(CASES)('%s', async (_name, filter) => {
    for (const offset of [0, 8, 100]) {
      const query = { ...filter, offset, limit: 8 }
      const mine = local.page(query) as Awaited<ReturnType<RecordSource['page']>>
      const theirs = await remote.page(query)

      expect(theirs.total, 'total').toBe(mine.total)
      expect(theirs.grandTotal, 'grand total').toBe(RECORDS.length)
      expect(ids(theirs.rows), `offset ${offset}`).toEqual(ids(mine.rows))
      // Whole records, field for field — not just the right ids in the right
      // order, which a wrong `SELECT` would also pass.
      expect(theirs.rows).toEqual(mine.rows)
    }
  })

  it('walks a filtered set in windows without a gap or a repeat', async () => {
    const filter = of({ sort: { key: 'name', dir: 'asc' } })
    const everything = local.page({ ...filter, offset: 0, limit: 1000 }) as {
      rows: DataTableRecord[]
    }
    const whole = ids(everything.rows)

    const walked: string[] = []
    for (let offset = 0; offset < whole.length; offset += 7) {
      walked.push(...ids((await remote.page({ ...filter, offset, limit: 7 })).rows))
    }
    expect(walked).toEqual(whole)
  })

  it('returns nothing past the end rather than failing', async () => {
    const page = await remote.page({ ...base, offset: 10_000, limit: 8 })
    expect(page.rows).toEqual([])
    expect(page.total).toBe(RECORDS.length)
  })
})

describe('a whole column', () => {
  it.each(CASES)('%s', async (_name, filter) => {
    for (const key of ['name', 'solvedCases', 'status'] as ColumnKey[]) {
      const mine = local.columnValues(key, filter) as string[]
      const theirs = await remote.columnValues(key, filter)
      expect(theirs, key).toEqual(mine)
    }
  })

  it('is the column of the same rows the page comes from', async () => {
    const filter = of({ sort: { key: 'solvedCases', dir: 'desc' } })
    const values = await remote.columnValues('solvedCases', filter)
    const page = await remote.page({ ...filter, offset: 0, limit: 5 })
    expect(values.slice(0, 5)).toEqual(page.rows.map((r) => r.solvedCases))
  })
})

describe('records by id', () => {
  it('returns them in table order, whatever order they were asked for', async () => {
    const wanted = [RECORDS[40].id, RECORDS[2].id, RECORDS[17].id]
    expect(await remote.recordsByIds(wanted)).toEqual(local.recordsByIds(wanted))
  })

  it('says nothing for nothing, without a request', async () => {
    expect(await remote.recordsByIds([])).toEqual([])
  })

  it('skips an id the table does not hold', async () => {
    expect(await remote.recordsByIds(['REC-nope'])).toEqual([])
  })
})

describe('collecting everything', () => {
  it('pages through and comes back with the same set the array has', async () => {
    const filter = of({
      where: [cond('status', 'isAnyOf', { values: ['Success', 'In progress'] })],
      sort: { key: 'name', dir: 'asc' },
    })
    expect(await remote.collect!(filter)).toEqual(local.collect!(filter))
  })
})

describe('the next id', () => {
  it('continues the same series the array would', async () => {
    expect(await remote.nextId()).toBe(local.nextId())
  })
})

/* ---- writes ---------------------------------------------------------- */

/**
 * The property the whole arrangement rests on.
 *
 * Both sources are told what the table *did* — an edit, a delete, a new record,
 * a drag — and both have to end up holding the same list. The drag is the one
 * with a trap in it: dropping downwards lands after the target and dropping
 * upwards lands before it, and the two implementations reach that from
 * completely different places (an array splice against a float between two
 * neighbours). If they ever disagree, a reload silently reorders the table.
 */
describe('a change, applied to both', () => {
  const CHANGES: [string, (list: DataTableRecord[]) => RecordsChange][] = [
    ['an edit', (list) => ({ kind: 'update', record: { ...list[3], name: 'Edited Here' } })],
    [
      'an edit to a detail field',
      (list) => ({ kind: 'update', record: { ...list[3], note: 'seen' } }),
    ],
    ['a delete', (list) => ({ kind: 'delete', ids: [list[5].id] })],
    ['two deletes', (list) => ({ kind: 'delete', ids: [list[0].id, list[9].id] })],
    ['a new record', (list) => ({ kind: 'create', record: { ...list[0], id: 'REC-brand-new' } })],
    ['a drag downwards', (list) => ({ kind: 'move', fromId: list[1].id, toId: list[6].id })],
    ['a drag upwards', (list) => ({ kind: 'move', fromId: list[8].id, toId: list[2].id })],
    ['a drag to the very top', (list) => ({ kind: 'move', fromId: list[7].id, toId: list[0].id })],
    ['a one-place nudge down', (list) => ({ kind: 'move', fromId: list[4].id, toId: list[5].id })],
    ['a one-place nudge up', (list) => ({ kind: 'move', fromId: list[5].id, toId: list[4].id })],
  ]

  it.each(CHANGES)('%s', async (_name, make) => {
    const change = make(held)
    await remote.apply!(change)
    const expected = applyToArray(held, change)

    expect(listRecords(db)).toEqual(expected)
  })

  it('agrees over a run of drags, not just one', async () => {
    let expected = held
    const drags: [number, number][] = [
      [0, 5],
      [9, 1],
      [3, 4],
      [7, 0],
      [2, 8],
    ]
    for (const [from, to] of drags) {
      const change: RecordsChange = {
        kind: 'move',
        fromId: expected[from].id,
        toId: expected[to].id,
      }
      await remote.apply!(change)
      expected = applyToArray(expected, change)
      expect(ids(listRecords(db))).toEqual(ids(expected))
    }
  })

  it('puts a new record where the draft row puts it — at the top', async () => {
    await remote.apply!({ kind: 'create', record: { ...held[0], id: 'REC-top' } })
    expect(listRecords(db)[0].id).toBe('REC-top')
  })
})

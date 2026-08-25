import { describe, expect, it, vi } from 'vitest'

import { createDemoRecords } from './demoData'
import {
  applyToArray,
  arraySource,
  deriveRecords,
  filterKey,
  nextRecordId,
  queryKey,
} from './source'
import type { RecordsChange, SourceFilter, SourcePage } from './source'
import type { FilterCondition, FilterOp } from './filters'
import type { ColumnKey, DataTableRecord } from './types'

const RECORDS = createDemoRecords(40)
const ids = (records: DataTableRecord[]) => records.map((r) => r.id)

const base: SourceFilter = { q: '', where: [], sort: null, locale: 'en' }
const of = (over: Partial<SourceFilter> = {}): SourceFilter => ({ ...base, ...over })

const cond = (
  key: ColumnKey,
  op: FilterOp,
  extra: Partial<FilterCondition> = {},
): FilterCondition => ({ id: 'f1', key, op, values: [], value: '', value2: '', ...extra })

describe('the derive', () => {
  it('filters by the chips, then by the search, then sorts', () => {
    const out = deriveRecords(
      RECORDS,
      of({
        q: 'a',
        where: [cond('status', 'isAnyOf', { values: ['Success'] })],
        sort: { key: 'name', dir: 'asc' },
      }),
    )

    expect(out.every((r) => r.status === 'Success')).toBe(true)
    expect(out.every((r) => `${r.name} ${r.email} ${r.address}`.toLowerCase().includes('a'))).toBe(
      true,
    )
    expect(ids(out)).toEqual(ids([...out].sort((x, y) => x.name.localeCompare(y.name, 'en-GB'))))
  })

  it('leaves the order alone when nothing is sorted', () => {
    expect(ids(deriveRecords(RECORDS, of()))).toEqual(ids(RECORDS))
  })

  it('does not mutate what it was given', () => {
    const copy = RECORDS.slice()
    deriveRecords(RECORDS, of({ sort: { key: 'name', dir: 'desc' } }))
    expect(RECORDS).toEqual(copy)
  })

  it('compares counts as numbers and everything else as text', () => {
    const numbers = deriveRecords(RECORDS, of({ sort: { key: 'solvedCases', dir: 'asc' } })).map(
      (r) => Number(r.solvedCases),
    )
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('folds the search with the language in force', () => {
    const holder: DataTableRecord = { ...RECORDS[0], id: 'REC-tr', name: 'İSTANBUL Ofis' }
    const list = [holder, ...RECORDS]
    // A dotless i is what a Turkish keyboard gives, and only the Turkish fold
    // makes the capital match it.
    expect(deriveRecords(list, of({ q: 'istanbul', locale: 'tr' }))).toHaveLength(1)
    expect(deriveRecords(list, of({ q: 'istanbul', locale: 'en' }))).toHaveLength(0)
  })
})

describe('the array source', () => {
  it('slices a page and reports both counts', () => {
    const source = arraySource(RECORDS)
    const page = source.page({ ...base, offset: 8, limit: 8 }) as SourcePage

    expect(page).toMatchObject({ total: RECORDS.length, grandTotal: RECORDS.length })
    expect(ids(page.rows)).toEqual(ids(RECORDS.slice(8, 16)))
  })

  it('separates the two counts once a filter is on', () => {
    const source = arraySource(RECORDS)
    const filter = of({ where: [cond('status', 'isAnyOf', { values: ['Failed'] })] })
    const page = source.page({ ...filter, offset: 0, limit: 8 }) as SourcePage

    expect(page.grandTotal).toBe(RECORDS.length)
    expect(page.total).toBeLessThan(RECORDS.length)
    expect(page.total).toBe(RECORDS.filter((r) => r.status === 'Failed').length)
  })

  it('says it is synchronous, and is', () => {
    const source = arraySource(RECORDS)
    expect(source.synchronous).toBe(true)
    // No thenable anywhere: this is what lets the component render in one pass.
    expect(source.page({ ...base, offset: 0, limit: 4 })).not.toHaveProperty('then')
    expect(source.columnValues('name', base)).not.toHaveProperty('then')
    expect(source.nextId()).not.toHaveProperty('then')
  })

  it('answers the page and the column beside it from one derive', () => {
    const source = arraySource(RECORDS)
    const filter = of({ sort: { key: 'name', dir: 'asc' } })

    const page = source.page({ ...filter, offset: 0, limit: 8 }) as { rows: DataTableRecord[] }
    const values = source.columnValues('name', filter) as string[]

    // The column is the same set in the same order the page was sliced out of,
    // which is the property the cache has to preserve to be worth having.
    expect(values).toHaveLength(RECORDS.length)
    expect(values.slice(0, 8)).toEqual(page.rows.map((r) => r.name))
  })

  it('never serves one filter answer to a different filter', () => {
    const source = arraySource(RECORDS)
    const failed = source.columnValues(
      'status',
      of({ where: [cond('status', 'isAnyOf', { values: ['Failed'] })] }),
    ) as string[]
    const everything = source.columnValues('status', of()) as string[]

    expect(new Set(failed)).toEqual(new Set(['Failed']))
    expect(everything).toHaveLength(RECORDS.length)
  })

  it('looks records up by id in table order', () => {
    const source = arraySource(RECORDS)
    const wanted = [RECORDS[9].id, RECORDS[1].id]
    expect(ids(source.recordsByIds(wanted) as DataTableRecord[])).toEqual([
      RECORDS[1].id,
      RECORDS[9].id,
    ])
  })

  it('hands its whole list over for a snapshot, and a remote one would not', () => {
    expect(arraySource(RECORDS).snapshot?.()).toEqual(RECORDS)
  })

  it('is read-only without an onChange', () => {
    expect(arraySource(RECORDS).apply).toBeUndefined()
  })

  it('reports the next array to onChange rather than mutating', () => {
    const onChange = vi.fn()
    const source = arraySource(RECORDS, onChange)
    source.apply?.({ kind: 'delete', ids: [RECORDS[0].id] })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toHaveLength(RECORDS.length - 1)
    expect(RECORDS).toHaveLength(40)
  })
})

describe('applying a change to an array', () => {
  const CASES: [string, RecordsChange, (next: DataTableRecord[]) => void][] = [
    [
      'an edit replaces in place',
      { kind: 'update', record: { ...RECORDS[3], name: 'Edited' } },
      (next) => {
        expect(next[3].name).toBe('Edited')
        expect(ids(next)).toEqual(ids(RECORDS))
      },
    ],
    [
      'a delete removes and nothing else',
      { kind: 'delete', ids: [RECORDS[2].id] },
      (next) => expect(ids(next)).toEqual(ids(RECORDS.filter((_, i) => i !== 2))),
    ],
    [
      'a create goes to the top, where the draft row commits',
      { kind: 'create', record: { ...RECORDS[0], id: 'REC-new' } },
      (next) => expect(next[0].id).toBe('REC-new'),
    ],
    [
      'a drag downwards lands after its target',
      { kind: 'move', fromId: RECORDS[1].id, toId: RECORDS[5].id },
      (next) => expect(ids(next).indexOf(RECORDS[1].id)).toBe(ids(next).indexOf(RECORDS[5].id) + 1),
    ],
    [
      'a drag upwards lands before its target',
      { kind: 'move', fromId: RECORDS[6].id, toId: RECORDS[2].id },
      (next) => expect(ids(next).indexOf(RECORDS[6].id)).toBe(ids(next).indexOf(RECORDS[2].id) - 1),
    ],
  ]

  it.each(CASES)('%s', (_name, change, check) => {
    const next = applyToArray(RECORDS, change)
    check(next)
    expect(next).not.toBe(RECORDS)
    expect(RECORDS).toHaveLength(40)
  })

  it('ignores a drag naming a row it does not hold', () => {
    expect(applyToArray(RECORDS, { kind: 'move', fromId: 'REC-nope', toId: RECORDS[0].id })).toBe(
      RECORDS,
    )
  })
})

describe('the next id', () => {
  it('continues the REC series from the highest one held', () => {
    expect(nextRecordId(['REC-4813', 'REC-4820'])).toBe('REC-4827')
  })

  it('falls back to the seed when nothing matches the pattern', () => {
    expect(nextRecordId(['a1b2', 'uuid-x'])).toBe('REC-4820')
  })

  it('reads only the ids that really are REC-<int>', () => {
    expect(nextRecordId(['REC-4813', 'REC-99999999999999999999', 'REC-12abc'])).toBe('REC-4820')
  })

  it('survives a hundred thousand ids, which spreading them would not', () => {
    const many = Array.from({ length: 100_000 }, (_, i) => `REC-${4813 + i * 7}`)
    expect(() => nextRecordId(many)).not.toThrow()
    expect(nextRecordId(many)).toBe(`REC-${4813 + 99_999 * 7 + 7}`)
  })
})

describe('keys', () => {
  it('ignores a condition id, which is a React key and not part of the filter', () => {
    const a = of({ where: [{ ...cond('name', 'contains', { value: 'x' }), id: 'f1' }] })
    const b = of({ where: [{ ...cond('name', 'contains', { value: 'x' }), id: 'f99' }] })
    expect(filterKey(a)).toBe(filterKey(b))
  })

  it('changes when anything that decides the answer changes', () => {
    const start = filterKey(of())
    expect(filterKey(of({ q: 'a' }))).not.toBe(start)
    expect(filterKey(of({ locale: 'tr' }))).not.toBe(start)
    expect(filterKey(of({ sort: { key: 'name', dir: 'asc' } }))).not.toBe(start)
    expect(filterKey(of({ where: [cond('name', 'contains', { value: 'x' })] }))).not.toBe(start)
  })

  it('treats a trimmed search as the same search', () => {
    expect(filterKey(of({ q: '  ethan  ' }))).toBe(filterKey(of({ q: 'ethan' })))
  })

  it('separates two windows of one filter', () => {
    expect(queryKey({ ...base, offset: 0, limit: 8 })).not.toBe(
      queryKey({ ...base, offset: 8, limit: 8 }),
    )
  })
})

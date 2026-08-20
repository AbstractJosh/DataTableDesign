/**
 * The filter engine on its own.
 *
 * The dock's behaviour is covered through the component in DataTable.test.tsx;
 * this file pins the rules that are far easier to state than to drive through a
 * popup — the date parser's two formats, and the "no operand filters nothing"
 * rule the whole feature rests on.
 */
import { describe, expect, it } from 'vitest'

import { createDemoRecords } from './demoData'
import {
  describeCondition,
  isActive,
  matchesAll,
  newCondition,
  parseTableDate,
  type FilterCondition,
} from './filters'
import type { ColumnKey, DataTableRecord } from './types'

/** A condition built the way the reducer builds one, then patched. */
const condition = (key: ColumnKey, patch: Partial<FilterCondition> = {}): FilterCondition => ({
  ...newCondition(key),
  ...patch,
})

const record = (patch: Partial<DataTableRecord> = {}): DataTableRecord => ({
  ...createDemoRecords()[0],
  ...patch,
})

const names = (conditions: FilterCondition[]) =>
  createDemoRecords()
    .filter((r) => matchesAll(r, conditions))
    .map((r) => r.name)

describe('parseTableDate', () => {
  const AUG_19 = Date.UTC(2026, 7, 19)

  it('reads the record format without leaning on the host locale', () => {
    // `new Date('19 August, 2026')` is implementation-defined; the month table
    // is what keeps a record filtering identically everywhere.
    expect(parseTableDate('19 August, 2026')).toBe(AUG_19)
    expect(parseTableDate('19 august 2026')).toBe(AUG_19)
    expect(parseTableDate('  19 AUGUST , 2026 ')).toBe(AUG_19)
  })

  it('reads the ISO an <input type="date"> hands back, to the same instant', () => {
    expect(parseTableDate('2026-08-19')).toBe(AUG_19)
    expect(parseTableDate('2026-8-19')).toBe(AUG_19)
  })

  it('is UTC, so the two shapes never land either side of a DST boundary', () => {
    expect(new Date(parseTableDate('2026-08-19') as number).getUTCHours()).toBe(0)
    expect(parseTableDate('2026-08-19')).toBe(parseTableDate('19 August, 2026'))
  })

  it('returns null for anything it cannot place, rather than guessing', () => {
    expect(parseTableDate('')).toBeNull()
    expect(parseTableDate('   ')).toBeNull()
    expect(parseTableDate('tomorrow')).toBeNull()
    expect(parseTableDate('19/08/2026')).toBeNull()
    expect(parseTableDate('19 Augustus, 2026')).toBeNull()
    expect(parseTableDate('2026-13-01')).toBeNull()
    // a rolled-over day is refused rather than silently shifted into March
    expect(parseTableDate('31 February, 2026')).toBeNull()
  })
})

describe('isActive', () => {
  it('is false for an enum with nothing ticked', () => {
    expect(isActive(condition('status'))).toBe(false)
    expect(isActive(condition('status', { values: ['Failed'] }))).toBe(true)
  })

  it('is false for a blank text, number or date operand', () => {
    expect(isActive(condition('name'))).toBe(false)
    expect(isActive(condition('name', { value: '   ' }))).toBe(false)
    expect(isActive(condition('name', { value: 'a' }))).toBe(true)
    // "0" is a real operand, not an empty one
    expect(isActive(condition('solvedCases', { op: 'is', value: '0' }))).toBe(true)
  })

  it('wants both ends of a between: one end alone is nothing, not half a range', () => {
    expect(isActive(condition('solvedCases', { op: 'between', value: '10' }))).toBe(false)
    expect(isActive(condition('solvedCases', { op: 'between', value2: '20' }))).toBe(false)
    expect(
      isActive(condition('solvedCases', { op: 'between', value: '10', value2: '20' })),
    ).toBe(true)
  })
})

describe('describeCondition', () => {
  it('says Any while the condition is inert', () => {
    expect(describeCondition(condition('status'))).toBe('Any')
    expect(describeCondition(condition('name'))).toBe('Any')
  })

  it('lists an enum, and names the negation', () => {
    expect(describeCondition(condition('status', { values: ['Success', 'Failed'] }))).toBe(
      'Success, Failed',
    )
    expect(
      describeCondition(condition('status', { op: 'isNoneOf', values: ['Failed'] })),
    ).toBe('None of: Failed')
  })

  it('reads left to right after the column label, and does not shout', () => {
    // the chip uppercases it in CSS, so the string itself stays sentence case
    expect(describeCondition(condition('name', { op: 'contains', value: 'hart' }))).toBe(
      'contains hart',
    )
    expect(describeCondition(condition('name', { op: 'notContains', value: ' hart ' }))).toBe(
      'does not contain hart',
    )
    expect(
      describeCondition(condition('solvedCases', { op: 'between', value: '10', value2: '20' })),
    ).toBe('is between 10 and 20')
  })
})

describe('matchesAll', () => {
  it('matches everything with no conditions', () => {
    expect(names([])).toHaveLength(17)
  })

  it('ANDs the active conditions and skips the rest', () => {
    const conditions = [
      condition('status', { values: ['Success'] }),
      condition('favouriteSeason', { values: ['Spring'] }),
      // dropped in but not filled in yet — it must not narrow anything
      condition('name', { op: 'contains', value: '' }),
    ]
    expect(names(conditions)).toEqual(['Ethan Noah', 'Naomi Castillo', 'Victor Ilyin'])
  })

  it('reads an enum as a union within one condition', () => {
    expect(names([condition('status', { values: ['Success', 'Failed'] })])).toHaveLength(11)
    expect(names([condition('status', { op: 'isNoneOf', values: ['Success'] })])).toHaveLength(9)
  })

  it('compares numbers as numbers, either way round', () => {
    const forward = condition('solvedCases', { op: 'between', value: '100', value2: '200' })
    const backward = condition('solvedCases', { op: 'between', value: '200', value2: '100' })
    const expected = ['Tunc Yanik', 'Daniel Osei', 'Hana Sato', 'Victor Ilyin']
    expect(names([forward])).toEqual(expected)
    expect(names([backward])).toEqual(expected)
  })

  it('compares dates as dates, which the column sort deliberately does not', () => {
    // "02 April, 2026" sorts below "18 March, 2026" as text — the prototype's
    // lexicographic sort is kept on purpose — but the filter parses both.
    expect(names([condition('date', { op: 'after', value: '2026-03-18' })])).toEqual([
      'Tunc Yanik', 'Priya Anand', 'Tomas Berger', 'Julien Moreau', 'Samir Haddad',
    ])
    expect(names([condition('date', { op: 'on', value: '19 August, 2026' })])).toEqual([
      'Tunc Yanik',
    ])
  })

  it('reads a date between inclusively, and either way round', () => {
    // both ends land exactly on a record's date, so inclusive or not is visible
    const forward = condition('date', { op: 'between', value: '2026-03-10', value2: '2026-03-18' })
    const backward = condition('date', { op: 'between', value: '2026-03-18', value2: '2026-03-10' })
    expect(names([forward])).toEqual(names([backward]))
    expect(names([forward])).toEqual([
      'Amelia Hart', 'Marcus Reed', 'Daniel Osei', 'Clara Whitfield',
      'Owen Fletcher', 'Hana Sato', 'Victor Ilyin', 'Mia Donnelly',
    ])
  })

  it('fails a row it cannot place rather than passing it through', () => {
    const odd = record({ solvedCases: 'many', date: 'whenever' })
    expect(matchesAll(odd, [condition('solvedCases', { op: 'gte', value: '1' })])).toBe(false)
    expect(matchesAll(odd, [condition('date', { op: 'before', value: '2026-01-01' })])).toBe(false)
    // and a half-typed operand fails the same way, on a perfectly good row
    expect(matchesAll(record(), [condition('solvedCases', { op: 'gt', value: 'x' })])).toBe(false)
  })

  it('matches text case- and whitespace-insensitively', () => {
    expect(names([condition('name', { op: 'contains', value: '  HART ' })])).toEqual([
      'Amelia Hart',
    ])
    expect(names([condition('name', { op: 'startsWith', value: 'M' })])).toEqual([
      'Marcus Reed', 'Mia Donnelly',
    ])
    expect(names([condition('name', { op: 'is', value: 'tunc yanik' })])).toEqual(['Tunc Yanik'])
  })
})

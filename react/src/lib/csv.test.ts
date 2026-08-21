/**
 * The export's pure half — the quoting, the text, the naming. The flow that
 * drives them (the bar, the box, the save) is the "CSV export" describe in
 * DataTable.test.tsx.
 */
import { describe, expect, it } from 'vitest'

import {
  csvCell,
  csvFileName,
  defaultExportName,
  planCsv,
  planSize,
  slug,
  toCsv,
  type ExportPlan,
} from './csv'
import { createDemoRecords } from './demoData'
import type { DataTableRecord } from './types'

const RECORDS = createDemoRecords()

const record = (patch: Partial<DataTableRecord>): DataTableRecord => ({
  ...RECORDS[0],
  ...patch,
})

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Tunc Yanik')).toBe('Tunc Yanik')
    expect(csvCell('')).toBe('')
    expect(csvCell('12')).toBe('12')
  })

  it('quotes a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('Hart, Amelia')).toBe('"Hart, Amelia"')
    expect(csvCell('the "good" one')).toBe('"the ""good"" one"')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"')
  })

  it('quotes a value a spreadsheet would silently trim', () => {
    expect(csvCell(' leading')).toBe('" leading"')
    expect(csvCell('trailing ')).toBe('"trailing "')
  })
})

describe('toCsv', () => {
  it('joins cells with commas and records with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('has no trailing line break', () => {
    expect(toCsv([['a']])).toBe('a')
  })
})

describe('planCsv', () => {
  const plan: ExportPlan = {
    source: 'cells',
    columns: ['name', 'solvedCases'],
    records: [record({ name: 'Ada', solvedCases: '4' }), record({ name: 'Grace', solvedCases: '9' })],
  }

  it('writes the column labels first, then the cells', () => {
    expect(planCsv(plan)).toBe('Name,Solved cases\r\nAda,4\r\nGrace,9')
  })

  it('follows the column order it is given, not the declared one', () => {
    expect(planCsv({ ...plan, columns: ['solvedCases', 'name'] })).toBe(
      'Solved cases,Name\r\n4,Ada\r\n9,Grace',
    )
  })

  it('writes a header row and nothing else for an empty plan', () => {
    expect(planCsv({ ...plan, records: [] })).toBe('Name,Solved cases')
  })

  it('counts cells without the header row', () => {
    expect(planSize(plan)).toBe(4)
  })
})

describe('slug and defaultExportName', () => {
  it('folds anything that is not alphanumeric to single hyphens', () => {
    expect(slug('Solved cases')).toBe('solved-cases')
    expect(slug('  Records / Directory  ')).toBe('records-directory')
    expect(slug('!!!')).toBe('')
  })

  const plan = (patch: Partial<ExportPlan>): ExportPlan => ({
    source: 'rows',
    columns: ['name'],
    records: [],
    ...patch,
  })

  it('names a row export by how many records went into it', () => {
    expect(defaultExportName(plan({ records: RECORDS.slice(0, 3) }), 'Data table')).toBe(
      'data-table-3-records',
    )
    expect(defaultExportName(plan({ records: RECORDS.slice(0, 1) }), 'Data table')).toBe(
      'data-table-1-record',
    )
  })

  it('names a column export after the column', () => {
    expect(
      defaultExportName(plan({ source: 'column', columns: ['solvedCases'] }), 'Data table'),
    ).toBe('data-table-solved-cases')
  })

  it('falls back when the title slugs away to nothing', () => {
    expect(defaultExportName(plan({ source: 'cells' }), '···')).toBe('data-table-cells')
  })
})

describe('csvFileName', () => {
  it('puts the suffix on', () => {
    expect(csvFileName('quarterly')).toBe('quarterly.csv')
  })

  it('never puts on a second one', () => {
    expect(csvFileName('quarterly.csv')).toBe('quarterly.csv')
    expect(csvFileName('quarterly.CSV')).toBe('quarterly.csv')
    expect(csvFileName('quarterly.csv.csv')).toBe('quarterly.csv')
  })

  it('keeps spaces but folds the characters a file name may not carry', () => {
    expect(csvFileName('Q3 report')).toBe('Q3 report.csv')
    expect(csvFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.csv')
    expect(csvFileName('drop\u0007the\u001fcontrols')).toBe('dropthecontrols.csv')
  })

  it('cannot be talked into a path or a dotfile', () => {
    expect(csvFileName('../../etc/passwd')).toBe('etc-passwd.csv')
    expect(csvFileName('.hidden')).toBe('hidden.csv')
  })

  it('saves rather than refuses when the box is empty', () => {
    expect(csvFileName('')).toBe('export.csv')
    expect(csvFileName('   ')).toBe('export.csv')
    expect(csvFileName('.csv')).toBe('export.csv')
  })
})

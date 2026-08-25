/**
 * The table driven by an asynchronous `RecordSource`.
 *
 * Everything else in this folder tests the array path, which is the default and
 * is unchanged. This is the other one: the table asks for the page it is about
 * to draw, waits, and draws it — so what is worth asserting is not *what* it
 * shows (the two sources agree, and `server/source.test.ts` proves it) but
 * **what it asked for**. A windowed table that quietly requests every record is
 * a windowed table in name only, and nothing on screen would give it away.
 *
 * So the fake below counts and records every call, and most of these tests are
 * about the call log.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable } from './DataTable'
import { createDemoRecords } from './demoData'
import { arraySource } from './source'
import type { RecordSource, RecordsChange, SourceFilter, SourceQuery } from './source'
import type { ColumnKey, DataTableRecord } from './types'

const RECORDS = createDemoRecords(120)

interface Log {
  pages: SourceQuery[]
  columns: { key: ColumnKey; filter: SourceFilter }[]
  byIds: string[][]
  collects: number
  changes: RecordsChange[]
}

/**
 * An asynchronous source over an array, so the answers are the array path's
 * answers and only the *timing* is under test.
 *
 * Resolved with `Promise.resolve` rather than a timer: the debounce being
 * measured belongs to the table, and putting a second delay in the source would
 * make every assertion below wait on the wrong thing.
 */
function fakeSource(records = RECORDS, options: { fail?: boolean } = {}) {
  const held = { current: records }
  const log: Log = { pages: [], columns: [], byIds: [], collects: 0, changes: [] }

  const behind = () => arraySource(held.current)

  const source: RecordSource = {
    synchronous: false,
    async page(query) {
      log.pages.push(query)
      if (options.fail) throw new Error('the database is on fire')
      return behind().page(query) as never
    },
    async columnValues(key, filter) {
      log.columns.push({ key, filter })
      return behind().columnValues(key, filter) as string[]
    },
    async recordsByIds(ids) {
      log.byIds.push(ids)
      return behind().recordsByIds(ids) as DataTableRecord[]
    },
    async collect(filter) {
      log.collects += 1
      return behind().collect!(filter) as DataTableRecord[]
    },
    async nextId() {
      return behind().nextId() as string
    },
    async apply(change) {
      log.changes.push(change)
      const next = arraySource(held.current, (list) => {
        held.current = list
      })
      await next.apply!(change)
    },
  }

  return { source, log, held }
}

const setup = (over: Partial<React.ComponentProps<typeof DataTable>> = {}, fake = fakeSource()) => {
  // `delay: null` so a burst of keystrokes lands inside the table's own
  // debounce window rather than being spread across it by the test.
  const user = userEvent.setup({ delay: null })
  render(<DataTable motion="never" source={fake.source} {...over} />)
  return { user, ...fake }
}

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('tbody[data-id]')).map((el) => el.dataset.id)
const stat = (label: string) =>
  Array.from(document.querySelectorAll('.dt-stats > div'))
    .find((el) => el.querySelector('.dt-stat-label')?.textContent === label)
    ?.querySelector('.dt-stat-value')?.textContent

const settled = () => waitFor(() => expect(rows().length).toBeGreaterThan(0))

describe('the first page', () => {
  it('stands rows in until one arrives, then replaces them', async () => {
    setup()
    // Row-shaped, and as many as the page will hold, so nothing jumps.
    expect(document.querySelectorAll('.dt-skeleton-row')).toHaveLength(8)
    expect(screen.queryByText('No records match')).not.toBeInTheDocument()

    await settled()
    expect(document.querySelectorAll('.dt-skeleton-row')).toHaveLength(0)
    expect(rows()).toEqual(RECORDS.slice(0, 8).map((r) => r.id))
  })

  it('asks for one page and nothing else', async () => {
    const { log } = setup()
    await settled()

    expect(log.pages).toHaveLength(1)
    expect(log.pages[0]).toMatchObject({ offset: 0, limit: 8, q: '', where: [], sort: null })
    // The three questions that are bigger than a page are not asked until
    // something on screen needs them.
    expect(log.columns).toHaveLength(0)
    expect(log.collects).toBe(0)
    expect(log.byIds).toHaveLength(0)
  })

  it('takes both counts from the source, not from what it holds', async () => {
    setup()
    await settled()
    // 120 records, none filtered out — and only eight of them ever arrived.
    expect(stat('Total')).toBe('120')
    expect(stat('Matching')).toBe('120')
    expect(screen.getByText(/of.*120.*entries/)).toBeInTheDocument()
  })
})

describe('the pager', () => {
  it('moves the window rather than slicing something it holds', async () => {
    const { user, log } = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: /^Page 4 of / }))
    await waitFor(() => expect(rows()).toEqual(RECORDS.slice(24, 32).map((r) => r.id)))

    expect(log.pages.at(-1)).toMatchObject({ offset: 24, limit: 8 })
  })

  it('does not wait out the search debounce to turn a page', async () => {
    const { user, log } = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: /^Page 2 of / }))
    // No `waitFor`: the request is made in the effect the click commits, and a
    // page turn is never delayed. Only a changed *filter* waits — the test
    // above shows what that buys, and this shows what it does not cost.
    expect(log.pages).toHaveLength(2)
    expect(log.pages[1]).toMatchObject({ offset: 8, q: '' })
  })
})

describe('the search box', () => {
  it('coalesces a burst of keystrokes into one query', async () => {
    const { user, log } = setup()
    await settled()
    const before = log.pages.length

    await user.type(screen.getByPlaceholderText(/search/i), 'ethan')

    await waitFor(() => expect(log.pages.length).toBeGreaterThan(before))
    // One query for the word, not one per letter.
    expect(log.pages.length - before).toBe(1)
    expect(log.pages.at(-1)?.q).toBe('ethan')
  })

  it('keeps the previous rows on screen while the next ones load', async () => {
    const { user } = setup()
    await settled()
    const before = rows()

    await user.type(screen.getByPlaceholderText(/search/i), 'ethan')
    // Still the old page, and marked busy rather than blanked.
    expect(rows()).toEqual(before)

    await waitFor(() =>
      expect(document.querySelector('.dt-root')).not.toHaveAttribute('aria-busy'),
    )
  })

  it('sends the sort to the source instead of sorting what it has', async () => {
    const { user, log } = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    await waitFor(() => expect(log.pages.at(-1)?.sort).toEqual({ key: 'name', dir: 'asc' }))
    expect(log.pages.at(-1)).toMatchObject({ offset: 0, limit: 8 })
  })
})

describe('a whole column', () => {
  const label = (key: string) =>
    document.querySelector(`th[data-key="${key}"] .dt-th-label`) as HTMLElement

  it('asks for that column and no records at all', async () => {
    const { user, log } = setup()
    await settled()

    await user.tripleClick(label('solvedCases'))
    await waitFor(() => expect(log.columns.length).toBeGreaterThan(0))

    // Once for the gesture, not once for the reading and again for the
    // announcement — both read the same fetch.
    expect(log.columns).toHaveLength(1)
    expect(log.columns[0].key).toBe('solvedCases')
    // The reading covers every matching row, and the rows themselves were
    // never fetched to produce it.
    expect(log.collects).toBe(0)
    await waitFor(() =>
      expect(document.querySelector('.dt-sum-value')?.textContent).toBeTruthy(),
    )
  })

  it('reads over every matching row, not over the page', async () => {
    const { user } = setup()
    await settled()

    await user.tripleClick(label('solvedCases'))
    const expected = RECORDS.reduce((sum, r) => sum + Number(r.solvedCases), 0)

    await waitFor(() =>
      expect(document.querySelector('.dt-sum-value')?.textContent).toBe(
        expected.toLocaleString('en-GB'),
      ),
    )
  })

  it('fetches once per column, and releases the one before it', async () => {
    const { user, log } = setup()
    await settled()

    await user.tripleClick(label('name'))
    await waitFor(() => expect(log.columns).toHaveLength(1))

    await user.tripleClick(label('address'))
    await waitFor(() => expect(log.columns).toHaveLength(2))

    expect(log.columns.map((c) => c.key)).toEqual(['name', 'address'])
    // One column is taken at a time, so the first one's values are no longer
    // held — the header says so, and nothing re-fetched to find out.
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(1)
    expect(document.querySelector('th.dt-col-picked')).toHaveAttribute('data-key', 'address')
  })
})

describe('writing', () => {
  it('reports a delete as a delete and re-queries after it', async () => {
    const { user, log, held } = setup()
    await settled()

    const doomed = rows()[0]!
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(log.changes).toEqual([{ kind: 'delete', ids: [doomed] }]))
    await waitFor(() => expect(rows()).not.toContain(doomed))
    expect(held.current).toHaveLength(RECORDS.length - 1)
  })

  it('takes a new record’s id from the source', async () => {
    const { user, log } = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: 'New record' }))
    await user.type(screen.getByPlaceholderText('Name'), 'Someone New')
    await user.click(screen.getByRole('button', { name: 'Save record' }))

    await waitFor(() => expect(log.changes).toHaveLength(1))
    const change = log.changes[0]
    expect(change.kind).toBe('create')
    // 120 records, the series being REC-4820 + 7i from the sixteenth.
    if (change.kind === 'create') expect(change.record.id).toMatch(/^REC-\d+$/)
  })

  it('exports the ticked rows by asking for them by id', async () => {
    const { user, log } = setup()
    await settled()

    // By name, not by position: the header's own box is also called "Select …"
    // and is the first of them.
    await user.click(screen.getByRole('button', { name: `Select ${RECORDS[0].name}` }))
    await user.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(log.byIds).toHaveLength(1))
    expect(log.byIds[0]).toHaveLength(1)
    // Ticked rows are whole records, so nothing had to be collected.
    expect(log.collects).toBe(0)
  })
})

describe('when the source cannot answer', () => {
  it('says the query failed rather than reporting an empty table', async () => {
    render(<DataTable motion="never" source={fakeSource(RECORDS, { fail: true }).source} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the records')
    expect(alert).toHaveTextContent('the database is on fire')
    expect(screen.queryByText('No records match')).not.toBeInTheDocument()
  })
})

describe('an array still works exactly as it did', () => {
  it('renders on the first pass, with no loading state and no waiting', () => {
    render(<DataTable motion="never" records={RECORDS} />)
    // No `await` anywhere: this is the whole point of a synchronous source.
    expect(rows()).toEqual(RECORDS.slice(0, 8).map((r) => r.id))
    expect(document.querySelectorAll('.dt-skeleton-row')).toHaveLength(0)
    expect(within(document.body).getByText(/of.*120.*entries/)).toBeInTheDocument()
  })

  it('is what a component with no props at all uses', () => {
    render(<DataTable motion="never" />)
    expect(rows().length).toBeGreaterThan(0)
  })
})

describe('a source that cannot be written to', () => {
  it('leaves the table readable rather than throwing on an edit', async () => {
    const readOnly = fakeSource()
    const stripped: RecordSource = { ...readOnly.source, apply: undefined }
    const user = userEvent.setup({ delay: null })
    render(<DataTable motion="never" source={stripped} />)
    await settled()

    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await expect(
      user.click(screen.getByRole('button', { name: 'Confirm delete' })),
    ).resolves.not.toThrow()
    expect(rows().length).toBe(8)
  })
})

/* Kept honest: the fake above must be answering with the array path's answers,
   or every comparison in this file is against itself. */
describe('the fake source', () => {
  it('answers what the array source answers', async () => {
    const { source } = fakeSource()
    const query = { q: '', where: [], sort: null, locale: 'en' as const, offset: 8, limit: 8 }
    const mine = arraySource(RECORDS).page(query)
    await expect(source.page(query)).resolves.toEqual(mine)
    expect(vi.isMockFunction(source.page)).toBe(false)
  })
})

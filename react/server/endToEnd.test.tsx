/**
 * @vitest-environment jsdom
 *
 * The whole stack, from the click to the SQL.
 *
 * Every other test here cuts the stack somewhere: `query.test.ts` stops below
 * HTTP, `source.test.ts` stops below React, `DataTable.source.test.tsx` stops
 * above the wire with a fake in its place. Each of those is the right place to
 * find a bug. None of them would notice if the three fitted together wrongly —
 * a relative URL that never resolves, a parameter the client sends and the
 * router ignores, a count that arrives as a string.
 *
 * So this one is short and end to end: a real `node:sqlite` database, a real
 * `node:http` server on a real port, the real client, and the real component
 * rendered into a real DOM. It asserts what a person would see.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'

import { ensureSchema, insertAll, openDatabase } from './db.ts'
import { createHandler } from './http.ts'
import { listRecords } from './store.ts'
import { DataTable } from '../src/lib/DataTable'
import { createDemoRecords } from '../src/lib/demoData'
import { createRecordsClient, createRemoteSource } from '../src/lib/recordsApi'
import type { RecordSource } from '../src/lib/source'

const RECORDS = createDemoRecords(240)

let db: DatabaseSync
let server: Server
let source: RecordSource

beforeAll(async () => {
  db = openDatabase(':memory:')
  ensureSchema(db)

  server = createServer(createHandler(db, RECORDS.length))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  // Absolute, because jsdom has no origin a relative `/api` could hang off.
  // The browser resolves it against the page and Vite proxies it; here there
  // is no page, so the port is named.
  source = createRemoteSource(
    createRecordsClient({ baseUrl: `http://127.0.0.1:${port}/api`, fetch: bridged }),
  )
})

/**
 * `fetch` with the abort signal carried across by hand.
 *
 * A jsdom quirk and nothing to do with the component: `AbortController` here is
 * jsdom's and `fetch` is Node's, so undici refuses the signal it is handed —
 * "Expected signal to be an instance of AbortSignal" — because the two come
 * from different realms. In a browser they are the same object. So the signal
 * is taken off the request and raced against it instead, which keeps abort
 * meaning what it means for the tests below without pretending the mismatch
 * away.
 */
const bridged: typeof globalThis.fetch = (input, init) => {
  const { signal, ...rest } = init ?? {}
  if (!signal) return fetch(input, rest)
  const stop = () => new DOMException('Aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(stop())
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(stop()), { once: true })
    fetch(input, rest).then(resolve, reject)
  })
}

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM records')
  insertAll(db, RECORDS)
})

const setup = () => {
  const user = userEvent.setup({ delay: null })
  render(<DataTable motion="never" source={source} />)
  return user
}

/** The first data column of each row on screen, which is Name. */
const rowNames = () =>
  Array.from(document.querySelectorAll<HTMLElement>('tbody[data-id] td[data-col="0"]')).map(
    (el) => el.textContent,
  )

const settled = () => waitFor(() => expect(rowNames().length).toBeGreaterThan(0))

const stat = (label: string) =>
  Array.from(document.querySelectorAll('.dt-stats > div'))
    .find((el) => el.querySelector('.dt-stat-label')?.textContent === label)
    ?.querySelector('.dt-stat-value')?.textContent

describe('a table on a database', () => {
  it('draws its first page out of SQLite', async () => {
    setup()
    await settled()

    expect(rowNames()).toEqual(RECORDS.slice(0, 8).map((r) => r.name))
    expect(stat('Total')).toBe('240')
    expect(stat('Matching')).toBe('240')
  })

  it('searches in SQL and counts what matched, not what it drew', async () => {
    const user = setup()
    await settled()

    await user.type(screen.getByPlaceholderText(/search/i), 'ethan')

    const expected = RECORDS.filter((r) =>
      `${r.name} ${r.email} ${r.address}`.toLowerCase().includes('ethan'),
    )
    await waitFor(() => expect(stat('Matching')).toBe(String(expected.length)))
    expect(rowNames()).toEqual(expected.slice(0, 8).map((r) => r.name))
  })

  it('sorts in SQL, in the order the component would have', async () => {
    const user = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))

    const expected = RECORDS.slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))
      .slice(0, 8)
      .map((r) => r.name)
    await waitFor(() => expect(rowNames()).toEqual(expected))
  })

  it('turns a page by fetching it', async () => {
    const user = setup()
    await settled()

    await user.click(screen.getByRole('button', { name: /^Page 5 of / }))
    await waitFor(() => expect(rowNames()).toEqual(RECORDS.slice(32, 40).map((r) => r.name)))
    expect(screen.getByText(/33–40/)).toBeInTheDocument()
  })

  it('reads a whole column across every page, from one request', async () => {
    const user = setup()
    await settled()

    const label = document.querySelector('th[data-key="solvedCases"] .dt-th-label') as HTMLElement
    await user.tripleClick(label)

    const sum = RECORDS.reduce((total, r) => total + Number(r.solvedCases), 0)
    await waitFor(() =>
      expect(document.querySelector('.dt-sum-value')?.textContent).toBe(
        sum.toLocaleString('en-GB'),
      ),
    )
  })

  it('writes an edit through to the database and shows what came back', async () => {
    const user = setup()
    await settled()

    const doomed = RECORDS[0]
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(stat('Total')).toBe('239'))
    // Not just on screen: the row is gone from the table it came out of, and
    // the page has pulled the ninth record up to fill the gap.
    expect(listRecords(db).some((r) => r.id === doomed.id)).toBe(false)
    await waitFor(() => expect(rowNames()).toEqual(RECORDS.slice(1, 9).map((r) => r.name)))
  })

  it('holds a filter and a page together', async () => {
    const user = setup()
    await settled()

    await user.type(screen.getByPlaceholderText(/search/i), 'a')
    const matching = RECORDS.filter((r) =>
      `${r.name} ${r.email} ${r.address}`.toLowerCase().includes('a'),
    )
    await waitFor(() => expect(stat('Matching')).toBe(String(matching.length)))

    await user.click(screen.getByRole('button', { name: /^Page 3 of / }))
    await waitFor(() => expect(rowNames()).toEqual(matching.slice(16, 24).map((r) => r.name)))
  })

  it('says nothing matched rather than sitting empty', async () => {
    const user = setup()
    await settled()

    await user.type(screen.getByPlaceholderText(/search/i), 'zzzzzzz')
    await waitFor(() => expect(screen.getByText('No records match')).toBeInTheDocument())
    expect(within(document.body).queryByText('Could not load the records')).not.toBeInTheDocument()
  })
})

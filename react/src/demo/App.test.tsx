/**
 * The dev harness, which stopped being trivial when the records moved into a
 * database.
 *
 * It is not part of the published package and nothing here tests the design.
 * What it owns is the choice between the two ways of feeding the same screen —
 * a windowed `source` and a whole-set `records` array — plus, for the second of
 * them, a fetch, a loading state, an error state and the write-back. Those are
 * invisible until they are wrong, and most of them only appear on a machine
 * where the API server is not running.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createDemoRecords } from '../lib/demoData'
import type { DataTableRecord } from '../lib/types'

/* Small on purpose: the harness asks for a thousand, and what comes back is
   whatever the server has. Twelve keeps the DOM small enough to assert on. */
const RECORDS = createDemoRecords(12)

type Call = { url: string; init?: RequestInit }

let calls: Call[]
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const wholeSet = (records: DataTableRecord[] = RECORDS) =>
  ok({ records, total: records.length })

/** What `GET /api/records` answers: one window, plus the two counts. */
const windowOf = (offset = 0, limit = 8, records: DataTableRecord[] = RECORDS) =>
  ok({
    rows: records.slice(offset, offset + limit),
    total: records.length,
    grandTotal: records.length,
    offset,
    limit,
  })

/** The harness opens windowed, so this is what most tests have to answer. */
const routed = (url: string): Response => {
  if (url.includes('/records/all')) return wholeSet()
  if (url.includes('/records/column')) return ok({ values: RECORDS.map((r) => r.name) })
  if (url.includes('/records/next-id')) return ok({ id: 'REC-9999' })
  if (url.includes('/records/by-ids')) return ok({ records: [RECORDS[0]] })
  const offset = Number(new URL(url, 'http://x').searchParams.get('offset') ?? 0)
  const limit = Number(new URL(url, 'http://x').searchParams.get('limit') ?? 8)
  return windowOf(offset, limit)
}

/** Switches the harness into the older whole-set arrangement. */
const toWholeSet = (user: ReturnType<typeof userEvent.setup>) =>
  user.selectOptions(screen.getByLabelText(/^data/), 'whole')

const noChanges = () =>
  ok({ added: 0, updated: 0, removed: 0, moved: 0, reordered: 0, rows: RECORDS.length })

beforeEach(() => {
  calls = []
  respond = (url) => routed(url)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      return Promise.resolve(respond(url, init))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const table = () => screen.findByRole('table')

const sent = (path: string) => calls.filter((c) => c.url.startsWith(path))

/**
 * The harness's own motion control, turned off so nothing waits on a keyframe.
 *
 * Matched with a prefix rather than exactly: the label wraps the select *and*
 * the readout of what the OS asks for, and a wrapper label's accessible name is
 * all of its text run together.
 */
async function silenceMotion(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/^motion/), 'never')
}

describe('windowed, which is how it opens', () => {
  it('asks for one page and never for the set', async () => {
    render(<App />)
    await table()

    expect(sent('/api/records/all')).toHaveLength(0)
    const first = sent('/api/records')[0]
    expect(first.url).toContain('limit=8')
    // No `offset` on the first page: the client leaves out what is zero, and a
    // URL that says only what it means is easier to read in a network tab.
    expect(first.url).not.toContain('offset=')
  })

  it('reports what the screen has cost, which is the point of the mode', async () => {
    render(<App />)
    await table()
    // One request for one page — the number to watch as the pager moves.
    await waitFor(() => expect(screen.getByText(/1 req · ≥/)).toBeInTheDocument())
  })

  it('hands the table a source rather than records', async () => {
    render(<App />)
    const rendered = await table()
    // Eight rows on screen out of the seventeen the fake server holds, and the
    // other nine were never sent.
    expect(within(rendered).getAllByRole('row').length - 1).toBe(8)
  })
})

describe('whole set, the older arrangement', () => {
  it('asks for the whole set at the default row count', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()

    await toWholeSet(user)
    await table()

    expect(sent('/api/records/all')[0].url).toBe('/api/records/all?limit=1000')
  })

  it('renders the records the server sent, not a generated set', async () => {
    const user = userEvent.setup()
    const renamed = RECORDS.map((r, i) => ({ ...r, name: `From SQLite ${i}` }))
    render(<App />)
    await table()

    respond = (url) => (url.includes('/records/all') ? wholeSet(renamed) : routed(url))
    await toWholeSet(user)

    await waitFor(() => expect(screen.getByText('From SQLite 0')).toBeInTheDocument())
  })

  it('reports what came back and what the table holds', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await toWholeSet(user)

    await waitFor(() => expect(screen.getByText(/12 of 12 in \d+ms/)).toBeInTheDocument())
  })

  it('asks again with a new limit when the row count changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await toWholeSet(user)
    await waitFor(() => expect(sent('/api/records/all')).toHaveLength(1))

    await user.selectOptions(screen.getByLabelText('rows'), '17')
    await waitFor(() =>
      expect(sent('/api/records/all').at(-1)?.url).toBe('/api/records/all?limit=17'),
    )
  })

  it('leaves the row count alone in the other mode, where it means nothing', async () => {
    render(<App />)
    await table()
    expect(screen.getByLabelText('rows')).toBeDisabled()
  })
})

describe('when the API server is not running', () => {
  it('says which command starts it instead of rendering an empty table', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()

    respond = (url) => {
      if (url.includes('/records/all')) throw new TypeError('Failed to fetch')
      return routed(url)
    }
    await toWholeSet(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to fetch')
    expect(alert).toHaveTextContent('npm run dev:api')
  })

  it('reports a failed save without throwing the screen away', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await toWholeSet(user)
    await table()
    await silenceMotion(user)

    respond = (url) =>
      url.includes('/sync')
        ? new Response(JSON.stringify({ error: 'database is locked' }), { status: 500 })
        : routed(url)

    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('save failed — database is locked'),
    )
  })
})

describe('writing back', () => {
  it('sends only what changed, not the whole list', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await toWholeSet(user)
    await table()
    await silenceMotion(user)

    respond = (url) => (url.includes('/sync') ? noChanges() : routed(url))

    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(sent('/api/records/sync')).toHaveLength(1))

    const body = JSON.parse(String(sent('/api/records/sync')[0].init?.body))
    expect(body).toEqual({ removed: [RECORDS[0].id] })
    // Nothing else went with it — no records array, no order.
    expect(Object.keys(body)).toEqual(['removed'])
  })

  it('posts nothing at all when an action changes no record', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await toWholeSet(user)
    await table()

    // Sorting is a view change: `onRecordsChange` never fires, so neither does
    // a save. A diff that mistook a re-sort for a reorder would show up here.
    await user.click(screen.getByRole('button', { name: /^Sort by Name/ }))

    expect(sent('/api/records/sync')).toHaveLength(0)
  })

  it('needs no diff at all in windowed mode — the source writes through', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    await silenceMotion(user)

    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(sent('/api/records/sync')).toHaveLength(1))
    // One record named, not a diff of two arrays the harness never held.
    expect(JSON.parse(String(sent('/api/records/sync')[0].init?.body))).toEqual({
      removed: [RECORDS[0].id],
    })
  })

  it('rebuilds the database and reloads when reseed is pressed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await table()
    const before = sent('/api/records').length

    respond = (url) => (url.includes('/reseed') ? ok({ rows: 100_000 }) : routed(url))
    await user.click(screen.getByRole('button', { name: 'reseed db' }))

    await waitFor(() => expect(sent('/api/records/reseed')).toHaveLength(1))
    expect(JSON.parse(String(sent('/api/records/reseed')[0].init?.body))).toEqual({
      count: 100_000,
    })
    // And the table asks again rather than trusting the page it already drew.
    await waitFor(() => expect(sent('/api/records').length).toBeGreaterThan(before))
  })
})

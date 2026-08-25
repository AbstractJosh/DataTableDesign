import { describe, expect, it, vi } from 'vitest'

import { createDemoRecords } from './demoData'
import {
  RecordsApiError,
  createRecordsClient,
  detectMove,
  diffRecords,
  recordQueryParams,
} from './recordsApi'
import { RECORD_FIELDS } from './types'
import type { DataTableRecord } from './types'

const SEED = createDemoRecords(8)
const ids = (records: DataTableRecord[]) => records.map((r) => r.id)

/** Lifts one element out and puts it back at `to`, the way `moveRow` does. */
function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [taken] = next.splice(from, 1)
  next.splice(to, 0, taken)
  return next
}

describe('the field list', () => {
  it('names every field of a record, and only real ones', () => {
    expect([...RECORD_FIELDS].sort()).toEqual(Object.keys(SEED[0]).sort())
  })
})

describe('detecting a drag', () => {
  const list = ids(SEED)

  it('finds a row dragged down', () => {
    expect(detectMove(list, move(list, 1, 5))).toEqual({ id: list[1], afterId: list[5] })
  })

  it('finds a row dragged up', () => {
    expect(detectMove(list, move(list, 6, 2))).toEqual({ id: list[6], afterId: list[1] })
  })

  it('finds a row dragged to the very top', () => {
    expect(detectMove(list, move(list, 4, 0))).toEqual({ id: list[4], afterId: null })
  })

  it('finds a row dragged to the very bottom', () => {
    const last = list.length - 1
    expect(detectMove(list, move(list, 0, last))).toEqual({ id: list[0], afterId: list[last] })
  })

  it('finds a one-place nudge', () => {
    expect(detectMove(list, move(list, 3, 4))).toEqual({ id: list[3], afterId: list[4] })
  })

  it('says nothing moved when nothing moved', () => {
    expect(detectMove(list, list.slice())).toBeNull()
  })

  it('gives up on a reshuffle that was not one drag', () => {
    const shuffled = [list[4], list[0], list[7], list[1], list[2], list[6], list[3], list[5]]
    expect(detectMove(list, shuffled)).toBeNull()
  })

  it('gives up when the two lists are not the same length', () => {
    expect(detectMove(list, list.slice(1))).toBeNull()
  })
})

describe('diffing two record lists', () => {
  it('reports nothing for an untouched list', () => {
    expect(diffRecords(SEED, SEED.slice())).toBeNull()
  })

  it('reports nothing when the copies are equal field for field', () => {
    expect(diffRecords(SEED, SEED.map((r) => ({ ...r })))).toBeNull()
  })

  it('sees an edited field', () => {
    const next = SEED.map((r) => (r.id === SEED[2].id ? { ...r, name: 'Edited' } : r))
    expect(diffRecords(SEED, next)).toEqual({ updated: [next[2]] })
  })

  it('sees an edit to a field that is not a column', () => {
    const next = SEED.map((r) => (r.id === SEED[2].id ? { ...r, note: 'A new note' } : r))
    expect(diffRecords(SEED, next)?.updated).toHaveLength(1)
  })

  it('sees a deletion', () => {
    const next = SEED.filter((r) => r.id !== SEED[3].id)
    expect(diffRecords(SEED, next)).toEqual({ removed: [SEED[3].id] })
  })

  it('sees a record added at the top, where the draft row commits', () => {
    const fresh = { ...SEED[0], id: 'REC-fresh' }
    expect(diffRecords(SEED, [fresh, ...SEED])).toEqual({
      added: [{ record: fresh, afterId: null }],
    })
  })

  it('anchors a record added in the middle to the row above it', () => {
    const fresh = { ...SEED[0], id: 'REC-fresh' }
    const next = [...SEED.slice(0, 3), fresh, ...SEED.slice(3)]
    expect(diffRecords(SEED, next)).toEqual({
      added: [{ record: fresh, afterId: SEED[2].id }],
    })
  })

  it('sends a drag as one move, not as a new order', () => {
    const payload = diffRecords(SEED, move(SEED, 0, 4))
    expect(payload).toEqual({ moved: [{ id: SEED[0].id, afterId: SEED[4].id }] })
    expect(payload?.order).toBeUndefined()
  })

  it('falls back to the whole order for a reshuffle it cannot name', () => {
    const shuffled = [SEED[4], SEED[0], SEED[7], SEED[1], SEED[2], SEED[6], SEED[3], SEED[5]]
    expect(diffRecords(SEED, shuffled)).toEqual({ order: ids(shuffled) })
  })

  it('falls back to the whole order when a deletion also moved the survivors', () => {
    const next = move(SEED.filter((r) => r.id !== SEED[1].id), 0, 3)
    const payload = diffRecords(SEED, next)
    expect(payload?.removed).toEqual([SEED[1].id])
    expect(payload?.order).toEqual(ids(next))
  })

  it('does not send an order when a deletion left the rest alone', () => {
    const payload = diffRecords(SEED, SEED.filter((r) => r.id !== SEED[1].id))
    expect(payload?.order).toBeUndefined()
  })

  it('carries an edit and a move in the same payload', () => {
    const edited = SEED.map((r) => (r.id === SEED[5].id ? { ...r, name: 'Edited' } : r))
    const payload = diffRecords(SEED, move(edited, 5, 1))
    expect(payload?.updated?.[0].name).toBe('Edited')
    expect(payload?.moved).toEqual([{ id: SEED[5].id, afterId: SEED[0].id }])
  })
})

describe('the query string', () => {
  it('leaves out everything that was not asked for', () => {
    expect(recordQueryParams({}).toString()).toBe('')
  })

  it('carries the window, the search, the sort and the chips', () => {
    const params = recordQueryParams({
      offset: 40,
      limit: 20,
      q: 'ethan',
      sort: 'name',
      dir: 'desc',
      locale: 'tr',
      where: [
        { id: 'f1', key: 'status', op: 'isAnyOf', values: ['Success'], value: '', value2: '' },
      ],
    })
    expect(params.get('offset')).toBe('40')
    expect(params.get('limit')).toBe('20')
    expect(params.get('q')).toBe('ethan')
    expect(params.get('sort')).toBe('name')
    expect(params.get('dir')).toBe('desc')
    expect(params.get('locale')).toBe('tr')
    expect(JSON.parse(params.get('where')!)).toHaveLength(1)
  })

  it('omits an empty chip list rather than sending an empty array', () => {
    expect(recordQueryParams({ where: [] }).has('where')).toBe(false)
  })
})

/* ---- the client ------------------------------------------------------ */

const reply = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function stub(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  ) as unknown as typeof globalThis.fetch
}

describe('the client', () => {
  it('asks for the whole set at the relative path a host would proxy', async () => {
    const fetch = stub(() => reply({ records: SEED, total: SEED.length }))
    const client = createRecordsClient({ fetch })

    await client.all()
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/records/all')

    await client.all(5)
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/records/all?limit=5')
  })

  it('honours a base URL for a host that mounts the API elsewhere', async () => {
    const fetch = stub(() => reply({ records: [], total: 0 }))
    await createRecordsClient({ baseUrl: 'http://elsewhere/v2/', fetch }).all()
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://elsewhere/v2/records/all')
  })

  it('sends a window query as search params', async () => {
    const fetch = stub(() => reply({ rows: [], total: 0, offset: 0, limit: 50 }))
    await createRecordsClient({ fetch }).window({ offset: 50, limit: 50, sort: 'name' })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/records?offset=50&limit=50&sort=name')
  })

  it('treats a missing record as an answer and everything else as a failure', async () => {
    const missing = createRecordsClient({ fetch: stub(() => reply({ error: 'no' }, 404)) })
    await expect(missing.get('REC-nope')).resolves.toBeNull()

    const broken = createRecordsClient({
      fetch: stub(() => reply({ error: 'the disk is on fire' }, 500)),
    })
    await expect(broken.get('REC-4813')).rejects.toThrow('the disk is on fire')
    await expect(broken.get('REC-4813')).rejects.toBeInstanceOf(RecordsApiError)
  })

  it('reports the status when the server explains nothing', async () => {
    const client = createRecordsClient({
      fetch: stub(() => new Response('', { status: 502, statusText: 'Bad Gateway' })),
    })
    await expect(client.health()).rejects.toThrow('502')
  })

  it('posts a diff as JSON', async () => {
    const fetch = stub(() =>
      reply({ added: 0, updated: 1, removed: 0, moved: 0, reordered: 0, rows: 8 }),
    )
    await createRecordsClient({ fetch }).sync({ updated: [SEED[0]] })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/records/sync')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body)).updated).toHaveLength(1)
  })

  it('does not try to parse a 204', async () => {
    const client = createRecordsClient({ fetch: stub(() => reply(null, 204)) })
    await expect(client.sync({})).resolves.toBeUndefined()
  })
})

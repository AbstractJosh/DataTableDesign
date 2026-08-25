/**
 * @vitest-environment node
 *
 * The routes, over a real socket.
 *
 * The handler is exercised through an actual `node:http` server on an ephemeral
 * port rather than by calling it with faked request objects. Half of what this
 * file is checking — that a 204 has no body, that the large response is gzipped
 * and still parses, that a `:id` route does not swallow `/all` — only exists at
 * the socket, and a fake `ServerResponse` would agree with whatever the handler
 * did.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, get as httpGet, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'

import { ensureSchema, insertAll, openDatabase } from './db.ts'
import { createHandler } from './http.ts'
import { listRecords } from './store.ts'
import { createDemoRecords } from '../src/lib/demoData'
import type { DataTableRecord } from '../src/lib/types'

/* Big enough that the whole-set response crosses the gzip threshold with room
   to spare, small enough to rebuild between files in a few milliseconds. */
const SEED = createDemoRecords(300)

let db: DatabaseSync
let server: Server
let origin: string

beforeAll(async () => {
  db = openDatabase(':memory:')
  ensureSchema(db)
  insertAll(db, SEED)

  server = createServer(createHandler(db, SEED.length))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db.close()
})

const call = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init)

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await call(path, init)
  return (await response.json()) as T
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('health', () => {
  it('reports the row count', async () => {
    expect(await json('/api/health')).toEqual({ ok: true, rows: SEED.length })
  })

  it('answers a preflight without touching the database', async () => {
    const response = await call('/api/records', { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('has a plain-text index rather than a 404 at the root', async () => {
    const response = await call('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('/api/records/all')
  })
})

describe('the whole set', () => {
  it('returns every record in table order, with the total', async () => {
    const body = await json<{ records: DataTableRecord[]; total: number }>('/api/records/all')
    expect(body.total).toBe(SEED.length)
    expect(body.records.map((r) => r.id)).toEqual(SEED.map((r) => r.id))
  })

  it('returns only the twelve public fields', async () => {
    const body = await json<{ records: DataTableRecord[] }>('/api/records/all?limit=1')
    // No ord, no date_ms, no folded columns: the derived ones are the server's.
    expect(Object.keys(body.records[0]).sort()).toEqual(Object.keys(SEED[0]).sort())
  })

  it('takes a prefix when given a limit, and still reports the true total', async () => {
    const body = await json<{ records: DataTableRecord[]; total: number }>(
      '/api/records/all?limit=5',
    )
    expect(body.records).toHaveLength(5)
    expect(body.total).toBe(SEED.length)
  })

  it('is not shadowed by the :id route', async () => {
    const response = await call('/api/records/all')
    expect(response.status).toBe(200)
    expect(await response.clone().json()).toHaveProperty('records')
  })

  /**
   * The response this whole exercise is about. Undici decompresses on the way
   * in, so the fetch above cannot see the encoding — this asks for it directly
   * and reads the header off the raw response.
   */
  it('compresses it when the client will take it', async () => {
    const headers = await new Promise<Record<string, string | string[] | undefined>>(
      (resolve, reject) => {
        httpGet(
          `${origin}/api/records/all`,
          { headers: { 'accept-encoding': 'gzip' } },
          (response) => {
            response.resume()
            resolve(response.headers)
          },
        ).on('error', reject)
      },
    )
    expect(headers['content-encoding']).toBe('gzip')
  })
})

describe('a window', () => {
  it('slices, filters and reports the matching total', async () => {
    const where = JSON.stringify([
      { id: 's', key: 'status', op: 'isAnyOf', values: ['Success'], value: '', value2: '' },
    ])
    const body = await json<{ rows: DataTableRecord[]; total: number }>(
      `/api/records?limit=4&sort=name&dir=asc&where=${encodeURIComponent(where)}`,
    )

    const matching = SEED.filter((r) => r.status === 'Success')
    expect(body.total).toBe(matching.length)
    expect(body.rows).toHaveLength(4)
    expect(body.rows.every((r) => r.status === 'Success')).toBe(true)
  })

  it('defaults to a hundred rows rather than the whole table', async () => {
    const body = await json<{ rows: DataTableRecord[]; limit: number }>('/api/records')
    expect(body.limit).toBe(100)
    expect(body.rows).toHaveLength(100)
  })

  it('caps a limit that would turn the window into a download', async () => {
    const body = await json<{ limit: number }>('/api/records?limit=999999')
    expect(body.limit).toBe(5000)
  })

  it('refuses an unknown sort column instead of quietly ignoring it', async () => {
    const response = await call('/api/records?sort=nickname')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('nickname')
  })

  it('refuses a where clause that is not JSON', async () => {
    const response = await call('/api/records?where=notjson')
    expect(response.status).toBe(400)
  })
})

describe('one record', () => {
  it('reads it by id', async () => {
    const body = await json<{ record: DataTableRecord }>(`/api/records/${SEED[3].id}`)
    expect(body.record).toEqual(SEED[3])
  })

  it('404s for an id it does not hold', async () => {
    expect((await call('/api/records/REC-nope')).status).toBe(404)
  })

  it('creates, edits and deletes', async () => {
    const record: DataTableRecord = { ...SEED[0], id: 'REC-http', name: 'Created Here' }

    const created = await call('/api/records', post({ record, afterId: null }))
    expect(created.status).toBe(201)

    const edited = await call(`/api/records/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...record, name: 'Edited Here' }),
    })
    expect(edited.status).toBe(200)
    expect((await json<{ record: DataTableRecord }>(`/api/records/${record.id}`)).record.name).toBe(
      'Edited Here',
    )

    const removed = await call(`/api/records/${record.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)
    expect(await removed.text()).toBe('')
    expect((await call(`/api/records/${record.id}`)).status).toBe(404)
  })

  it('keeps the id from the path when a body tries to change it', async () => {
    await call(`/api/records/${SEED[1].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SEED[1], id: 'REC-smuggled', name: 'Renamed' }),
    })
    expect((await call('/api/records/REC-smuggled')).status).toBe(404)
    expect((await json<{ record: DataTableRecord }>(`/api/records/${SEED[1].id}`)).record.name).toBe(
      'Renamed',
    )
  })
})

describe('a batch', () => {
  it('applies a diff and reports what it did', async () => {
    const before = listRecords(db).length
    const result = await json<{ added: number; removed: number; rows: number }>(
      '/api/records/sync',
      post({
        removed: [SEED[2].id],
        added: [{ record: { ...SEED[0], id: 'REC-batch' }, afterId: null }],
      }),
    )
    expect(result).toMatchObject({ added: 1, removed: 1 })
    expect(result.rows).toBe(before)
    expect(listRecords(db)[0].id).toBe('REC-batch')
  })

  it('rejects a body that is not an object', async () => {
    const response = await call('/api/records/sync', post('nope'))
    expect(response.status).toBe(400)
  })
})

describe('anything else', () => {
  it('404s with the method and path it was given', async () => {
    const response = await call('/api/nothing')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('/api/nothing')
  })
})

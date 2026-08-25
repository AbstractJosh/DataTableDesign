/**
 * The HTTP surface — `node:http` and nothing else, because a router is fifty
 * lines and a dependency is forever, and this package's whole claim is that it
 * has none.
 *
 * Two read endpoints, and the difference between them is the point of the
 * exercise:
 *
 *   GET /api/records/all   the whole set, in table order
 *   GET /api/records       one window of it, filtered and sorted in SQL
 *
 * `/all` is what the screen runs on today: the demo asks for every row, hands
 * the array to `DataTable`, and the component filters, sorts and pages it
 * exactly as it always has. Nothing about the table changed, and the sizes stay
 * honest — a hundred thousand records is forty megabytes of JSON, which is the
 * number that makes the case for the other endpoint.
 *
 * `/api/records` is that other endpoint, complete and tested and so far unused.
 * It is here now rather than later because the shape of a virtualised table is
 * decided by what its data source can answer, and finding out afterwards that
 * the server cannot count matching rows without returning them is the kind of
 * discovery that rewrites a component.
 */
import { createGzip } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'

import { rowCount, seed } from './db.ts'
import { columnValues, isColumnKey, parseRecordQuery, queryRecords } from './query.ts'
import {
  applySync,
  deleteRecord,
  getRecord,
  insertRecord,
  listRecords,
  nextId,
  recordsByIds,
  updateRecord,
} from './store.ts'
import type { SyncPayload } from './store.ts'
import type { DataTableRecord } from '../src/lib/types.ts'

/** Large: a full reorder of a hundred thousand rows is a megabyte of ids. */
const MAX_BODY = 64 * 1024 * 1024

/**
 * Wide open, and only ever bound to localhost. The demo is served by Vite on
 * another port and proxies `/api` here, so in the normal case no preflight
 * happens at all; this exists so pointing a browser or a curl at the API port
 * directly does not turn into a CORS puzzle.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

/**
 * Compressed when the client will take it, because the whole-set response is
 * repetitive JSON that gives up about nine tenths of itself to gzip — the
 * difference between a forty megabyte transfer and a four megabyte one, on a
 * response that exists precisely to show how big it is.
 *
 * Streamed rather than `gzipSync`, which would hold the event loop for the
 * second or so it takes to compress the large one.
 */
function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body)
  const headers: Record<string, string> = {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }

  const accepts = String(req.headers['accept-encoding'] ?? '').includes('gzip')
  if (!accepts || text.length < 1024) {
    res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(text) })
    res.end(text)
    return
  }

  res.writeHead(status, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' })
  const gzip = createGzip()
  gzip.pipe(res)
  gzip.end(text)
}

const fail = (req: IncomingMessage, res: ServerResponse, status: number, error: string) =>
  sendJson(req, res, status, { error })

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (!size) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const isRecord = (value: unknown): value is DataTableRecord =>
  typeof value === 'object' && value !== null && typeof (value as DataTableRecord).id === 'string'

/**
 * The router.
 *
 * Static segments are matched before the `:id` catch-all — `/api/records/all`
 * is not a record whose id happens to be "all" — and the whole thing is one
 * function rather than a table so the order is visible in the file.
 */
export function createHandler(db: DatabaseSync, seedCount: number) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    try {
      if (path === '/' || path === '/api') {
        res.writeHead(200, { ...CORS, 'content-type': 'text/plain; charset=utf-8' })
        res.end(ROUTES)
        return
      }

      if (path === '/api/health') {
        sendJson(req, res, 200, { ok: true, rows: rowCount(db) })
        return
      }

      /* ---- reads ---- */

      if (path === '/api/records/all' && method === 'GET') {
        const raw = url.searchParams.get('limit')
        const limit = raw === null || raw === '' ? undefined : Number(raw)
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          return fail(req, res, 400, 'limit must be a whole number')
        }
        const records = listRecords(db, limit)
        sendJson(req, res, 200, { records, total: rowCount(db) })
        return
      }

      if (path === '/api/records' && method === 'GET') {
        const parsed = parseRecordQuery(url.searchParams)
        if (!parsed.ok) return fail(req, res, 400, parsed.error)
        sendJson(req, res, 200, queryRecords(db, parsed.query))
        return
      }

      /*
       * One column, every matching row — the whole-column selection.
       *
       * Deliberately not `/api/records` with a `columns=` parameter: this
       * returns a bare array of strings rather than records, which is the
       * entire point of it, and a route whose response shape changes with a
       * query parameter is a route that has to be read twice.
       */
      if (path === '/api/records/column' && method === 'GET') {
        const key = url.searchParams.get('key') ?? ''
        if (!isColumnKey(key)) return fail(req, res, 400, `unknown column "${key}"`)
        const parsed = parseRecordQuery(url.searchParams)
        if (!parsed.ok) return fail(req, res, 400, parsed.error)
        sendJson(req, res, 200, { values: columnValues(db, key, parsed.query) })
        return
      }

      if (path === '/api/records/next-id' && method === 'GET') {
        sendJson(req, res, 200, { id: nextId(db) })
        return
      }

      /*
       * A POST for a read, because the ids are the request: a selection of a
       * few hundred does not belong in a URL, and every browser and proxy has
       * its own idea of how long one may be.
       */
      if (path === '/api/records/by-ids' && method === 'POST') {
        const body = (await readBody(req)) as { ids?: unknown } | undefined
        if (!Array.isArray(body?.ids)) return fail(req, res, 400, 'expected { ids }')
        sendJson(req, res, 200, { records: recordsByIds(db, body.ids.map(String)) })
        return
      }

      /* ---- writes ---- */

      if (path === '/api/records/sync' && method === 'POST') {
        const body = (await readBody(req)) as SyncPayload | undefined
        if (!body || typeof body !== 'object') return fail(req, res, 400, 'expected a JSON body')
        sendJson(req, res, 200, applySync(db, body))
        return
      }

      if (path === '/api/records/reseed' && method === 'POST') {
        const body = (await readBody(req)) as { count?: number } | undefined
        const count = Number(body?.count ?? seedCount)
        if (!Number.isInteger(count) || count < 0) {
          return fail(req, res, 400, 'count must be a whole number')
        }
        sendJson(req, res, 200, { rows: seed(db, count) })
        return
      }

      if (path === '/api/records' && method === 'POST') {
        const body = (await readBody(req)) as
          | { record?: unknown; afterId?: string | null }
          | undefined
        if (!isRecord(body?.record)) return fail(req, res, 400, 'expected { record }')
        insertRecord(db, body.record, body.afterId ?? null)
        sendJson(req, res, 201, { record: body.record })
        return
      }

      const match = /^\/api\/records\/(.+)$/.exec(path)
      if (match) {
        const id = decodeURIComponent(match[1])

        if (method === 'GET') {
          const record = getRecord(db, id)
          if (!record) return fail(req, res, 404, `no record ${id}`)
          sendJson(req, res, 200, { record })
          return
        }

        if (method === 'PATCH' || method === 'PUT') {
          const body = await readBody(req)
          if (!isRecord(body)) return fail(req, res, 400, 'expected a record')
          // The path wins: a body that renames the id would silently create a
          // second row rather than move one.
          const record = { ...body, id }
          if (!updateRecord(db, record)) return fail(req, res, 404, `no record ${id}`)
          sendJson(req, res, 200, { record })
          return
        }

        if (method === 'DELETE') {
          if (!deleteRecord(db, id)) return fail(req, res, 404, `no record ${id}`)
          res.writeHead(204, CORS)
          res.end()
          return
        }
      }

      fail(req, res, 404, `no route for ${method} ${path}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Logged as well as returned: the client shows an error strip, but the
      // stack that explains it only exists here.
      console.error(`[api] ${method} ${path} —`, error)
      fail(req, res, 500, message)
    }
  }
}

const ROUTES = `data-table records API

GET    /api/health
GET    /api/records/all?limit=            every record, in table order
GET    /api/records?offset&limit&q&sort&dir&locale&where
                                          one window, filtered and sorted in SQL
GET    /api/records/column?key&<filter>   one column, every matching row
GET    /api/records/next-id
POST   /api/records/by-ids                { ids }
GET    /api/records/:id
POST   /api/records                       { record, afterId }
PATCH  /api/records/:id                   a whole record
DELETE /api/records/:id
POST   /api/records/sync                  { added, updated, removed, moved, order }
POST   /api/records/reseed                { count } — rebuilds from the generator
`

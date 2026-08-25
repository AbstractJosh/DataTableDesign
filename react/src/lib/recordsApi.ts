/**
 * The client half of the SQLite server in `server/`.
 *
 * `DataTable` does not know this file exists and should not: it takes an array
 * and reports a new array, which is the right contract for a component and the
 * reason it can be dropped into a host that keeps its records anywhere at all.
 * This is one such host's answer — the one the dev harness uses — and it is
 * exported because the wire types are the contract a virtualised table will be
 * built against, not because the component needs it.
 *
 * Two shapes of read, and the difference is the whole point:
 *
 * - `all()` fetches every record and hands the array over. The component then
 *   filters, sorts and pages it exactly as it always has. Simple, unchanged,
 *   and forty megabytes of JSON at a hundred thousand rows.
 * - `window()` asks the server for one slice, already filtered and sorted, plus
 *   the total it was taken from. Nothing calls it yet. It exists because the
 *   shape of a virtualised table is decided by what its source can answer, and
 *   the answer has to include "how many match" without also including them.
 *
 * ## Writes, and why they are a diff
 *
 * Every edit — a rename, a delete, a new row, a drag — reaches a host the same
 * way: `onRecordsChange` with the whole next array. Posting that array back
 * would be forty megabytes per keystroke-confirmed rename. `diffRecords` works
 * out what actually changed by comparing the two arrays and sends only that,
 * which for the overwhelmingly common case is one record or one moved id.
 */
import { RECORD_FIELDS } from './types'
import type { FilterCondition } from './filters'
import type { Locale } from './i18n'
import type { RecordSource, SourceFilter } from './source'
import type { ColumnKey, DataTableRecord } from './types'

/* ---- the wire ------------------------------------------------------- */

export interface AllRecords {
  records: DataTableRecord[]
  /** The table's full row count, which `records` may be a `limit`ed prefix of. */
  total: number
}

export interface RecordWindowQuery {
  offset?: number
  limit?: number
  /** The toolbar search box, verbatim — the server folds and trims it. */
  q?: string
  /** The filter dock's chips. ANDed; ones with no operand yet are ignored. */
  where?: FilterCondition[]
  sort?: ColumnKey | null
  dir?: 'asc' | 'desc'
  /** Decides case folding only. It never changes which records exist. */
  locale?: Locale
}

export interface RecordWindow {
  rows: DataTableRecord[]
  /** Rows matching the filter, before the window was taken. The pager's number. */
  total: number
  /** Rows before any filter — the header's "Total records". */
  grandTotal: number
  offset: number
  limit: number
}

export interface SyncPayload {
  added?: { record: DataTableRecord; afterId: string | null }[]
  updated?: DataTableRecord[]
  removed?: string[]
  moved?: { id: string; afterId: string | null }[]
  /**
   * A drag as the table describes it — two ids and no position. The server
   * works out which way it went, because a windowed client holds one page and
   * cannot see the row that would be the anchor.
   */
  dragged?: { fromId: string; toId: string }[]
  /** The complete id order, for a change that was not one recognisable move. */
  order?: string[]
}

export interface SyncResult {
  added: number
  updated: number
  removed: number
  moved: number
  reordered: number
  rows: number
}

/** A non-2xx response, carrying the status and whatever the server explained. */
export class RecordsApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RecordsApiError'
    this.status = status
  }
}

/* ---- the diff -------------------------------------------------------- */

const sameRecord = (a: DataTableRecord, b: DataTableRecord) =>
  RECORD_FIELDS.every((field) => a[field] === b[field])

/** Whether two id sequences are equal over the given half-open ranges. */
function sliceEquals(
  a: string[],
  aStart: number,
  b: string[],
  bStart: number,
  length: number,
): boolean {
  for (let i = 0; i < length; i += 1) if (a[aStart + i] !== b[bStart + i]) return false
  return true
}

/**
 * The single row that was dragged, or null if the change was not one drag.
 *
 * `moveRow` in `DataTable` splices one element out and back in, so a reorder is
 * always exactly that: one id in a new place and everything else shifted by one
 * to make room. Recognising it turns a reorder into one `UPDATE` of one row
 * instead of a rewrite of every position.
 *
 * The two arrays must already hold the same ids — the caller only asks after it
 * has established that nothing was added or removed.
 */
export function detectMove(
  prev: string[],
  next: string[],
): { id: string; afterId: string | null } | null {
  if (prev.length !== next.length) return null

  let head = 0
  while (head < prev.length && prev[head] === next[head]) head += 1
  if (head === prev.length) return null // nothing moved

  let tail = prev.length - 1
  while (tail > head && prev[tail] === next[tail]) tail -= 1

  const span = tail - head

  // Dragged down: prev[head] was lifted out and dropped at `tail`, and
  // everything between shifted up one.
  if (sliceEquals(prev, head + 1, next, head, span)) {
    return { id: prev[head], afterId: tail > 0 ? next[tail - 1] : null }
  }

  // Dragged up: prev[tail] was lifted out and dropped at `head`.
  if (sliceEquals(prev, head, next, head + 1, span)) {
    return { id: prev[tail], afterId: head > 0 ? next[head - 1] : null }
  }

  return null
}

/**
 * What changed between two versions of the record list, or null if nothing did.
 *
 * Removals, additions and field edits are read off an id map, which is O(n) and
 * exact. Position is the awkward one, and it is handled in two tiers: when the
 * membership is untouched, a single drag is recognised and sent as one move;
 * anything else falls back to sending the whole id order, because a wrong guess
 * about position is a table that reorders itself on reload and a slow correct
 * answer is not.
 */
export function diffRecords(
  prev: DataTableRecord[],
  next: DataTableRecord[],
): SyncPayload | null {
  const before = new Map(prev.map((r) => [r.id, r]))
  const after = new Map(next.map((r) => [r.id, r]))

  const removed: string[] = []
  for (const record of prev) if (!after.has(record.id)) removed.push(record.id)

  const added: { record: DataTableRecord; afterId: string | null }[] = []
  const updated: DataTableRecord[] = []
  for (let i = 0; i < next.length; i += 1) {
    const record = next[i]
    const previous = before.get(record.id)
    if (!previous) {
      // The row above it in the new list, which is where the server should put
      // it. A record added at the top — which is where the draft row commits —
      // has nothing above it and so goes to the top.
      added.push({ record, afterId: i > 0 ? next[i - 1].id : null })
    } else if (!sameRecord(previous, record)) {
      updated.push(record)
    }
  }

  const payload: SyncPayload = {}
  if (added.length) payload.added = added
  if (updated.length) payload.updated = updated
  if (removed.length) payload.removed = removed

  if (!added.length && !removed.length) {
    const move = detectMove(
      prev.map((r) => r.id),
      next.map((r) => r.id),
    )
    if (move) payload.moved = [move]
    else if (!sameOrder(prev, next)) payload.order = next.map((r) => r.id)
  } else if (!prefixOrderHolds(prev, next, removed)) {
    // Membership changed *and* the survivors moved. Not worth unpicking: the
    // full order is one request and always right.
    payload.order = next.map((r) => r.id)
  }

  return Object.keys(payload).length ? payload : null
}

const sameOrder = (prev: DataTableRecord[], next: DataTableRecord[]) =>
  prev.length === next.length && prev.every((record, i) => record.id === next[i].id)

/**
 * Whether the records that survived a removal kept their relative order.
 *
 * Sets rather than `Array.includes`, which would make this quadratic — and at
 * a hundred thousand records a quadratic check on every edit is the whole
 * saving given back.
 */
function prefixOrderHolds(
  prev: DataTableRecord[],
  next: DataTableRecord[],
  removed: string[],
): boolean {
  const gone = new Set(removed)
  const survived = prev.filter((r) => !gone.has(r.id)).map((r) => r.id)
  const survivedSet = new Set(survived)
  const stillThere = next.filter((r) => survivedSet.has(r.id)).map((r) => r.id)
  return (
    stillThere.length === survived.length &&
    stillThere.every((id, i) => id === survived[i])
  )
}

/* ---- the client ------------------------------------------------------ */

export interface RecordsClientOptions {
  /** Defaults to `/api`, which the Vite dev server proxies to the API port. */
  baseUrl?: string
  /** Injected for tests; defaults to the global. */
  fetch?: typeof globalThis.fetch
}

export interface RequestOptions {
  signal?: AbortSignal
}

export function recordQueryParams(query: RecordWindowQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.offset) params.set('offset', String(query.offset))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.q) params.set('q', query.q)
  if (query.sort) params.set('sort', query.sort)
  if (query.dir) params.set('dir', query.dir)
  if (query.locale) params.set('locale', query.locale)
  // Only the conditions, not the chip ids the reducer uses as React keys — but
  // sending them costs nothing and makes a logged URL readable, so they stay.
  if (query.where?.length) params.set('where', JSON.stringify(query.where))
  return params
}

export interface RecordsClient {
  /** Every record in table order, or the first `limit` of them. */
  all(limit?: number, options?: RequestOptions): Promise<AllRecords>
  /** One filtered, sorted slice, plus the total it came out of. */
  window(query: RecordWindowQuery, options?: RequestOptions): Promise<RecordWindow>
  /** One column's values across every matching row, for a whole-column selection. */
  column(
    key: ColumnKey,
    query: RecordWindowQuery,
    options?: RequestOptions,
  ): Promise<string[]>
  /** The records behind a set of ids, in table order. */
  byIds(ids: string[], options?: RequestOptions): Promise<DataTableRecord[]>
  /** The id a new record should take — the `REC-<n>` series continued. */
  nextId(options?: RequestOptions): Promise<string>
  get(id: string, options?: RequestOptions): Promise<DataTableRecord | null>
  /** Applies a `diffRecords` payload. */
  sync(payload: SyncPayload, options?: RequestOptions): Promise<SyncResult>
  /** Rebuilds the table from the deterministic generator. Destructive. */
  reseed(count: number, options?: RequestOptions): Promise<{ rows: number }>
  health(options?: RequestOptions): Promise<{ ok: boolean; rows: number }>
}

export function createRecordsClient(options: RecordsClientOptions = {}): RecordsClient {
  const base = (options.baseUrl ?? '/api').replace(/\/+$/, '')
  const call = options.fetch ?? globalThis.fetch.bind(globalThis)

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await call(`${base}${path}`, init)
    if (response.status === 204) return undefined as T
    const text = await response.text()
    const body = text ? (JSON.parse(text) as unknown) : undefined
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `${response.status} ${response.statusText}`
      throw new RecordsApiError(response.status, message)
    }
    return body as T
  }

  const json = (payload: unknown, signal?: AbortSignal): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  return {
    all(limit, opts) {
      const suffix = limit === undefined ? '' : `?limit=${limit}`
      return request<AllRecords>(`/records/all${suffix}`, { signal: opts?.signal })
    },

    window(query, opts) {
      const params = recordQueryParams(query).toString()
      return request<RecordWindow>(`/records${params ? `?${params}` : ''}`, {
        signal: opts?.signal,
      })
    },

    async column(key, query, opts) {
      const params = recordQueryParams(query)
      params.set('key', key)
      // The window parameters mean nothing here — a column is every matching
      // row by definition — so they are dropped rather than sent and ignored.
      params.delete('offset')
      params.delete('limit')
      const body = await request<{ values: string[] }>(`/records/column?${params}`, {
        signal: opts?.signal,
      })
      return body.values
    },

    async byIds(ids, opts) {
      if (ids.length === 0) return []
      const body = await request<{ records: DataTableRecord[] }>(
        '/records/by-ids',
        json({ ids }, opts?.signal),
      )
      return body.records
    },

    async nextId(opts) {
      const body = await request<{ id: string }>('/records/next-id', { signal: opts?.signal })
      return body.id
    },

    async get(id, opts) {
      try {
        const body = await request<{ record: DataTableRecord }>(
          `/records/${encodeURIComponent(id)}`,
          { signal: opts?.signal },
        )
        return body.record
      } catch (error) {
        // A missing record is an answer, not a failure — every other status is
        // still thrown.
        if (error instanceof RecordsApiError && error.status === 404) return null
        throw error
      }
    },

    sync(payload, opts) {
      return request<SyncResult>('/records/sync', json(payload, opts?.signal))
    },

    reseed(count, opts) {
      return request<{ rows: number }>('/records/reseed', json({ count }, opts?.signal))
    },

    health(opts) {
      return request<{ ok: boolean; rows: number }>('/health', { signal: opts?.signal })
    },
  }
}

/* ---- the source ------------------------------------------------------- */

/**
 * How many records `collect` pulls per request.
 *
 * It is the server's own `MAX_LIMIT`. Twenty round trips for a hundred thousand
 * records, against one request that would have to be allowed to return the
 * whole table — which is the thing the window endpoint exists not to do.
 */
const COLLECT_CHUNK = 5000

const asWindowQuery = (filter: SourceFilter): RecordWindowQuery => ({
  q: filter.q,
  where: filter.where,
  sort: filter.sort?.key ?? null,
  dir: filter.sort?.dir ?? 'asc',
  locale: filter.locale,
})

/**
 * A `RecordSource` over the API above — the thing that makes the table windowed.
 *
 * Every method is one request, and the mapping is deliberately boring: the
 * table's questions were chosen to be answerable, and the endpoints were built
 * to answer them. The two interesting ones:
 *
 * - `collect` pages rather than asking for everything at once, because
 *   "everything" is the request the window endpoint refuses. It is called for
 *   exactly one thing — the argument `onExport` receives after a whole-column
 *   export — so a host that is not listening never pays for it.
 * - `apply` sends a **drag** as its two ids and lets the server decide which way
 *   it went. A windowed client holds one page; the row that would be the anchor
 *   for an upward drop is often not on it.
 *
 * No `snapshot`: this source owns its data, so nothing can remove a row behind
 * its back, and the table's own selection map is the right answer for it. See
 * `RecordSource` in `source.ts`.
 */
export function createRemoteSource(client: RecordsClient): RecordSource {
  return {
    synchronous: false,

    async page(query, signal) {
      const window = await client.window(
        { ...asWindowQuery(query), offset: query.offset, limit: query.limit },
        { signal },
      )
      return { rows: window.rows, total: window.total, grandTotal: window.grandTotal }
    },

    columnValues(key, filter, signal) {
      return client.column(key, asWindowQuery(filter), { signal })
    },

    recordsByIds(ids, signal) {
      return client.byIds(ids, { signal })
    },

    async collect(filter, signal) {
      const query = asWindowQuery(filter)
      const records: DataTableRecord[] = []
      let offset = 0
      for (;;) {
        const window = await client.window(
          { ...query, offset, limit: COLLECT_CHUNK },
          { signal },
        )
        records.push(...window.rows)
        offset += window.rows.length
        // `rows.length` rather than the chunk size: a short page is the end,
        // and trusting `total` alone would spin for ever if a write landed
        // between two of these requests and shrank the set.
        if (window.rows.length === 0 || offset >= window.total) return records
      }
    },

    nextId() {
      return client.nextId()
    },

    async apply(change) {
      switch (change.kind) {
        case 'update':
          await client.sync({ updated: [change.record] })
          return
        case 'delete':
          await client.sync({ removed: change.ids })
          return
        case 'create':
          // The draft row commits at the top, which is what a null anchor means.
          await client.sync({ added: [{ record: change.record, afterId: null }] })
          return
        case 'move':
          await client.sync({ dragged: [{ fromId: change.fromId, toId: change.toId }] })
          return
      }
    },
  }
}

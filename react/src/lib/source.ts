/**
 * Where the rows come from.
 *
 * `DataTable` used to hold every record it might ever show and slice a page out
 * of the middle. That is the right shape for the seventeen it ships with and
 * the wrong one for a hundred thousand, where the array is forty megabytes of
 * JSON before the first row is drawn and every keystroke in the search box is a
 * pass over all of it.
 *
 * A `RecordSource` is the table's way of asking for what it is about to render
 * instead of holding what it might. It answers six questions, and the list is
 * short on purpose — each one is something the screen actually does:
 *
 * | question | asked by |
 * |---|---|
 * | `page` | the rows on screen, the pager, the two counts in the header |
 * | `columnValues` | a whole column taken across every page: its reading, its copy, its `.csv` |
 * | `recordsByIds` | exporting the rows the checkboxes ticked |
 * | `collect` | `onExport`'s argument for a whole column — optional, and skipped
 * with no host listening |
 * | `nextId` | the id the draft row commits under |
 * | `apply` | an edit, a delete, a new record, a drag |
 *
 * ## Synchronous and asynchronous
 *
 * Both kinds exist and the table renders them differently, so a source has to
 * say which it is. A **synchronous** source is asked during render, the way the
 * old `useMemo` derive was — no effect, no loading state, no flash, and a
 * component given `records` behaves exactly as it did before any of this
 * existed. An **asynchronous** one is driven by an effect: its query is
 * debounced, its answer is kept while the next one is in flight, and the table
 * marks itself busy in the meantime.
 *
 * `synchronous` is a claim the source makes about itself rather than something
 * inferred per call, because inferring it would mean calling `page` during
 * render to find out — which for a remote source is a fetch per render.
 *
 * A synchronous source must also be **pure**: `page` is called during render and
 * may be called more than once for the same query.
 */
import { matchesAll } from './filters'
import { LOCALE_TAGS } from './i18n'
import { compareCells } from './sort'
import type { FilterCondition } from './filters'
import type { Locale } from './i18n'
import type { ColumnKey, DataTableRecord, SortState } from './types'

export type Awaitable<T> = T | Promise<T>

/**
 * Whether an `Awaitable` actually needs awaiting.
 *
 * The whole point of letting a source be synchronous is lost if every call site
 * wraps its answer in `Promise.resolve` — that turns an answer the component
 * already has into one it gets next tick, which is a render with the old value
 * in it and, for the tests written against the array path, a change of
 * behaviour. So the call sites branch, and this is the branch.
 */
export const isPromise = <T,>(value: Awaitable<T>): value is Promise<T> =>
  typeof (value as Promise<T>)?.then === 'function'

/**
 * Everything that decides *which* records, and in what order — but not how many
 * or from where. Split out because three of the six questions are about the
 * whole matching set rather than about a window of it.
 */
export interface SourceFilter {
  /** The toolbar search box, verbatim. Trimming and folding is the source's. */
  q: string
  /** The filter dock's chips. ANDed; ones with no operand yet match everything. */
  where: FilterCondition[]
  sort: SortState
  /**
   * Decides collation and case folding, and nothing about which records exist.
   * A status is the string `Success` in every language — see `i18n.ts`.
   */
  locale: Locale
}

export interface SourceQuery extends SourceFilter {
  offset: number
  limit: number
}

export interface SourcePage {
  rows: DataTableRecord[]
  /** Rows matching the filter, before the window — the pager's number. */
  total: number
  /** Rows before any filter — the header's "Total records". */
  grandTotal: number
}

/**
 * One change the table made, in the terms the table made it in.
 *
 * Not "here is the next array": that is what `onRecordsChange` hands a host and
 * it is unaffordable once the array is a hundred thousand records long. Each of
 * these maps onto one statement against a database and onto one splice against
 * an array, which is why the two sources can share every call site.
 */
export type RecordsChange =
  | { kind: 'update'; record: DataTableRecord }
  | { kind: 'delete'; ids: string[] }
  /** The draft row commits at the top, so there is no anchor to name. */
  | { kind: 'create'; record: DataTableRecord }
  /**
   * A drag, in the two ids it was made of rather than in indices.
   *
   * Dropping *down* lands after the target and dropping *up* lands before it —
   * which is what the array splice has always done, and what each source has to
   * reproduce in its own terms.
   */
  | { kind: 'move'; fromId: string; toId: string }

export interface RecordSource {
  /**
   * Whether every method answers without a promise. See the header — this is a
   * claim, not an inference, and a synchronous source must also be pure.
   */
  readonly synchronous: boolean

  page(query: SourceQuery, signal?: AbortSignal): Awaitable<SourcePage>

  /**
   * Every value in one column across the matching set, in order.
   *
   * The whole-column selection is the one thing on this screen that is
   * deliberately bigger than a page, and this is the cheapest honest answer to
   * it: a hundred thousand names is a couple of megabytes where a hundred
   * thousand records is forty.
   */
  columnValues(key: ColumnKey, filter: SourceFilter, signal?: AbortSignal): Awaitable<string[]>

  /** The records behind these ids — what the ticked checkboxes export. */
  recordsByIds(ids: string[], signal?: AbortSignal): Awaitable<DataTableRecord[]>

  /**
   * Every matching record. Called for exactly one thing: the argument
   * `onExport` is documented to receive after a whole column is exported.
   *
   * The `.csv` itself needs only `columnValues`, so a table whose host is not
   * listening never asks — and at a hundred thousand rows the difference is a
   * couple of megabytes against forty. Optional, because a source may not be
   * able to answer it at all; a host listening for `onExport` is then handed an
   * empty list for that one case, there being nothing the table could honestly
   * put in it.
   */
  collect?(filter: SourceFilter, signal?: AbortSignal): Awaitable<DataTableRecord[]>

  /** The id a new record should take. */
  nextId(): Awaitable<string>

  /** Absent means read-only: the table hides nothing, but nothing is written. */
  apply?(change: RecordsChange): Awaitable<void>

  /**
   * Synchronous sources only, and the escape hatch for the one thing that
   * genuinely wants the whole list at once: reading the selection back.
   *
   * A controlled host can drop a record from under the table between two
   * renders, and a ticked id it has removed must stop counting — so the array
   * source hands its list over and the ids come back filtered, in table order.
   *
   * A remote source does not implement it and is not asked to: it owns its
   * data, nobody can remove a row behind its back, and a round trip per render
   * to confirm that a hundred ticked ids still exist would be a great deal of
   * asking for an answer that is always yes.
   */
  snapshot?(): DataTableRecord[]
}

/* ---- the derive, which used to live in the component ---------------- */

/**
 * Filter by the dock's chips, then by the search box, then sort.
 *
 * Moved out of `DataTable` unchanged, so that the array source runs the same
 * code the component used to run inline and the remote source has something
 * exact to be tested against. The order is fixed and is part of the spec.
 */
export function deriveRecords(
  records: DataTableRecord[],
  filter: SourceFilter,
): DataTableRecord[] {
  const tag = LOCALE_TAGS[filter.locale]
  /* `toLocaleLowerCase`, and the cell below folded the same way. Turkish is
     the reason: `'İSTANBUL'.toLowerCase()` is an i with a *combining dot*,
     which never equals a typed `i`, so a search for "istanbul" found nothing
     in a column that plainly held it. Folding both sides with the table's own
     tag is the fix, and it costs English nothing — `en-GB` folds exactly as
     the unqualified method does. */
  const q = filter.q.trim().toLocaleLowerCase(tag)

  const list = records.filter((r) => {
    // The dock's chips, ANDed. Chips with no operand yet are skipped rather
    // than matching nothing — see isActive in filters.ts.
    if (!matchesAll(r, filter.where)) return false
    if (!q) return true
    // The prototype's fourth searched field was the phone number, which this
    // column set no longer carries. A case count is not something anyone
    // searches for, so the query stays on the three text fields — `email`
    // among them, which is still on the record now that it shows in the detail
    // pane rather than in a column.
    return `${r.name} ${r.email} ${r.address}`.toLocaleLowerCase(tag).includes(q)
  })

  if (!filter.sort) return list

  const { key, dir } = filter.sort
  return list
    .slice()
    .sort((a, b) => compareCells(String(a[key]), String(b[key]), tag) * (dir === 'asc' ? 1 : -1))
}

/**
 * The prototype stripped every non-digit out of the id and took the max
 * (data-table.html:855-860), which is fine for its closed REC-4813 series but
 * overflows into exponential notation — and then repeats itself — against a
 * host's UUIDs or timestamped ids. Only ids that really are `REC-<int>` feed
 * the series; anything else falls through to the seed.
 */
export function nextRecordId(ids: Iterable<string>): string {
  // A loop rather than `Math.max(...nums)`: spreading a hundred thousand
  // arguments is a stack overflow, and this is now asked of the whole table.
  let highest: number | null = null
  for (const id of ids) {
    const found = Number(/^REC-(\d+)$/.exec(String(id))?.[1])
    if (!Number.isSafeInteger(found)) continue
    if (highest === null || found > highest) highest = found
  }
  return 'REC-' + ((highest ?? 4813) + 7)
}

/* ---- the array source ------------------------------------------------ */

/**
 * The default, and the one that makes `<DataTable records={rows} />` mean what
 * it always meant.
 *
 * It is synchronous, it derives with `deriveRecords`, and it caches the last
 * derive — `page` and `columnValues` are asked the same question within one
 * render and refiltering a thousand records twice for one paint is waste the
 * old `useMemo` did not incur.
 *
 * `onChange` is what turns a `RecordsChange` back into the whole next array
 * that `onRecordsChange` is documented to hand a host. Leave it off and the
 * source is read-only.
 */
export function arraySource(
  records: DataTableRecord[],
  onChange?: (next: DataTableRecord[]) => void,
): RecordSource {
  let cachedKey: string | null = null
  let cached: DataTableRecord[] = records

  const derived = (filter: SourceFilter): DataTableRecord[] => {
    const key = filterKey(filter)
    if (key !== cachedKey) {
      cached = deriveRecords(records, filter)
      cachedKey = key
    }
    return cached
  }

  return {
    synchronous: true,

    page(query) {
      const matching = derived(query)
      return {
        rows: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
        grandTotal: records.length,
      }
    },

    columnValues(key, filter) {
      return derived(filter).map((r) => String(r[key] ?? ''))
    },

    recordsByIds(ids) {
      const wanted = new Set(ids)
      // In table order rather than in the order the ids arrived: an export is
      // read top to bottom and the checkboxes were ticked in no order at all.
      return records.filter((r) => wanted.has(r.id))
    },

    collect(filter) {
      return derived(filter)
    },

    nextId() {
      return nextRecordId(records.map((r) => r.id))
    },

    snapshot() {
      return records
    },

    apply: onChange
      ? (change) => {
          onChange(applyToArray(records, change))
        }
      : undefined,
  }
}

/** One change against a plain array — the splices the component used to do. */
export function applyToArray(
  records: DataTableRecord[],
  change: RecordsChange,
): DataTableRecord[] {
  switch (change.kind) {
    case 'update':
      return records.map((r) => (r.id === change.record.id ? change.record : r))

    case 'delete': {
      const gone = new Set(change.ids)
      return records.filter((r) => !gone.has(r.id))
    }

    case 'create':
      return [change.record, ...records]

    case 'move': {
      const from = records.findIndex((r) => r.id === change.fromId)
      const to = records.findIndex((r) => r.id === change.toId)
      if (from < 0 || to < 0) return records
      const next = records.slice()
      // Removing first and inserting at the target's *old* index is what puts a
      // row dropped downwards after its target and one dropped upwards before
      // it. Kept exactly as it was — the asymmetry is the behaviour.
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    }

    default:
      return records
  }
}

/* ---- keys ------------------------------------------------------------ */

/**
 * A string that changes when the answer would.
 *
 * Effect dependencies need it — a `where` array is rebuilt on every keystroke
 * and two identical queries must not refetch — and so does the array source's
 * cache. Conditions are reduced to the fields that decide matching: their `id`
 * is a React key the reducer hands out and says nothing about what they match.
 */
export function filterKey(filter: SourceFilter): string {
  const chips = filter.where.map((c) => [c.key, c.op, c.value, c.value2, c.values.join(' ')])
  return JSON.stringify([
    filter.q.trim(),
    chips,
    filter.sort ? [filter.sort.key, filter.sort.dir] : null,
    filter.locale,
  ])
}

export function queryKey(query: SourceQuery): string {
  return `${query.offset}:${query.limit}:${filterKey(query)}`
}

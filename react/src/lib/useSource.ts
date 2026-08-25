/**
 * Reading a `RecordSource` from inside a render.
 *
 * Two hooks, and both have the same shape of problem: a synchronous source has
 * the answer *now* and an asynchronous one has it in a moment, and the table
 * above them should not be written twice. So each hook runs both paths and
 * returns one value — the synchronous one computed in a `useMemo` during render
 * exactly as the old inline derive was, the asynchronous one carried in state
 * and filled by an effect.
 *
 * ## What the asynchronous path is careful about
 *
 * **It keeps the last answer.** A page that blanked while the next one loaded
 * would jump the layout on every keystroke and every pager press. The previous
 * page stays on screen, marked busy, until the new one lands.
 *
 * **It debounces the filter but not the window.** Typing `ethan` is five
 * queries if nothing waits; pressing *next page* is one, and waiting 200ms
 * before serving it just feels broken. So the delay applies when the *filter*
 * changed and not when only the window moved.
 *
 * **It aborts.** Switching pages mid-flight abandons the response rather than
 * letting a stale one land on top of the new one, and an abort is not an error.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { filterKey, queryKey } from './source'
import type { ColumnKey } from './types'
import type { RecordSource, SourceFilter, SourcePage, SourceQuery } from './source'

/** Long enough to swallow a fast typist, short enough not to feel laggy. */
export const FILTER_DEBOUNCE_MS = 180

const EMPTY_PAGE: SourcePage = { rows: [], total: 0, grandTotal: 0 }

export interface WindowState {
  page: SourcePage
  /** A query is in flight. The page below it is the previous answer. */
  loading: boolean
  /** No answer has arrived yet — the table has never had rows to show. */
  pending: boolean
  error: Error | null
}

/** An aborted request is a cancelled question, not a failed one. */
const aborted = (cause: unknown) =>
  cause instanceof DOMException ? cause.name === 'AbortError' : false

/**
 * The rows on screen, the matching total and the grand total.
 *
 * `version` is the invalidation handle: the table bumps it after a write, and
 * an asynchronous source refetches. A synchronous source needs no such thing —
 * its records changed, so its identity changed, so the memo below re-ran.
 */
export function useSourceWindow(
  source: RecordSource,
  query: SourceQuery,
  version: number,
): WindowState {
  const key = queryKey(query)
  const filter = filterKey(query)

  const direct = useMemo(
    () => (source.synchronous ? (source.page(query) as SourcePage) : null),
    // `query` is rebuilt every render; `key` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, key],
  )

  const [remote, setRemote] = useState<WindowState>({
    page: EMPTY_PAGE,
    loading: false,
    pending: true,
    error: null,
  })

  /* The last filter a request was *made* for, so the debounce can tell a new
     search from a new page. A ref rather than state: changing it must not
     re-run this effect, only inform the next run of it. */
  const lastFilter = useRef<string | null>(null)
  const latest = useRef({ source, query })
  latest.current = { source, query }

  useEffect(() => {
    if (source.synchronous) return

    const controller = new AbortController()
    const changedFilter = lastFilter.current !== null && lastFilter.current !== filter
    lastFilter.current = filter

    setRemote((was) => ({ ...was, loading: true, error: null }))

    const run = () => {
      Promise.resolve(latest.current.source.page(latest.current.query, controller.signal))
        .then((page) => {
          if (controller.signal.aborted) return
          setRemote({ page, loading: false, pending: false, error: null })
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || aborted(cause)) return
          setRemote((was) => ({
            ...was,
            loading: false,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          }))
        })
    }

    if (!changedFilter) {
      run()
      return () => controller.abort()
    }

    const timer = setTimeout(run, FILTER_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key, filter, version])

  if (direct) return { page: direct, loading: false, pending: false, error: null }
  return remote
}

export interface ColumnState {
  values: string[] | null
  loading: boolean
}

/**
 * Every value in one column, for the whole-column selection.
 *
 * `key` is null whenever no column is taken, which is nearly always — so the
 * asynchronous path asks for nothing until the gesture happens, and drops what
 * it fetched the moment the selection is dropped. Holding a hundred thousand
 * strings after the user has moved on is the sort of thing that makes a screen
 * feel heavy for reasons nobody can point at.
 */
export function useColumnValues(
  source: RecordSource,
  key: ColumnKey | null,
  filter: SourceFilter,
  version: number,
): ColumnState {
  const fingerprint = key ? `${key}:${filterKey(filter)}:${version}` : null

  const direct = useMemo(
    () =>
      source.synchronous && key ? (source.columnValues(key, filter) as string[]) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, fingerprint],
  )

  const [remote, setRemote] = useState<ColumnState>({ values: null, loading: false })
  const latest = useRef({ source, filter })
  latest.current = { source, filter }

  useEffect(() => {
    if (source.synchronous) return
    if (!key) {
      // Compared rather than assigned: a fresh object here would re-render on
      // every commit that leaves no column taken, which is nearly all of them.
      setRemote((was) =>
        was.values === null && !was.loading ? was : { values: null, loading: false },
      )
      return
    }

    const controller = new AbortController()
    setRemote({ values: null, loading: true })

    const asked = latest.current
    Promise.resolve(asked.source.columnValues(key, asked.filter, controller.signal))
      .then((values) => {
        if (controller.signal.aborted) return
        setRemote({ values, loading: false })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || aborted(cause)) return
        // The reading and the copy both degrade to "nothing to read" rather
        // than taking the screen down with them.
        setRemote({ values: null, loading: false })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, fingerprint])

  if (source.synchronous) return { values: direct, loading: false }
  return remote
}

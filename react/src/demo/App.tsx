import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DataTable } from '../lib/DataTable'
import { createRecordsClient, createRemoteSource, diffRecords } from '../lib/recordsApi'
import { usePrefersReducedMotion } from '../lib/useMotion'
import type { DataTableRecord } from '../lib/types'

/* Local copies of the prop unions so the dev harness does not couple itself to
   the library's type module. They must stay in sync with src/lib/types.ts. */
type Density = 'comfortable' | 'compact'
type Motion = 'auto' | 'always' | 'never'

/**
 * The two ways the same screen can be fed, and the whole point of the harness
 * now that there is a database behind it.
 *
 * `windowed` hands the table a `RecordSource`: it asks for the page it is about
 * to draw and the two counts in its header, and nothing else is ever in the
 * browser. `whole` is the older arrangement — fetch every record, hand over the
 * array, let the component filter and sort and page it in memory — kept because
 * it is what most hosts will do and because being able to switch between them
 * on one screen is the only honest way to see what the difference costs.
 */
type Mode = 'windowed' | 'whole'

const DEFAULTS = {
  accentColor: '#1d2d46',
  density: 'comfortable' as Density,
  rowsPerPage: 8,
  zebraRows: true,
  cellSelection: true,
  /*
   * The prototype animates by default and only defers to the OS with
   * ?motion=auto, because a presenting machine often has animation effects
   * switched off — on Windows, Settings > Accessibility > Visual effects >
   * Animation effects, which Chrome reports as prefers-reduced-motion: reduce.
   * The library's own default is 'auto' (the handoff asks for that), so the
   * demo has to opt back in or it shows nothing moving.
   */
  motion: 'always' as Motion,
  mode: 'windowed' as Mode,
  /*
   * Only means anything in `whole` mode: how many of the database's hundred
   * thousand rows to pull down and hand over. A thousand rather than all of
   * them, because the last option is meant to be reached for deliberately —
   * `/api/records/all` at a hundred thousand is about forty megabytes of JSON,
   * and the component then filters and sorts every one of them on every
   * keystroke. That is not a bug to be fixed there; it is the measurement that
   * says why the other mode exists.
   */
  rows: 1000,
}

/** What `npm run db:seed` puts back, and what the reseed button asks for. */
const SEED_COUNT = 100_000

const ROW_CHOICES = [17, 1000, 10_000, 100_000]

const format = (n: number) => n.toLocaleString('en-GB')

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

interface Traffic {
  requests: number
  /** Only what the server declared; a chunked response contributes nothing. */
  bytes: number
}

export default function App() {
  const [mode, setMode] = useState<Mode>(DEFAULTS.mode)
  const [traffic, setTraffic] = useState<Traffic>({ requests: 0, bytes: 0 })
  /** Bumped by the reseed button, to build a source that has cached nothing. */
  const [generation, setGeneration] = useState(0)

  /**
   * One client for the app's life, wrapped so the strip can count what the
   * screen actually costs.
   *
   * The size is read off `content-length` rather than by reading the body: the
   * whole-set response is forty megabytes and cloning it to measure it would
   * double that for a number. Absent on a chunked response, which is why the
   * strip says "≥" — it is a floor, not a total.
   */
  const client = useMemo(
    () =>
      createRecordsClient({
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          const declared = Number(response.headers.get('content-length') ?? 0)
          setTraffic((was) => ({
            requests: was.requests + 1,
            bytes: was.bytes + (Number.isFinite(declared) ? declared : 0),
          }))
          return response
        },
      }),
    [],
  )

  /* A new source object per generation: `useSourceWindow` keys its effect on
     the source's identity, so replacing it is how the table is told that
     everything it knew is gone. Nothing else invalidates a reseed — the table
     only re-queries after writes it made itself. */
  const source = useMemo(
    () => createRemoteSource(client),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, generation],
  )

  /* ---- whole-set mode ------------------------------------------------ */

  const [rows, setRows] = useState(DEFAULTS.rows)
  const [records, setRecords] = useState<DataTableRecord[] | null>(null)
  const [loaded, setLoaded] = useState<{ total: number; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)

  /*
   * The array the server is believed to hold, kept in a ref rather than read
   * off state.
   *
   * `onRecordsChange` needs the *previous* list to diff against, and it fires
   * during an event handler where `records` is whatever the last render closed
   * over. Diffing inside a `setRecords` updater would read the right value but
   * run twice under StrictMode, which would post every edit to the server
   * twice. A ref written synchronously is the version that is both current and
   * only current once.
   */
  const latest = useRef<DataTableRecord[]>([])

  const apply = useCallback((next: DataTableRecord[]) => {
    latest.current = next
    setRecords(next)
  }, [])

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      setRecords(null)
      setLoaded(null)
      setError(null)
      const started = performance.now()

      client
        .all(limit, { signal })
        .then((page) => {
          apply(page.records)
          setLoaded({ total: page.total, ms: Math.round(performance.now() - started) })
        })
        .catch((cause: unknown) => {
          if (signal?.aborted) return
          setError(cause instanceof Error ? cause.message : String(cause))
        })
    },
    [apply, client],
  )

  useEffect(() => {
    if (mode !== 'whole') return
    const controller = new AbortController()
    load(rows, controller.signal)
    // Switching the row count mid-flight abandons the response rather than
    // letting a forty megabyte one land after the smaller one it replaced.
    return () => controller.abort()
  }, [load, mode, rows, generation])

  /**
   * Every edit arrives as the whole next array; only what changed is sent.
   *
   * Optimistic: the screen has already moved by the time this is called, and a
   * failed save shows in the strip rather than snapping the table back. It is a
   * dev harness against a local database — a rollback would be more machinery
   * than the failure mode deserves.
   *
   * Windowed mode needs none of this. The source writes through and re-queries
   * on its own, which is the other half of what the mode is worth.
   */
  const handleRecordsChange = useCallback(
    (next: DataTableRecord[]) => {
      const payload = diffRecords(latest.current, next)
      apply(next)
      if (!payload) return

      setSaving((n) => n + 1)
      client
        .sync(payload)
        .catch((cause: unknown) => {
          setError(`save failed — ${cause instanceof Error ? cause.message : String(cause)}`)
        })
        .finally(() => setSaving((n) => n - 1))
    },
    [apply, client],
  )

  const reseed = useCallback(() => {
    setError(null)
    setTraffic({ requests: 0, bytes: 0 })
    client
      .reseed(SEED_COUNT)
      .then(() => setGeneration((n) => n + 1))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [client])

  /* ---- the rest of the harness -------------------------------------- */

  const [accentColor, setAccentColor] = useState(DEFAULTS.accentColor)
  const [density, setDensity] = useState<Density>(DEFAULTS.density)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULTS.rowsPerPage)
  const [zebraRows, setZebraRows] = useState(DEFAULTS.zebraRows)
  const [cellSelection, setCellSelection] = useState(DEFAULTS.cellSelection)
  const [motion, setMotion] = useState<Motion>(DEFAULTS.motion)
  const osReducesMotion = usePrefersReducedMotion()
  const silent = motion === 'never' || (motion === 'auto' && osReducesMotion)

  const reset = () => {
    setMode(DEFAULTS.mode)
    setRows(DEFAULTS.rows)
    setAccentColor(DEFAULTS.accentColor)
    setDensity(DEFAULTS.density)
    setZebraRows(DEFAULTS.zebraRows)
    setCellSelection(DEFAULTS.cellSelection)
    setMotion(DEFAULTS.motion)
    setTraffic({ requests: 0, bytes: 0 })
  }

  const shared = {
    accentColor,
    density,
    rowsPerPage: DEFAULTS.rowsPerPage,
    onRowsPerPageChange: setRowsPerPage,
    zebraRows,
    cellSelection,
    motion,
  }

  return (
    <>
      {/* Dev harness only — deliberately outside .dt-root and deliberately
          un-designed, so it can never be mistaken for part of the screen. */}
      <div className="demo-controls">
        <span className="demo-controls__tag">dev harness</span>

        {/* The control this whole exercise is about. */}
        <label className="demo-controls__field">
          data
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="windowed">windowed (source)</option>
            <option value="whole">whole set (records)</option>
          </select>
        </label>

        <label className="demo-controls__field">
          accentColor
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <code>{accentColor}</code>
        </label>

        {/* Meaningless in windowed mode: there is no set to size, only a page
            to ask for. Disabled rather than hidden, so the strip does not
            reflow every time the mode changes. */}
        <label className="demo-controls__field">
          rows
          <select
            value={rows}
            disabled={mode === 'windowed'}
            onChange={(e) => setRows(Number(e.target.value))}
          >
            {ROW_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {format(choice)}
                {choice === 17 ? ' (the library default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="demo-controls__field">
          density
          <select value={density} onChange={(e) => setDensity(e.target.value as Density)}>
            <option value="comfortable">comfortable</option>
            <option value="compact">compact</option>
          </select>
        </label>

        {/* rowsPerPage is the table's own control now — the prop only seeds
            it, so the harness reports rather than drives it. */}
        <span className="demo-controls__field">
          rowsPerPage
          <code>{rowsPerPage}</code>
        </span>

        <label className="demo-controls__field">
          <input
            type="checkbox"
            checked={zebraRows}
            onChange={(e) => setZebraRows(e.target.checked)}
          />
          zebraRows
        </label>

        <label className="demo-controls__field">
          <input
            type="checkbox"
            checked={cellSelection}
            onChange={(e) => setCellSelection(e.target.checked)}
          />
          cellSelection
        </label>

        <label className="demo-controls__field">
          motion
          <select value={motion} onChange={(e) => setMotion(e.target.value as Motion)}>
            <option value="auto">auto</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
          <code>
            OS: {osReducesMotion ? 'reduced motion' : 'no preference'}
          </code>
        </label>

        {/* What the screen has actually cost so far. In windowed mode this is
            the number worth watching: it goes up by one per page, per search,
            per sort, and each one is a few kilobytes. */}
        <span className="demo-controls__field" role="status">
          traffic
          <code style={{ minWidth: '16ch' }}>
            {traffic.requests} req · ≥{kb(traffic.bytes)}
          </code>
        </span>

        {mode === 'whole' ? (
          <span className="demo-controls__field" role="status">
            loaded
            <code style={{ minWidth: '18ch' }}>
              {error
                ? 'error'
                : records === null
                  ? 'loading…'
                  : `${format(records.length)} of ${format(loaded?.total ?? 0)} in ${loaded?.ms ?? 0}ms`}
            </code>
          </span>
        ) : null}

        {saving > 0 ? (
          <span className="demo-controls__field" role="status">
            <code>saving…</code>
          </span>
        ) : null}

        {silent ? (
          <span className="demo-controls__warn" role="status">
            nothing will animate —{' '}
            {motion === 'never'
              ? 'motion is set to never'
              : 'this machine asks for reduced motion and auto honours it'}
          </span>
        ) : null}

        {/* Edits persist now, so there has to be a way back to the records the
            tests describe. */}
        <button type="button" className="demo-controls__reset" onClick={reseed}>
          reseed db
        </button>

        <button type="button" className="demo-controls__reset" onClick={reset}>
          reset
        </button>
      </div>

      {mode === 'windowed' ? (
        /* No records, no loading state, no write-back: the table asks the
           source for the page it is drawing and the source answers. The whole
           harness contribution is one prop. */
        <DataTable key={`windowed-${generation}`} source={source} {...shared} />
      ) : error ? (
        <div className="demo-controls__warn demo-status" role="alert">
          {error}
          <br />
          the API server is <code>npm run dev:api</code> — <code>npm run dev</code> starts
          it alongside Vite
        </div>
      ) : records === null ? (
        <div className="demo-status" role="status">
          loading {format(rows)} records from sqlite…
        </div>
      ) : (
        <DataTable
          /* Remounted when the set changes: page, selection, sort and the
             filter dock all describe a list that no longer exists. */
          key={`whole-${rows}-${generation}`}
          records={records}
          onRecordsChange={handleRecordsChange}
          {...shared}
        />
      )}
    </>
  )
}

import { useMemo, useState } from 'react'

import { DataTable } from '../lib/DataTable'
import { createDemoRecords } from '../lib/demoData'
import { usePrefersReducedMotion } from '../lib/useMotion'

/* Local copies of the prop unions so the dev harness does not couple itself to
   the library's type module. They must stay in sync with src/lib/types.ts. */
type Density = 'comfortable' | 'compact'
type Motion = 'auto' | 'always' | 'never'

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
  /*
   * A thousand, not the library's own seventeen. Two pages of eight tell you
   * nothing about how this behaves at the size it will actually be used at, and
   * several things only have a shape at all past that point: 125 pages is what
   * the windowed pager exists for, a whole-column selection is a thousand cells
   * rather than eight, and the search runs over every one of them per keystroke.
   * The first seventeen records are the same hand-checked ones either way — see
   * `createDemoRecords`.
   */
  recordCount: 1000,
}

export default function App() {
  const [recordCount, setRecordCount] = useState(DEFAULTS.recordCount)
  /* Rebuilt only when the count changes. The table takes this as
     `defaultRecords` and owns its copy from then on, so a new array here is a
     full reset of the screen — which is what changing the count means, and
     nothing else should trigger it. */
  const records = useMemo(() => createDemoRecords(recordCount), [recordCount])

  const [accentColor, setAccentColor] = useState(DEFAULTS.accentColor)
  const [density, setDensity] = useState<Density>(DEFAULTS.density)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULTS.rowsPerPage)
  const [zebraRows, setZebraRows] = useState(DEFAULTS.zebraRows)
  const [cellSelection, setCellSelection] = useState(DEFAULTS.cellSelection)
  const [motion, setMotion] = useState<Motion>(DEFAULTS.motion)
  const osReducesMotion = usePrefersReducedMotion()
  const silent = motion === 'never' || (motion === 'auto' && osReducesMotion)

  const reset = () => {
    setRecordCount(DEFAULTS.recordCount)
    setAccentColor(DEFAULTS.accentColor)
    setDensity(DEFAULTS.density)
    setZebraRows(DEFAULTS.zebraRows)
    setCellSelection(DEFAULTS.cellSelection)
    setMotion(DEFAULTS.motion)
  }

  return (
    <>
      {/* Dev harness only — deliberately outside .dt-root and deliberately
          un-designed, so it can never be mistaken for part of the screen. */}
      <div className="demo-controls">
        <span className="demo-controls__tag">dev harness</span>

        <label className="demo-controls__field">
          accentColor
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <code>{accentColor}</code>
        </label>

        {/* The count is a remount, not a prop change: `defaultRecords` is read
            once, so the table has to be keyed on it to pick up a new list. */}
        <label className="demo-controls__field">
          records
          <select
            value={recordCount}
            onChange={(e) => setRecordCount(Number(e.target.value))}
          >
            <option value={17}>17 (the library default)</option>
            <option value={100}>100</option>
            <option value={1000}>1000</option>
            <option value={5000}>5000</option>
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

        {silent ? (
          <span className="demo-controls__warn" role="status">
            nothing will animate —{' '}
            {motion === 'never'
              ? 'motion is set to never'
              : 'this machine asks for reduced motion and auto honours it'}
          </span>
        ) : null}

        <button type="button" className="demo-controls__reset" onClick={reset}>
          reset
        </button>
      </div>

      <DataTable
        key={recordCount}
        defaultRecords={records}
        accentColor={accentColor}
        density={density}
        rowsPerPage={DEFAULTS.rowsPerPage}
        onRowsPerPageChange={setRowsPerPage}
        zebraRows={zebraRows}
        cellSelection={cellSelection}
        motion={motion}
      />
    </>
  )
}

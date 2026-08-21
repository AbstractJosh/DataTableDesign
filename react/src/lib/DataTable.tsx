/**
 * Data table — Records / Directory.
 *
 * A React port of the `data-table.html` prototype in this repo. The written
 * spec (exact colours, px values, typography, interaction semantics, derive
 * order) is `design_handoff_data_table/README.md`; `PARITY.md` next to this
 * package lists the behaviours the port has to keep.
 *
 * Everything the component renders is scoped under `.dt-root`, and the two
 * tweakable design tokens (accent, cell padding) are written as inline custom
 * properties on that element — the same mechanism the prototype uses.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

import './DataTable.css'

import {
  clampRect,
  describeRange,
  describeWholeColumn,
  rangeHtml,
  rangeRect,
  rangeSize,
  rangeText,
  writeClipboard,
  type CellRef,
  type RangeRect,
} from './cellRange'
import {
  csvFileName,
  defaultExportName,
  downloadCsv,
  planCsv,
  planSize,
  type ExportPlan,
} from './csv'
import { DetailPane } from './DetailPane'
import { COLUMN_DRAG_MIME, FilterDock } from './FilterDock'
import { COLUMN_TYPES, ENUM_OPTIONS, matchesAll } from './filters'
import { MetricMenu } from './MetricMenu'
import {
  metricCategory,
  metricInForce,
  rangeMetric,
  setMetricPref,
  type MetricKey,
  type MetricResult,
} from './metrics'
import {
  CheckIcon,
  ChevronDownIcon,
  CrossIcon,
  DoneIcon,
  PencilIcon,
  PlusIcon,
  StepDownIcon,
  StepUpIcon,
  TrashIcon,
} from './icons'
import { ALP_LOGO_DATA_URI } from './logo'
import { createDemoRecords } from './demoData'
import { DRAFT_ID, initialState, reducer, type TableAction } from './state'
import { useFlipReorder, type FlipAxis } from './useFlipReorder'
import { useMotionEnabled } from './useMotion'
import {
  COLUMN_LABELS,
  COLUMN_WIDTHS,
  DEFAULT_COLUMNS,
  PILL_CLASS,
  type ColumnKey,
  type DataTableProps,
  type DataTableRecord,
  type DraftRecord,
} from './types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function todayLabel(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
}

/**
 * The prototype stripped every non-digit out of the id and took the max
 * (data-table.html:855-860), which is fine for its closed REC-4813 series but
 * overflows into exponential notation — and then repeats itself — against a
 * host's UUIDs or timestamped ids. Only ids that really are `REC-<int>` feed
 * the series; anything else falls through to the seed.
 */
function nextId(records: DataTableRecord[]): string {
  const nums = records
    .map((r) => Number(/^REC-(\d+)$/.exec(String(r.id))?.[1]))
    .filter((n) => Number.isSafeInteger(n))
  return 'REC-' + ((nums.length ? Math.max(...nums) : 4813) + 7)
}

/** Long enough to outlast the 200ms expand and the 180ms collapse. */
const ANIMATION_FALLBACK_MS = 400

/** Matches the `dt-sum-out` animation; the panel unmounts when it runs out. */
const SUM_FADE_MS = 160

/**
 * PORT ADDITION: how long the export bar takes to open, and in how many steps.
 *
 * The file is built synchronously — the whole of it is already in memory before
 * the bar draws its first frame — so this is not the export taking time. It is
 * the two beats the flow needs to be readable: the press has to land as
 * *something happening*, and the name box that follows has to arrive as the
 * next step of that thing rather than as a box that appeared out of nowhere
 * under the pointer. 480ms buys both and asks for no patience; a real export
 * (a server round trip) would drive the same bar off its own progress and this
 * constant would go.
 *
 * The step count is unchanged at twelve — what shortened is the tick. Fewer,
 * longer steps would have made the sweep visibly hop; twelve at 40ms is one
 * step per two-and-a-bit frames, which still reads as travel.
 *
 * Kept as steps rather than a duration and an easing because the bar reports a
 * number to assistive tech (`aria-valuenow`) as well as painting one, and a
 * step count is the honest unit for both. What the step drives is the bar's
 * *width* — see `.dt-foot-export` in the stylesheet — so the two are one fact
 * rather than a number kept in step with a picture of it.
 */
const EXPORT_STEPS = 12
const EXPORT_TICK_MS = 40

/** The strip's slide back out. The menus' duration (V-17), on the pane's curve. */
const EXPORT_CLOSE_MS = 140

/**
 * The export between the press and the save.
 *
 * The file is snapshotted at the press, not read back at the save: the bar
 * takes the best part of a second to open and nothing stops the user checking
 * another row while it does. What Export exports is what was selected when
 * Export was pressed.
 */
interface ExportRun {
  /**
   * `working` opens the bar, `naming` draws the box it becomes, `closing` is
   * the bar again on its way back out — the last of the three keeps something
   * in the strip for the 180ms it takes to collapse, the way `fadingReading`
   * keeps the last answer on screen for the length of its fade.
   */
  phase: 'working' | 'naming' | 'closing'
  /** 0 to `EXPORT_STEPS`. */
  step: number
  /** The finished file, header row and all. */
  csv: string
  /** The records that went into it, for `onExport`. */
  records: DataTableRecord[]
  /** What the name box holds — seeded from the plan, the user's from then on. */
  name: string
}

/**
 * The flow block's answer, plus the one thing about it that cannot be read off
 * a `MetricResult`: whether it was taken over every page or only over this one.
 * The flag travels *with* the answer rather than beside it so that the fading
 * copy keeps its own scope on the way out — the live selection has already
 * gone by then, and a badge that flickered off a beat before the figure did
 * would be worse than no badge.
 */
interface Reading {
  result: MetricResult
  allPages: boolean
}

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/**
 * The prototype sorts every column with `localeCompare`, which is lexicographic
 * even for dates — that stands, and swapping in real comparators is still the
 * note for whoever wires this to an API. Two numbers are the exception: text
 * order puts 100 before 20, which is plainly wrong on a column of case counts
 * and would be read as a bug in the sum beside it.
 */
function compareCells(a: string, b: string): number {
  const x = Number(a)
  const y = Number(b)
  // `Number('')` is 0, so a blank must not pass for a number here
  if (a.trim() && b.trim() && Number.isFinite(x) && Number.isFinite(y)) return x - y
  return a.localeCompare(b)
}

/**
 * With the drag moved onto the grip, the browser's default drag image would be
 * the `⠿` glyph alone. Hand it the whole row (or header cell) instead, which is
 * what dragging produced while the `<tr>` itself was the source — held at the
 * point the pointer grabbed it. jsdom has no `setDragImage`, hence the guard.
 */
/** Where along `axis` the pointer took hold, and how big the element is. */
type Grab = { offset: number; size: number }

/**
 * Hand the drag its ghost — the row or header itself, anchored so the cursor
 * keeps the exact point of it that was taken hold of, and the drag looks the
 * way that element did when it was the source (DEV-10) — and report that grab
 * back along `axis`, because it is what the slot test has to be corrected by.
 * Null when the browser gave us no `setDragImage` to anchor.
 */
function dragImage(
  event: DragEvent<HTMLElement>,
  source: HTMLElement | null,
  axis: FlipAxis,
): Grab | null {
  const { dataTransfer } = event
  if (!source || typeof dataTransfer?.setDragImage !== 'function') return null
  const box = source.getBoundingClientRect()
  dataTransfer.setDragImage(source, event.clientX - box.left, event.clientY - box.top)
  return axis === 'X'
    ? { offset: event.clientX - box.left, size: box.width }
    : { offset: event.clientY - box.top, size: box.height }
}

/* ------------------------------------------------------------------ *
 * Editors
 * ------------------------------------------------------------------ */

/**
 * One field open for editing. The value is held locally so a keystroke does not
 * re-render the table, and is written back on Enter or on blur — Escape throws
 * it away.
 */
function CellEditor({
  record,
  columnKey,
  onCommit,
  onCancel,
}: {
  record: DataTableRecord
  columnKey: ColumnKey
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(() => String(record[columnKey]))
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Escape unmounts the input; without this the unmount blur would commit.
  const escaped = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <input
      ref={inputRef}
      className="dt-cell-input"
      type="text"
      value={value}
      data-id={record.id}
      data-key={columnKey}
      aria-label={`Edit ${COLUMN_LABELS[columnKey]}`}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit(value)
        } else if (event.key === 'Escape') {
          escaped.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!escaped.current) onCommit(value)
      }}
    />
  )
}

/**
 * A column whose values are a fixed few gets a stack of buttons instead of a
 * text box. Status was the only such column in the prototype; `favouriteSeason`
 * is the second, so the picker asks `ENUM_OPTIONS` what to offer rather than
 * naming a column — a third enum column is a new entry in filters.ts and
 * nothing here.
 *
 * The class stays `dt-status-pick`: it is the stylesheet's name for this
 * control, and two pointer handlers below single the control out by that class.
 * Renaming it would touch three files to say the same thing.
 */
function EnumPicker({
  columnKey,
  current,
  onPick,
}: {
  columnKey: ColumnKey
  current: string
  onPick: (value: string) => void
}) {
  return (
    <div
      className="dt-status-pick"
      role="group"
      aria-label={`Edit ${COLUMN_LABELS[columnKey]}`}
    >
      {(ENUM_OPTIONS[columnKey] ?? []).map((option) => (
        <button
          key={option}
          type="button"
          className={cx(option === current && 'dt-on')}
          onClick={() => onPick(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

interface RowCallbacks {
  onToggleSelect: (id: string) => void
  onToggleExpand: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  onArm: (record: DataTableRecord) => void
  onPickCell: (id: string, key: ColumnKey) => void
  onCommitCell: (id: string, key: ColumnKey, value: string) => void
  onCancelEdit: () => void
  /** An enum cell (status, favourite season) committed one of its options. */
  onSetEnum: (id: string, key: ColumnKey, value: string) => void
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (id: string) => void
  onGripKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void
  onEnterEnd: (id: string) => void
  onCollapseEnd: (id: string) => void
}

interface RecordRowProps extends RowCallbacks {
  record: DataTableRecord
  index: number
  cols: ColumnKey[]
  selected: boolean
  expanded: boolean
  collapseHeight: number | undefined
  entering: boolean
  armed: boolean
  confirming: boolean
  dragging: boolean
  editingKey: ColumnKey | null
  zebra: boolean
  motion: boolean
  rowPosition: string
  /** The cell rectangle, already clamped to the page, or null. */
  range: RangeRect | null
  /** The moving corner of that rectangle, when it is on this row. */
  activeCol: number | null
  /** The one cell in the whole grid that carries `tabIndex=0`. */
  tabCell: CellRef | null
}

function RecordRow(props: RecordRowProps) {
  const {
    record, index, cols, selected, expanded, collapseHeight, entering, armed,
    confirming, dragging, editingKey, zebra, motion, rowPosition,
    range, activeCol, tabCell,
  } = props

  // Narrowed once here so the cell loop below can read the bounds directly.
  const rowRange = range && index >= range.top && index <= range.bottom ? range : null

  const showDetail = expanded || collapseHeight !== undefined

  const wrap = (key: ColumnKey, inner: React.ReactNode) =>
    armed ? (
      <button
        type="button"
        className="dt-pick"
        title={`Edit ${COLUMN_LABELS[key]}`}
        onClick={() => props.onPickCell(record.id, key)}
      >
        {inner}
      </button>
    ) : (
      inner
    )

  const cellContent = (key: ColumnKey) => {
    if (editingKey === key) {
      // The column's own type decides the editor, so `favouriteSeason` gets the
      // same picker `status` does without either of them being named here.
      return COLUMN_TYPES[key] === 'enum' ? (
        <EnumPicker
          columnKey={key}
          current={String(record[key])}
          onPick={(value) => props.onSetEnum(record.id, key, value)}
        />
      ) : (
        <CellEditor
          record={record}
          columnKey={key}
          onCommit={(value) => props.onCommitCell(record.id, key, value)}
          onCancel={props.onCancelEdit}
        />
      )
    }

    // Only `status` gets a pill, not every enum column: the pill's three colours
    // carry the success / in-progress / failed reading, and a season painted the
    // same way would claim a meaning it does not have. `favouriteSeason` falls
    // through to the plain cell text below.
    if (key === 'status') {
      return wrap(
        key,
        <span className={cx('dt-pill', PILL_CLASS[record.status])}>{record.status}</span>,
      )
    }

    if (key === 'name') {
      return (
        <div className="dt-name-cell">
          <button
            type="button"
            className={cx('dt-chevron', expanded && 'dt-open')}
            aria-expanded={expanded}
            aria-label="Toggle details"
            onClick={(event) => props.onToggleExpand(record.id, event)}
          >
            <ChevronDownIcon />
          </button>
          {wrap(key, <span className="dt-name-text">{record.name}</span>)}
        </div>
      )
    }

    // Address alone now: `email` was the other muted column and it has moved to
    // the detail pane. A season is a first-class value, not a secondary one.
    const muted = key === 'address'
    return wrap(key, <span className={cx('dt-cell-text', muted && 'dt-muted')}>{record[key]}</span>)
  }

  /* The action cell has two states. Normally: edit, delete. Awaiting a delete
     confirmation: confirm, cancel — and the confirm deliberately takes the EDIT
     slot, so a second click where the trash button was cancels rather than
     destroys. */
  const actions = confirming ? (
    <>
      <button
        type="button"
        className="dt-icon-btn dt-confirm"
        title="Confirm delete"
        aria-label="Confirm delete"
        onClick={() => props.onConfirmDelete(record.id)}
      >
        <DoneIcon />
      </button>
      <button
        type="button"
        className="dt-icon-btn dt-cancel"
        title="Keep this record"
        aria-label="Cancel delete"
        onClick={props.onCancelDelete}
      >
        <CrossIcon />
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        className={cx('dt-icon-btn', 'dt-edit', armed && 'dt-armed')}
        aria-pressed={armed}
        title={armed ? 'Done editing' : 'Edit record — then pick a field'}
        aria-label={armed ? 'Done editing' : 'Edit record'}
        onClick={() => props.onArm(record)}
      >
        {armed ? <DoneIcon /> : <PencilIcon />}
      </button>
      <button
        type="button"
        className="dt-icon-btn dt-del"
        title="Delete record"
        aria-label="Delete record"
        onClick={() => props.onRequestDelete(record.id)}
      >
        <TrashIcon />
      </button>
    </>
  )

  return (
    <tbody
      data-id={record.id}
      className={cx(
        showDetail && 'dt-expanded',
        zebra && index % 2 === 1 && 'dt-zebra-odd',
        armed && 'dt-picking',
        confirming && 'dt-confirming',
        dragging && 'dt-dragging',
      )}
    >
      <tr className={cx(selected && 'dt-selected')}>
        <td className="dt-cell-grip">
          {/* Only the grip starts a reorder — the rest of the row belongs to
              the cell-range drag. An armed row's grip is not draggable: the
              drag would hijack the click-and-drag that selects text inside the
              open editor. */}
          <span
            className="dt-row-grip"
            role="button"
            tabIndex={0}
            draggable={!armed}
            data-dt-grip="row"
            title="Drag to reorder row"
            aria-label={`Reorder ${record.name}, ${rowPosition}. Hold Alt and press Arrow Up or Arrow Down to move it.`}
            onKeyDown={(event) => props.onGripKeyDown(event, record.id)}
          >
            ⠿
          </span>
        </td>
        <td className="dt-cell-check">
          <button
            type="button"
            className={cx('dt-check-box', selected && 'dt-on')}
            aria-pressed={selected}
            aria-label={`Select ${record.name}`}
            onClick={() => props.onToggleSelect(record.id)}
          >
            {selected ? <CheckIcon /> : null}
          </button>
        </td>
        {cols.map((key, col) => {
          const box = rowRange && col >= rowRange.left && col <= rowRange.right ? rowRange : null
          return (
            <td
              key={key}
              data-key={key}
              data-row={index}
              data-col={col}
              // Roving tabindex: the grid is a single tab stop, and the cell
              // that owns it is the one the arrow keys would move from.
              tabIndex={tabCell ? (tabCell.row === index && tabCell.col === col ? 0 : -1) : undefined}
              className={cx(
                box && 'dt-range',
                box && index === box.top && 'dt-range-t',
                box && index === box.bottom && 'dt-range-b',
                box && col === box.left && 'dt-range-l',
                box && col === box.right && 'dt-range-r',
                activeCol === col && 'dt-range-active',
              )}
            >
              {cellContent(key)}
            </td>
          )
        })}
        <td className="dt-cell-action">
          <div className="dt-row-actions">{actions}</div>
        </td>
      </tr>

      {showDetail ? (
        <DetailPane
          record={record}
          colSpan={cols.length + 3}
          animateIn={entering}
          collapseHeight={collapseHeight}
          motion={motion}
          onEnterEnd={() => props.onEnterEnd(record.id)}
          onCollapseEnd={() => props.onCollapseEnd(record.id)}
        />
      ) : null}
    </tbody>
  )
}

/* ---- the draft row ------------------------------------------------ *
 * A new record lives outside the record list until it is saved, so filtering
 * and sorting can never carry it off mid-typing. It is pinned above the page
 * rows and confirmed with the same check/cross pair as a delete.
 * ------------------------------------------------------------------ */
function DraftRow({
  draft,
  cols,
  editingEnumKey,
  invalid,
  focusToken,
  onPatch,
  onPickEnum,
  onSetEnum,
  onSave,
  onCancel,
}: {
  draft: DraftRecord
  cols: ColumnKey[]
  /** The enum cell whose picker is open, or null. Only one is ever open. */
  editingEnumKey: ColumnKey | null
  invalid: boolean
  focusToken: number
  onPatch: (patch: Partial<DraftRecord>) => void
  onPickEnum: (key: ColumnKey) => void
  onSetEnum: (key: ColumnKey, value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // The token is bumped both when the draft opens and when a save is refused;
  // a refusal is always about `name`, so send focus there rather than to
  // whichever column happens to sit first. `invalid` is read through a ref so
  // that clearing it while typing cannot pull focus out of the field.
  const invalidRef = useRef(invalid)
  invalidRef.current = invalid
  useEffect(() => {
    const target = invalidRef.current ? nameInputRef.current : firstInputRef.current
    target?.focus()
  }, [focusToken])

  let firstAssigned = false

  return (
    <tbody className="dt-draft" data-id={DRAFT_ID}>
      <tr>
        <td className="dt-cell-grip" />
        <td className="dt-cell-check" />
        {cols.map((key) => {
          // Enum columns are picked, not typed, so they take no text input and
          // stay out of the first-input hunt below.
          if (COLUMN_TYPES[key] === 'enum') {
            return (
              <td key={key} data-key={key}>
                {editingEnumKey === key ? (
                  <EnumPicker
                    columnKey={key}
                    current={draft[key]}
                    onPick={(value) => onSetEnum(key, value)}
                  />
                ) : (
                  <button
                    type="button"
                    className="dt-pick"
                    title={`Set ${COLUMN_LABELS[key]}`}
                    onClick={() => onPickEnum(key)}
                  >
                    {/* The pill is status's alone, as in a record row. */}
                    {key === 'status' ? (
                      <span className={cx('dt-pill', PILL_CLASS[draft.status])}>
                        {draft.status}
                      </span>
                    ) : (
                      <span className="dt-cell-text">{draft[key]}</span>
                    )}
                  </button>
                )}
              </td>
            )
          }
          const isFirst = !firstAssigned
          firstAssigned = true
          return (
            <td key={key} data-key={key}>
              <input
                ref={(el) => {
                  if (isFirst) firstInputRef.current = el
                  if (key === 'name') nameInputRef.current = el
                }}
                className={cx('dt-draft-input', invalid && key === 'name' && 'dt-invalid')}
                type="text"
                data-key={key}
                value={draft[key]}
                placeholder={COLUMN_LABELS[key]}
                aria-label={COLUMN_LABELS[key]}
                onChange={(event) => onPatch({ [key]: event.target.value } as Partial<DraftRecord>)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onSave()
                  }
                }}
              />
            </td>
          )
        })}
        <td className="dt-cell-action">
          <div className="dt-row-actions">
            <button
              type="button"
              className="dt-icon-btn dt-save"
              title="Save record"
              aria-label="Save record"
              onClick={onSave}
            >
              <DoneIcon />
            </button>
            <button
              type="button"
              className="dt-icon-btn dt-cancel"
              title="Discard record"
              aria-label="Discard record"
              onClick={onCancel}
            >
              <CrossIcon />
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  )
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

export function DataTable(props: DataTableProps) {
  const {
    records: controlledRecords,
    defaultRecords,
    onRecordsChange,
    columns,
    accentColor = '#1d2d46',
    density = 'comfortable',
    rowsPerPage: initialRowsPerPage = 8,
    onRowsPerPageChange,
    metrics: initialMetrics,
    onMetricsChange,
    zebraRows = true,
    title = 'Data table',
    kicker = 'Records / Directory',
    showHeader = true,
    logoSrc = ALP_LOGO_DATA_URI,
    motion: motionPreference = 'auto',
    cellSelection = true,
    onExport,
    onSelectionChange,
    onEditRecord,
    className,
    style,
    children,
  } = props

  const [internalRecords, setInternalRecords] = useState<DataTableRecord[]>(
    () => (defaultRecords ? defaultRecords.slice() : createDemoRecords()),
  )
  const controlled = controlledRecords !== undefined
  const records = controlled ? controlledRecords : internalRecords

  const commitRecords = useCallback(
    (next: DataTableRecord[]) => {
      if (!controlled) setInternalRecords(next)
      onRecordsChange?.(next)
    },
    [controlled, onRecordsChange],
  )

  // The seeds are read once; `rowsPerPage` and the metric preferences belong to
  // the toolbar after that. A partial `metrics` is merged over the defaults and
  // anything unrecognised in it dropped — the guard is in `initialState`.
  const [state, dispatch] = useReducer(reducer, null, () =>
    initialState(columns ?? DEFAULT_COLUMNS, initialRowsPerPage, initialMetrics),
  )
  const rowsPerPage = state.rowsPerPage

  const rootRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  // The drop marker is positioned against the scroll container rather than the
  // table, so it stays put while the table scrolls under a horizontal drag.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const markerRef = useRef<HTMLDivElement | null>(null)

  const motion = useMotionEnabled(motionPreference)
  const flip = useFlipReorder(tableRef, motion)

  const [draftFocusToken, setDraftFocusToken] = useState(0)
  const [draftInvalid, setDraftInvalid] = useState(false)
  // Discriminated on `kind` so a column drag carries a `ColumnKey` rather than a
  // bare string: the filter dock is handed this id and has to trust it.
  const [drag, setDrag] = useState<
    { kind: 'row'; id: string } | { kind: 'col'; id: ColumnKey } | null
  >(null)
  const [announcement, setAnnouncement] = useState('')
  /** PORT ADDITION: the export in flight — the bar, then the name box. */
  const [exporting, setExporting] = useState<ExportRun | null>(null)
  const exportNameRef = useRef<HTMLInputElement | null>(null)
  const exportCloseTimer = useRef<number | undefined>(undefined)

  // Held off state as well, so a drag never depends on a commit having landed.
  const dragRowRef = useRef<string | null>(null)
  const dragColRef = useRef<ColumnKey | null>(null)
  /**
   * Where the drop would land: how many columns (or rows) would stand before
   * the dragged one. `null` while the pointer is somewhere a drop would mean
   * nothing. Off state for the same reason as the two above — it changes with
   * the pointer, and the one element it moves can be moved without a commit.
   */
  const dropAt = useRef<number | null>(null)
  /**
   * The grab `dragImage` reported, and the reason the slot test is not run on
   * the cursor.
   *
   * A column's own two slots are no-ops, so the dead zone around it runs from
   * the previous neighbour's midpoint to the next one's — about two columns
   * wide. Where in that zone the gesture *starts* is where the grip is, and the
   * grips sit at the leading edge of their cell. Read on the cursor, escaping
   * the zone leftwards costs half a neighbour; escaping it rightwards costs the
   * whole of the dragged column first and then half a neighbour — two and a bit
   * times as far, and felt as having to drag across two columns to move past
   * one. Against the 313px last column it cost 316px, further than the column
   * had left to give, so the second-to-last column read as immovable.
   *
   * Correcting the reading to the middle of the dragged element takes the grab
   * out of it: a move of one place then costs the distance between the two
   * columns' centres, which is the same measure in both directions.
   */
  const grab = useRef<Grab | null>(null)

  // Same reasoning for the cell-range drag: the pointer moves faster than the
  // commits, and the gesture must not depend on one having landed. `live` is
  // false while a press that began on a control (the row chevron) is still
  // undecided — see onCellMouseDown.
  const cellDrag = useRef<{ from: CellRef; live: boolean } | null>(null)
  const [selecting, setSelecting] = useState(false)
  /** Set by whichever handler should pull DOM focus onto the moving corner. */
  const focusCell = useRef(false)

  /* ---- derive: filter (conditions, then query) -> sort -> paginate -> slice ---- */
  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase()

    const list = records.filter((r) => {
      // PORT ADDITION: the dock's chips, ANDed, in place of the prototype's one
      // status dropdown. Chips with no operand yet are skipped rather than
      // matching nothing — see isActive in filters.ts.
      if (!matchesAll(r, state.conditions)) return false
      if (!q) return true
      // PORT: the prototype's fourth searched field was the phone number, which
      // this column set no longer carries. A case count is not something anyone
      // searches for, so the query stays on the three text fields — `email`
      // among them, which is still on the record now that it shows in the
      // detail pane rather than in a column.
      return `${r.name} ${r.email} ${r.address}`.toLowerCase().includes(q)
    })

    if (!state.sort) return list

    const { key, dir } = state.sort
    return list
      .slice()
      .sort((a, b) => compareCells(String(a[key]), String(b[key])) * (dir === 'asc' ? 1 : -1))
  }, [records, state.conditions, state.query, state.sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const page = Math.min(state.page, pageCount - 1)
  const start = page * rowsPerPage
  const visible = filtered.slice(start, start + rowsPerPage)

  // Derived from the records rather than from the selection map: a controlled
  // host can drop a record from under us, and a checked id it has removed must
  // not keep showing up in the Selected count or in onSelectionChange.
  const selectedIds = useMemo(
    () => records.filter((r) => state.selected[r.id]).map((r) => r.id),
    [records, state.selected],
  )
  const selectedCount = selectedIds.length

  /* ---- the cell rectangle ------------------------------------------ *
   * Clamped on the way out: a controlled host can drop records without any
   * action passing through the reducer, so the stored corners can outrun the
   * page they were set on.
   * ------------------------------------------------------------------ */
  const rangeBox = useMemo(
    () =>
      state.range
        ? clampRect(rangeRect(state.range), visible.length, state.cols.length)
        : null,
    [state.range, visible.length, state.cols.length],
  )

  const activeCell: CellRef | null =
    state.range && rangeBox
      ? {
          row: Math.min(state.range.focus.row, visible.length - 1),
          col: Math.min(state.range.focus.col, state.cols.length - 1),
        }
      : null

  /* ---- the whole column (PORT ADDITION) ----------------------------- *
   * The other flavour of cell selection, and the one the rectangle cannot
   * express: every value in one column, across every page. It is still a
   * `RangeRect` — one column wide, top to bottom — but taken over `filtered`
   * rather than over `visible`, which is the whole difference between the two.
   * Everything downstream (the reading, the copy, the announcement) is the
   * existing machinery pointed at that pair instead.
   * ------------------------------------------------------------------ */
  const wholeColumnIndex = state.wholeColumn ? state.cols.indexOf(state.wholeColumn) : -1
  const wholeColumnRect = useMemo<RangeRect | null>(
    () =>
      wholeColumnIndex >= 0 && filtered.length > 0
        ? {
            top: 0,
            bottom: filtered.length - 1,
            left: wholeColumnIndex,
            right: wholeColumnIndex,
          }
        : null,
    [wholeColumnIndex, filtered.length],
  )

  /**
   * The part of the selection that is on this page, in page coordinates —
   * which is all the cells are able to paint. For a rectangle that is the
   * rectangle. For a whole column it is that column's slice of this page, with
   * its top and bottom edges pushed *off* the page wherever the selection
   * carries on past them: `RecordRow` draws an edge where `index` equals
   * `box.top` or `box.bottom`, and no row index is ever `-1` or `visible
   * .length`. So the border closes only where the selection really ends, and
   * an open edge says "there is more of this above / below".
   */
  const paintBox: RangeRect | null =
    rangeBox ??
    (wholeColumnRect && visible.length > 0
      ? {
          top: page === 0 ? 0 : -1,
          bottom: page === pageCount - 1 ? visible.length - 1 : visible.length,
          left: wholeColumnRect.left,
          right: wholeColumnRect.right,
        }
      : null)

  /**
   * What the flow block says about the rectangle — a total, a mean, the share
   * of it reading "Success". The rectangle's own cells decide *which* of those
   * it is: they are read, their category worked out, and that category's
   * preference answers. `null` when they have no one category at all (a column
   * of names, a rectangle half counts and half statuses), and the block then
   * stays away. See metrics.ts.
   */
  const reading = useMemo<Reading | null>(() => {
    // The whole column is read over `filtered`, so the figure covers the pages
    // the reader cannot see — which is the reason to have taken it.
    if (wholeColumnRect) {
      const result = rangeMetric(filtered, state.cols, wholeColumnRect, state.metrics)
      return result && { result, allPages: pageCount > 1 }
    }
    if (!rangeBox) return null
    const result = rangeMetric(visible, state.cols, rangeBox, state.metrics)
    return result && { result, allPages: false }
  }, [wholeColumnRect, rangeBox, filtered, visible, state.cols, state.metrics, pageCount])

  /**
   * The metric the block is displaying, and the section of the selector that is
   * speaking for it. Both fall back with the block: with nothing selected the
   * button names the number preference and no section is marked.
   */
  const inForce = reading ? metricCategory(reading.result.metric) : null
  const showing = metricInForce(state.metrics, reading?.result ?? null)

  /**
   * An answer that has gone away still has to be on screen to fade out, so the
   * panel keeps rendering the last one for the length of the fade. A live
   * answer always wins over it, and with motion off it is skipped entirely —
   * the same rule the FLIP follows.
   */
  const [fadingReading, setFadingReading] = useState<Reading | null>(null)
  const lastReading = useRef<Reading | null>(null)
  const fadeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const previous = lastReading.current
    lastReading.current = reading

    if (reading) {
      window.clearTimeout(fadeTimer.current)
      setFadingReading(null)
      return
    }
    if (!previous || !motion) return

    setFadingReading(previous)
    fadeTimer.current = window.setTimeout(() => setFadingReading(null), SUM_FADE_MS)
  }, [reading, motion])

  useEffect(() => () => window.clearTimeout(fadeTimer.current), [])

  const shownReading = reading ?? fadingReading

  // One tab stop for the whole grid: the moving corner owns it, or the first
  // cell when nothing is selected yet.
  const tabCell: CellRef | null =
    !cellSelection || visible.length === 0 ? null : (activeCell ?? { row: 0, col: 0 })
  const allSelected = visible.length > 0 && visible.every((r) => state.selected[r.id])

  // The page number the user is standing on can outrun the result set (a delete
  // empties the last page); keep the stored value in step with the clamp.
  useEffect(() => {
    if (state.page !== page) dispatch({ type: 'clampPage', page })
  }, [state.page, page])

  const selectionKey = selectedIds.join(',')
  const lastSelection = useRef<string | null>(null)
  useEffect(() => {
    if (lastSelection.current === null) {
      lastSelection.current = selectionKey
      return
    }
    if (lastSelection.current === selectionKey) return
    lastSelection.current = selectionKey
    onSelectionChange?.(selectedIds)
  }, [selectionKey, selectedIds, onSelectionChange])

  /* ---- reordering -------------------------------------------------- */

  const moveRow = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return
      const from = records.findIndex((r) => r.id === fromId)
      const to = records.findIndex((r) => r.id === toId)
      if (from < 0 || to < 0) return
      flip('Y')
      const next = records.slice()
      next.splice(to, 0, next.splice(from, 1)[0])
      commitRecords(next)
      dispatch({ type: 'rowsReordered' }) // reordering clears any active sort
    },
    [records, commitRecords, flip],
  )

  const moveColumn = useCallback(
    (fromKey: ColumnKey, toKey: ColumnKey) => {
      if (fromKey === toKey) return
      if (state.cols.indexOf(fromKey) < 0 || state.cols.indexOf(toKey) < 0) return
      flip('X')
      dispatch({ type: 'moveColumn', from: fromKey, to: toKey })
    },
    [state.cols, flip],
  )

  /* ---- drag: rows and columns share one handler set ---------------- *
   * The reorder is committed on the drop, not on the way past.
   *
   * Splicing on `dragenter` fed itself: the move pulled the target out from
   * under a pointer that had not moved, the pointer landed inside a different
   * column, and that fired the next `dragenter`, which moved it back. A cursor
   * resting anywhere near a boundary made the header flicker — and the FLIP
   * slide, which is 200ms of the `<th>`s travelling under a stationary pointer,
   * kept the events coming on its own.
   *
   * So nothing in the table moves until the drop. What moves is a single 2px
   * rule that snaps to the boundary the dragged column or row would land on,
   * chosen by a midpoint test against the cell under the pointer: one
   * unambiguous answer per pointer position, and the marker steps a whole slot
   * at a time or not at all. The move that follows the drop is the only one,
   * and it gets the same FLIP every other reorder does.
   * ------------------------------------------------------------------ */

  const hideMarker = useCallback(() => {
    dropAt.current = null
    const marker = markerRef.current
    if (marker) marker.style.display = 'none'
  }, [])

  /**
   * Draw the rule across `edge` — a client-space x for a column, y for a row.
   * The marker is absolutely positioned inside the scroll container, so the
   * coordinate comes back into that container's content space and then scrolls
   * with the table for free. The 1px offset straddles the rule over the
   * boundary instead of hanging it off one side.
   *
   * On the frame it appears the slide is suppressed: the marker is coming from
   * wherever the last drag left it, and that is not a journey worth animating.
   */
  const placeMarker = useCallback((axis: FlipAxis, edge: number) => {
    const marker = markerRef.current
    const scroll = scrollRef.current
    const table = tableRef.current
    if (!marker || !scroll || !table) return

    const appearing = marker.style.display !== 'block'
    if (appearing) marker.style.transition = 'none'

    const box = scroll.getBoundingClientRect()
    if (axis === 'X') {
      marker.style.left = `${edge - box.left + scroll.scrollLeft - 1}px`
      marker.style.top = '0px'
      marker.style.width = '2px'
      marker.style.height = `${table.offsetHeight}px`
    } else {
      marker.style.left = '0px'
      marker.style.top = `${edge - box.top + scroll.scrollTop - 1}px`
      marker.style.width = `${table.offsetWidth}px`
      marker.style.height = '2px'
    }

    marker.style.display = 'block'
    if (appearing) {
      void marker.offsetHeight // flush before the transition goes back on
      marker.style.transition = ''
    }
  }, [])

  /** The x of the boundary an insertion at `index` would open. */
  const columnEdge = (index: number) => {
    const table = tableRef.current
    if (!table) return null
    const past = index >= state.cols.length
    const key = state.cols[past ? state.cols.length - 1 : index]
    const th = table.querySelector<HTMLElement>(`th[data-key="${key}"]`)
    if (!th) return null
    const rect = th.getBoundingClientRect()
    return past ? rect.right : rect.left
  }

  /**
   * The same for rows, but measured across the whole `<tbody>`: an expanded
   * row's detail pane travels with it, so the line that means "after this row"
   * belongs under the pane, not between the row and its own detail.
   */
  const rowEdge = (index: number) => {
    const table = tableRef.current
    if (!table) return null
    const past = index >= visible.length
    const record = visible[past ? visible.length - 1 : index]
    if (!record) return null
    const bodies = Array.from(table.querySelectorAll<HTMLElement>('tbody[data-id]'))
    const tbody = bodies.find((el) => el.dataset.id === record.id)
    if (!tbody) return null
    const rect = tbody.getBoundingClientRect()
    return past ? rect.bottom : rect.top
  }

  /**
   * The cursor, moved to the middle of what is being dragged. That is the point
   * a slot is chosen against: the pointer holds the element wherever the grip
   * happened to be, and a reading taken there charges the gesture for the part
   * of its own column it still has to cross. Falls back to the cursor when
   * there is no ghost whose position we could predict.
   */
  const fromMiddle = (client: number) => {
    const held = grab.current
    return held ? client - held.offset + held.size / 2 : client
  }

  /** Idempotent: `dragover` fires far faster than the slot can change. */
  const markDrop = (axis: FlipAxis, index: number) => {
    if (dropAt.current === index) return
    const edge = axis === 'X' ? columnEdge(index) : rowEdge(index)
    if (edge === null) return
    dropAt.current = index
    placeMarker(axis, edge)
  }

  const endDrag = useCallback(() => {
    dragRowRef.current = null
    dragColRef.current = null
    grab.current = null
    hideMarker()
    setDrag(null)
  }, [hideMarker])

  /**
   * A column dropped on the filter dock. Purely additive now: the column stays
   * in the table and the header order is untouched, because the trip up to the
   * dock no longer moves anything on its way past. (It used to reorder the
   * header as it crossed each neighbour, and this handler had to put the
   * pre-drag order back before adding the chip.)
   */
  const onDropColumn = useCallback((key: ColumnKey) => {
    dispatch({ type: 'addCondition', key })
  }, [])

  /**
   * The row and column grips (`⠿`) are the only drag sources — the prototype
   * made the whole `<tr>` and `<th>` draggable, but the cell body now belongs
   * to the range selection, and a native drag there would fight it. Anything
   * else that the browser would happily drag on its own (a cell's text, the
   * logo image) is refused here rather than left to start a drag that reorders
   * nothing.
   */
  const onDragStart = (event: DragEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement
    const grip = target.closest?.('[data-dt-grip]') as HTMLElement | null
    if (!grip) {
      event.preventDefault()
      return
    }

    // A row reorder clears the sort, which can push the dragged record off the
    // page; React then unmounts its <tbody> and the browser fires `dragend` at
    // a detached node, which cannot reach the delegated handler on <table>.
    // Bind the cleanup to the source as well, where it fires either way —
    // otherwise the refs stay set and the next stray dragenter reorders the
    // list. A `dragend` delivered at the grip still bubbles to the row inside
    // the detached subtree, so the row is the safer host for it.
    // (data-table.html:1378-1388)
    const source = grip.closest('th[data-key], tbody[data-id] > tr') as HTMLElement | null
    source?.addEventListener('dragend', endDrag, { once: true })

    if (grip.dataset.dtGrip === 'col') {
      const th = grip.closest('th[data-key]') as HTMLElement | null
      if (!th) return
      const key = th.dataset.key as ColumnKey
      dragColRef.current = key
      setDrag({ kind: 'col', id: key })
      // PORT ADDITION: the payload the filter dock reads. It is a private MIME
      // type, so a column drag can never be confused with the text the browser
      // lets you drag out of a cell, and `dataTransfer.types` carries it through
      // `dragover`, where `getData` is not allowed to answer.
      event.dataTransfer.setData(COLUMN_DRAG_MIME, key)
      // "copyMove", not "move": the header reorder is the move, and the drop on
      // the dock is a copy — the column stays in the table. A dropEffect the
      // effectAllowed does not cover is reset to "none" and the drop is refused.
      event.dataTransfer.effectAllowed = 'copyMove'
      grab.current = dragImage(event, th, 'X')
      return
    }

    const tbody = grip.closest('tbody[data-id]') as HTMLElement | null
    if (tbody && tbody.dataset.id !== DRAFT_ID) {
      dragRowRef.current = tbody.dataset.id as string
      setDrag({ kind: 'row', id: tbody.dataset.id as string })
      event.dataTransfer.effectAllowed = 'move'
      // Near enough a no-op on this axis, the row grip being vertically centred
      // — but it is the same rule, and it earns its keep on a tall row taken by
      // its top or bottom edge.
      grab.current = dragImage(event, tbody.querySelector('tr'), 'Y')
    }
  }

  /**
   * `dragover`, not `dragenter`: it keeps firing while the pointer travels
   * inside a single cell, which is where the midpoint gets crossed.
   * preventDefault is also what makes the table a drop target at all — without
   * it no `drop` ever arrives and the gesture commits nothing.
   */
  const onDragOver = (event: DragEvent<HTMLTableElement>) => {
    const column = dragColRef.current
    const row = dragRowRef.current
    if (!column && !row) return
    event.preventDefault()

    const target = event.target as HTMLElement
    if (!target.closest) return

    if (column) {
      // `data-key` is on the header cell and on every body cell beneath it, so
      // a column can be aimed from anywhere in the table rather than only along
      // the header strip — which is a long way to travel on a tall table.
      const cell = target.closest('[data-key]') as HTMLElement | null
      if (cell) {
        const at = state.cols.indexOf(cell.dataset.key as ColumnKey)
        if (at < 0) return
        const rect = cell.getBoundingClientRect()
        markDrop('X', at + (fromMiddle(event.clientX) >= rect.left + rect.width / 2 ? 1 : 0))
      } else if (target.closest('.dt-col-logo, .dt-col-check, .dt-cell-grip, .dt-cell-check')) {
        // The fixed columns at either end are not slots of their own; they
        // clamp to the ends of the run the user is allowed to reorder.
        markDrop('X', 0)
      } else if (target.closest('.dt-col-action, .dt-cell-action')) {
        markDrop('X', state.cols.length)
      }
      // Anything else — an open detail pane, the strip under the last row —
      // leaves the marker where it is rather than snapping it somewhere the
      // pointer is not pointing.
      return
    }

    const tbody = target.closest('tbody[data-id]') as HTMLElement | null
    if (!tbody || tbody.dataset.id === DRAFT_ID) return
    const at = visible.findIndex((r) => r.id === tbody.dataset.id)
    if (at < 0) return
    // Measured on the first `<tr>` rather than the tbody: an open detail pane
    // would drag the midpoint down below the row it belongs to, and every
    // pointer position over that row would then read as "after".
    const first = tbody.querySelector('tr')
    if (!first) return
    const rect = first.getBoundingClientRect()
    markDrop('Y', at + (fromMiddle(event.clientY) >= rect.top + rect.height / 2 ? 1 : 0))
  }

  /**
   * The pointer has left the table — for the filter dock, most likely, which is
   * where a column drag goes when it is not a reorder. Take the marker down.
   * `dragleave` fires again for every child crossed on the way out, so only a
   * relatedTarget outside the table is a real exit.
   */
  const onDragLeave = (event: DragEvent<HTMLTableElement>) => {
    if (!dragColRef.current && !dragRowRef.current) return
    const to = event.relatedTarget as Node | null
    if (to && event.currentTarget.contains(to)) return
    hideMarker()
  }

  /**
   * The one reorder the gesture makes. `moveColumn` and `moveRow` take the
   * neighbour to land on rather than a slot number, so the insertion index is
   * converted here: a drop to the right of (or below) where the item started
   * lands on whatever is standing in that slot now, one place back.
   *
   * `dropAt` is read before `endDrag` clears it. A drag that ends anywhere the
   * marker never settled — the toolbar, off the window — commits nothing,
   * which is the cancel the old dragenter reorder had no way to offer.
   */
  const onDrop = (event: DragEvent<HTMLTableElement>) => {
    const index = dropAt.current
    const column = dragColRef.current
    const row = dragRowRef.current
    endDrag()
    if (index === null) return

    if (column) {
      event.preventDefault()
      const from = state.cols.indexOf(column)
      const to = state.cols[index > from ? index - 1 : index]
      if (from >= 0 && to) moveColumn(column, to)
      return
    }
    if (row) {
      event.preventDefault()
      const from = visible.findIndex((r) => r.id === row)
      const to = visible[index > from ? index - 1 : index]
      if (from >= 0 && to) moveRow(row, to.id)
    }
  }

  /* ---- keyboard reordering (the prototype has none) ---------------- */

  const announce = (message: string) => setAnnouncement(message)

  const onRowGripKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (!event.altKey) return
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!step) return
    event.preventDefault()

    const at = visible.findIndex((r) => r.id === id)
    const neighbour = visible[at + step]
    if (at < 0 || !neighbour) return

    moveRow(id, neighbour.id)
    const record = visible[at]
    announce(`${record.name} moved to position ${at + step + 1} of ${visible.length}.`)
  }

  const onColGripKeyDown = (event: KeyboardEvent<HTMLElement>, key: ColumnKey) => {
    if (!event.altKey) return
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    event.preventDefault()

    const at = state.cols.indexOf(key)
    const neighbour = state.cols[at + step]
    if (at < 0 || !neighbour) return

    moveColumn(key, neighbour)
    announce(
      `${COLUMN_LABELS[key]} column moved to position ${at + step + 1} of ${state.cols.length}.`,
    )
  }

  /* ---- cell range: the Excel-style rectangle ------------------------ *
   * Independent of the checkbox selection above: a rectangle can sit over rows
   * nothing has checked, and the bulk bar keeps counting only the checkboxes.
   * ------------------------------------------------------------------ */

  const cellAt = (target: EventTarget | null): CellRef | null => {
    if (!(target instanceof Element)) return null
    // `data-row` is on the record rows only — never the draft, the detail
    // panes, or the grip / checkbox / action cells.
    const td = target.closest('td[data-row]') as HTMLElement | null
    if (!td) return null
    return { row: Number(td.dataset.row), col: Number(td.dataset.col) }
  }

  const announceRange = (rect: RangeRect | null) => {
    if (!rect) return
    // The panel itself is aria-hidden, so this is the only way the readout
    // reaches anyone driving the grid from the keyboard — and it says whichever
    // metric these cells actually put in force, in the sentence case a screen
    // reader can read (the panel's tag is upper case, which one spells out
    // letter by letter). The full stop is the caller's, as it always was.
    const answer = rangeMetric(visible, state.cols, rect, state.metrics)
    const said = describeRange(rect, state.cols, visible.length)
    announce(answer ? `${said} ${answer.speech}.` : said)
  }

  /**
   * PORT ADDITION: take one column whole, across every page.
   *
   * The rectangle's own announcement is no use here — it counts rows on the
   * page, and most of what this selects is not on it — so the sentence is its
   * own, with the reading appended exactly as `announceRange` appends it.
   */
  const selectWholeColumn = (key: ColumnKey) => {
    const index = state.cols.indexOf(key)
    // Nothing to select in an empty result set, and a column that is not in the
    // order cannot be pointed at.
    if (index < 0 || filtered.length === 0) return

    dispatch({ type: 'selectColumn', key })

    const rect = { top: 0, bottom: filtered.length - 1, left: index, right: index }
    const answer = rangeMetric(filtered, state.cols, rect, state.metrics)
    const said = describeWholeColumn(key, filtered.length, pageCount)
    announce(answer ? `${said} ${answer.speech}.` : said)
  }

  /**
   * The gesture is on the header *cell*, not on a control inside it, because
   * nothing in the cell wants a third click for itself: the caret sorts on
   * every one of them and the grip drags. Both are excluded here, so the
   * gesture's real target is the label and the space around it — and the sort
   * is left completely alone, which is what splitting the two controls bought.
   */
  const onHeadClick = (event: MouseEvent<HTMLTableCellElement>, key: ColumnKey) => {
    if (!cellSelection || event.detail < 3) return
    if ((event.target as HTMLElement).closest('.dt-grip, .dt-th-sort')) return
    selectWholeColumn(key)
  }

  /**
   * The gesture's keyboard route, on the header's own sort button: Ctrl+Space,
   * which is what a spreadsheet has always used for "this whole column". It
   * hangs off the caret because that is the only focusable thing left in the
   * header cell that belongs to the column rather than to the drag, and it
   * takes the key away from the button's own Space, which sorts.
   */
  const onHeadKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: ColumnKey) => {
    if (!cellSelection || event.key !== ' ') return
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    selectWholeColumn(key)
  }

  const onCellMouseDown = (event: MouseEvent<HTMLTableElement>) => {
    if (!cellSelection || event.button !== 0) return
    const target = event.target as HTMLElement
    const cell = cellAt(target)
    if (!cell) return
    // An open editor keeps the pointer — it is a text field, and the
    // document-level capture above is what commits and closes it.
    if (target.closest('input, textarea, select, .dt-status-pick')) return

    if (event.shiftKey) {
      event.preventDefault()
      focusCell.current = true
      cellDrag.current = { from: cell, live: true }
      setSelecting(true)
      dispatch({ type: 'extendRange', focus: cell })
      return
    }

    // A press that lands on a control (the row chevron, or any cell of an armed
    // row) is left alone until the pointer leaves the cell it started in —
    // otherwise the control would never get its click.
    const control = target.closest('button, a, [role="button"]')
    cellDrag.current = { from: cell, live: !control }
    if (control) return

    // Stop the text selection the browser would otherwise drag out under the
    // pointer. That also cancels the focus it would have moved, so the cell
    // takes it below instead.
    event.preventDefault()
    focusCell.current = true
    setSelecting(true)
    dispatch({ type: 'setRange', anchor: cell })
  }

  const onCellMouseOver = (event: MouseEvent<HTMLTableElement>) => {
    const drag = cellDrag.current
    if (!drag) return
    const cell = cellAt(event.target)
    if (!cell) return

    if (!drag.live) {
      if (cell.row === drag.from.row && cell.col === drag.from.col) return
      drag.live = true
      // The press was left to the control, so the browser has been extending a
      // text selection out of it since; drop it before the rectangle appears.
      document.getSelection()?.removeAllRanges()
      setSelecting(true)
      focusCell.current = true
      dispatch({ type: 'setRange', anchor: drag.from, focus: cell })
      return
    }

    // mouseover fires again when the pointer crosses from a cell's text into
    // its padding; only a real change is worth a render.
    const focus = state.range?.focus
    if (focus && focus.row === cell.row && focus.col === cell.col) return
    dispatch({ type: 'extendRange', focus: cell })
  }

  // Bound once, for the whole life of the component: a drag can end anywhere,
  // including outside the window, and nothing here reads render-time state.
  useEffect(() => {
    const done = () => {
      cellDrag.current = null
      setSelecting(false)
    }
    document.addEventListener('mouseup', done)
    return () => document.removeEventListener('mouseup', done)
  }, [])

  const copyRange = () => {
    // A whole column copies every row the filters left, not the eight on
    // screen: the rows that are not on screen are the reason it was taken.
    const rows = wholeColumnRect ? filtered : visible
    const rect = wholeColumnRect ?? rangeBox
    if (!rect) return
    const { cells } = rangeSize(rect)
    void writeClipboard(
      rangeText(rows, state.cols, rect),
      rangeHtml(rows, state.cols, rect),
    ).then((ok) => {
      announce(
        ok
          ? `Copied ${cells} cell${cells === 1 ? '' : 's'} to the clipboard.`
          : 'The browser refused the copy.',
      )
    })
  }

  /**
   * Arrow keys move the rectangle, Shift+arrow stretches it, Ctrl/Cmd+A takes
   * the page and Ctrl/Cmd+C copies. Only ever while the cell itself holds
   * focus: a button inside a cell keeps its own keys, and so does an editor.
   */
  const onCellKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!cellSelection || event.altKey) return
    const target = event.target as HTMLElement
    if (!target.matches?.('td[data-row]')) return

    const rows = visible.length
    const cols = state.cols.length
    if (!rows || !cols) return

    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (mod && (key === 'c' || key === 'C')) {
      // With nothing selected, leave the copy to the browser.
      if (!rangeBox && !wholeColumnRect) return
      // Taking the keydown's default also cancels the browser's own copy of
      // the (empty) text selection, so there is one clipboard write, not two.
      event.preventDefault()
      copyRange()
      return
    }

    if (mod && (key === 'a' || key === 'A')) {
      event.preventDefault()
      focusCell.current = true
      const whole = { top: 0, left: 0, bottom: rows - 1, right: cols - 1 }
      dispatch({
        type: 'setRange',
        anchor: { row: 0, col: 0 },
        focus: { row: rows - 1, col: cols - 1 },
      })
      announceRange(whole)
      return
    }

    // PORT ADDITION: the spreadsheet key for "this whole column", from inside
    // the grid. The column comes from the cell that holds focus rather than
    // from the rectangle — Ctrl+Space is about where the caret is standing.
    if (mod && key === ' ') {
      event.preventDefault()
      selectWholeColumn(state.cols[Number(target.dataset.col)])
      return
    }

    const from = state.range?.focus ?? {
      row: Number(target.dataset.row),
      col: Number(target.dataset.col),
    }

    let next: CellRef
    if (key === 'ArrowUp') next = { row: from.row - 1, col: from.col }
    else if (key === 'ArrowDown') next = { row: from.row + 1, col: from.col }
    else if (key === 'ArrowLeft') next = { row: from.row, col: from.col - 1 }
    else if (key === 'ArrowRight') next = { row: from.row, col: from.col + 1 }
    else if (key === 'Home') next = { row: mod ? 0 : from.row, col: 0 }
    else if (key === 'End') next = { row: mod ? rows - 1 : from.row, col: cols - 1 }
    else return

    next = { row: clamp(next.row, 0, rows - 1), col: clamp(next.col, 0, cols - 1) }
    event.preventDefault()
    focusCell.current = true

    if (event.shiftKey) {
      dispatch({ type: 'extendRange', focus: next })
      announceRange(rangeRect({ anchor: state.range?.anchor ?? next, focus: next }))
    } else {
      dispatch({ type: 'setRange', anchor: next })
      announceRange(rangeRect({ anchor: next, focus: next }))
    }
  }

  // Runs after every commit, does nothing unless a handler asked for it.
  useEffect(() => {
    if (!focusCell.current) return
    focusCell.current = false
    if (!activeCell) return
    tableRef.current
      ?.querySelector<HTMLElement>(
        `td[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`,
      )
      ?.focus()
  })

  /* ---- record mutations -------------------------------------------- */

  // `editing` read through a ref so a commit is idempotent within one tick: the
  // mousedown listener below commits before the browser moves focus, and the
  // input's own blur would otherwise commit the same value a second time.
  const editingRef = useRef(state.editing)
  editingRef.current = state.editing

  const commitCell = (id: string, key: ColumnKey, raw: string) => {
    if (!editingRef.current) return
    editingRef.current = null
    const value = raw.trim()
    if (value) {
      // refuse to blank a field
      commitRecords(records.map((r) => (r.id === id ? { ...r, [key]: value } : r)))
    }
    dispatch({ type: 'closeEditor' })
  }

  // One writer for every enum column. The value is one of `ENUM_OPTIONS[key]`
  // by construction — the picker offers nothing else — which is the narrowing
  // the computed key hides from TypeScript, exactly as in `commitCell` above.
  const setEnum = (id: string, key: ColumnKey, value: string) => {
    commitRecords(records.map((r) => (r.id === id ? { ...r, [key]: value } : r)))
    dispatch({ type: 'enumSet' }) // back to picking, so another field can follow
  }

  const confirmDelete = (id: string) => {
    commitRecords(records.filter((r) => r.id !== id))
    dispatch({ type: 'dropIds', ids: [id] })
  }

  /**
   * The 400ms fallbacks for an `animationend` that never arrives. They live here
   * rather than in the pane so they outlive its unmount: a row detached
   * mid-flight by a delete, a sort or a page change would otherwise strand the
   * id in `collapsing` / `entering` and replay the animation when it came back.
   * (data-table.html:1226-1250)
   */
  const animationTimers = useRef<Record<string, number>>({})
  useEffect(
    () => () => {
      Object.values(animationTimers.current).forEach(window.clearTimeout)
    },
    [],
  )

  const armAnimationFallback = (id: string, action: TableAction) => {
    window.clearTimeout(animationTimers.current[id])
    animationTimers.current[id] = window.setTimeout(() => {
      delete animationTimers.current[id]
      dispatch(action)
    }, ANIMATION_FALLBACK_MS)
  }

  const toggleExpand = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    if (state.expanded[id]) {
      // Measure before the repaint takes the pane away.
      const grid = event.currentTarget
        .closest('tbody[data-id]')
        ?.querySelector('.dt-detail-grid') as HTMLElement | null
      const height = grid ? Math.ceil(grid.getBoundingClientRect().height) : 440
      dispatch({ type: 'collapse', id, height })
      armAnimationFallback(id, { type: 'endCollapse', id })
    } else {
      dispatch({ type: 'expand', id })
      armAnimationFallback(id, { type: 'endEnter', id })
    }
  }

  /* ---- the draft ---------------------------------------------------- */

  const startDraft = () => {
    setDraftInvalid(false)
    if (!state.draft) {
      const draft: DraftRecord = {
        name: '',
        date: todayLabel(),
        status: 'In progress',
        solvedCases: '0',
        // Both enum cells open on a value rather than blank: the draft row's
        // picker edits a value in place, it has no empty state to show.
        favouriteSeason: 'Spring',
        address: '',
      }
      dispatch({ type: 'startDraft', draft })
    }
    setDraftFocusToken((n) => n + 1)
  }

  const saveDraft = () => {
    const draft = state.draft
    if (!draft) return

    const name = draft.name.trim()
    if (!name && state.cols.includes('name')) {
      // the row needs an identity; the rest may wait
      setDraftInvalid(true)
      setDraftFocusToken((n) => n + 1)
      dispatch({ type: 'cancelDelete' })
      return
    }

    commitRecords([
      {
        id: nextId(records),
        name,
        date: draft.date.trim(),
        status: draft.status,
        solvedCases: draft.solvedCases.trim() || '0',
        favouriteSeason: draft.favouriteSeason,
        address: draft.address.trim(),
        // The draft collects only the visible columns, and `email` is not one
        // any more — it is a detail-pane field now, filled in after the fact
        // like `owner` and `note` below it.
        email: '',
        owner: 'Unassigned',
        activity: 'Just now',
        plan: 'Standard',
        note: '',
      },
      ...records,
    ])
    setDraftInvalid(false)
    dispatch({ type: 'clearDraft' })
    dispatch({ type: 'setPage', page: 0 })
  }

  /**
   * A pointer press outside the open editor closes it, as the prototype's
   * document-level mousedown capture does (data-table.html:1302-1320).
   *
   * A press on a control *inside* the table is deliberately left alone: the
   * action it dispatches closes the editor anyway (see KEEPS_EDITING in
   * state.ts), and closing it here first would resize the row under the cursor
   * between mousedown and mouseup, so the click would miss its target. The
   * enum picker has no blur of its own, so without this it would stay open
   * until Escape.
   */
  useEffect(() => {
    const open = state.editing
    if (!open) return

    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.dt-cell-input, .dt-draft-input, .dt-status-pick')) return

      const control = target.closest('button, input, select, [role="button"]')
      if (control && tableRef.current?.contains(control)) return

      // Only one editor is ever open, so the class alone identifies it.
      const input = tableRef.current?.querySelector<HTMLInputElement>('.dt-cell-input')
      if (input) commitCell(open.id, open.key, input.value)
      else dispatch({ type: 'closeEditor' })
    }

    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  })

  /* ---- export (PORT ADDITION) --------------------------------------- *
   * Press Export, watch the bar open out of the pager and walk Export left,
   * name the file in the box the bar turns into, save. One object doing three
   * things in one place, and the object's *width* is what the flow is made of:
   * zero between exports (so Export sits against the pager), the step's share
   * of `--dt-export-w` while it fills, the whole of it for the name box, and
   * back to zero on the way out. The turn from bar to box is a wipe rather
   * than a cut, and it is pure CSS — `.dt-export-name::after` in the
   * stylesheet, which is also where the widths live.
   * ------------------------------------------------------------------- */

  const selectedRecords = () => records.filter((r) => state.selected[r.id])

  /**
   * What Export would export right now, or `null` if it would export nothing.
   *
   * The order is the order of specificity, not of importance. A cell selection
   * is an explicit "these cells" and answers the question on its own; the
   * checkboxes are the fallback, and the one that means whole records. The two
   * can be live at once (see the header of cellRange.ts) and the button cannot
   * ask which was meant, so the narrower one wins — a user who dragged across
   * four cells after ticking a row is looking at the four cells.
   */
  const exportPlan = (): ExportPlan | null => {
    // Every page of it, which is the reason the column was taken at all.
    if (wholeColumnRect) {
      return {
        source: 'column',
        columns: [state.cols[wholeColumnRect.left]],
        records: filtered,
      }
    }
    if (rangeBox) {
      return {
        source: 'cells',
        columns: state.cols.slice(rangeBox.left, rangeBox.right + 1),
        records: visible.slice(rangeBox.top, rangeBox.bottom + 1),
      }
    }
    const rows = selectedRecords()
    return rows.length ? { source: 'rows', columns: state.cols, records: rows } : null
  }

  const canExport = !exporting && (selectedCount > 0 || !!rangeBox || !!wholeColumnRect)

  const startExport = () => {
    const plan = exportPlan()
    if (!plan) return
    const cells = planSize(plan)
    setExporting({
      phase: 'working',
      step: 0,
      csv: planCsv(plan),
      records: plan.records,
      name: defaultExportName(plan, title),
    })
    announce(`Preparing ${cells} cell${cells === 1 ? '' : 's'} for export.`)
  }

  /**
   * Put the strip away. With motion on that is a 180ms slide back to zero
   * width, Export riding it home — so the run stays in state, on `closing`,
   * until the slide is over. With motion off it is gone on the spot; the
   * closing phase exists only to have something to animate.
   */
  const endExport = () => {
    window.clearTimeout(exportCloseTimer.current)
    if (!motion) {
      setExporting(null)
      return
    }
    setExporting((run) => (run ? { ...run, phase: 'closing' } : null))
    exportCloseTimer.current = window.setTimeout(
      // Guarded: a run started while this one was still sliding out is not
      // this timer's to clear.
      () => setExporting((run) => (run?.phase === 'closing' ? null : run)),
      EXPORT_CLOSE_MS,
    )
  }

  const saveExport = () => {
    if (exporting?.phase !== 'naming') return
    const filename = csvFileName(exporting.name)
    const ok = downloadCsv(filename, exporting.csv)
    endExport()
    if (ok) onExport?.(exporting.records)
    announce(ok ? `Saved ${filename}.` : 'The browser refused the download.')
  }

  const cancelExport = () => {
    if (!exporting || exporting.phase === 'closing') return
    endExport()
    announce('Export cancelled.')
  }

  // One interval per run, restarted only when the phase changes — the ticks
  // themselves go through the updater, so a re-render from anything else (a
  // keystroke in the name box included) does not reset the bar.
  useEffect(() => {
    if (exporting?.phase !== 'working') return
    const id = window.setInterval(() => {
      setExporting((run) => {
        if (run?.phase !== 'working') return run
        const step = run.step + 1
        return step >= EXPORT_STEPS
          ? { ...run, phase: 'naming', step: EXPORT_STEPS }
          : { ...run, step }
      })
    }, EXPORT_TICK_MS)
    return () => window.clearInterval(id)
  }, [exporting?.phase])

  /**
   * The name box opens focused with the suggestion selected, so typing replaces
   * it and Enter alone accepts it.
   *
   * Selected *backwards* — same range, focus at the start rather than the end —
   * because the suggestion can be longer than the box —
   * "data-table-solved-cases" is. `select()` leaves the caret at the end and
   * the browser scrolls to it, so a long name would open showing its tail,
   * "…table-solved-cases", which reads as damage rather than as a name that
   * carries on. `scrollLeft` is put back as well, for the browsers that scroll
   * on the range and not on the direction.
   *
   * `setAnnouncement` rather than `announce`: the wrapper is rebuilt every
   * render and would restart the effect.
   */
  useEffect(() => {
    if (exporting?.phase !== 'naming') return
    const input = exportNameRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(0, input.value.length, 'backward')
    input.scrollLeft = 0
    setAnnouncement('Export ready. Name the file and press Enter to save it.')
  }, [exporting?.phase])

  useEffect(() => () => window.clearTimeout(exportCloseTimer.current), [])

  /* ---- keyboard exits ---------------------------------------------- */

  const { confirmRow, editing, draft, picking, range, wholeColumn } = state

  /**
   * Escape backs out one level at a time. The prototype listens on `document`;
   * scoping it to the root keeps two tables on one page from unwinding each
   * other, and focus is inside the component in every case that can arm one of
   * these modes.
   */
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    // First in the chain, and the only entry that is not reducer state: an
    // export in flight holds an unsaved file and focus, so it is the innermost
    // thing open whenever it is open at all. One that is already sliding out
    // is not open — it holds nothing, and an Escape during those 180ms belongs
    // to whatever is behind it.
    if (exporting && exporting.phase !== 'closing') cancelExport()
    else if (confirmRow) dispatch({ type: 'cancelDelete' })
    else if (editing) dispatch({ type: 'closeEditor' })
    else if (draft) dispatch({ type: 'clearDraft' })
    else if (picking) dispatch({ type: 'armRow', id: picking })
    // last in the chain, so it never swallows an Escape one of the modes above
    // was waiting for
    else if (range || wholeColumn) dispatch({ type: 'clearRange' })
    else return
    event.stopPropagation()
  }

  /* ---- render ------------------------------------------------------- */

  const rootStyle = {
    '--dt-accent': accentColor,
    '--dt-cell-pad-y': density === 'compact' ? '9px' : '15px',
    ...style,
  } as CSSProperties

  const rangeLabel =
    filtered.length === 0
      ? '0'
      : `${start + 1}–${Math.min(start + rowsPerPage, filtered.length)}`

  const goToPage = (next: number) => {
    dispatch({ type: 'setPage', page: Math.max(0, Math.min(next, pageCount - 1)) })
  }

  const setRowsPerPage = (rows: number) => {
    if (rows === rowsPerPage) return
    dispatch({ type: 'setRowsPerPage', rows })
    onRowsPerPageChange?.(rows)
  }

  // Same shape as the slider above: the reducer owns the value, the prop only
  // seeded it, and the host hears about every move. The cell rectangle survives
  // this one — see KEEPS_RANGE in state.ts, without which setting a preference
  // would take away the very selection the block is reporting on.
  //
  // The next record is worked out here as well as in the reducer so the host
  // can be handed it. `setMetricPref` is pure and returns its argument when
  // nothing moves, which is also the no-op guard.
  const setMetric = (next: MetricKey) => {
    const prefs = setMetricPref(state.metrics, next)
    if (prefs === state.metrics) return
    dispatch({ type: 'setMetric', metric: next })
    onMetricsChange?.(prefs)
  }

  return (
    <div
      ref={rootRef}
      className={cx('dt-root', cellSelection && 'dt-cell-select', selecting && 'dt-selecting', className)}
      style={rootStyle}
      data-dt-motion={motionPreference}
      onKeyDown={onRootKeyDown}
    >
      {showHeader ? (
        <div className="dt-page-head">
          <div>
            <div className="dt-kicker">{kicker}</div>
            <h1>{title}</h1>
          </div>
          <div className="dt-stats">
            <div>
              <div className="dt-stat-label">Total</div>
              <div className="dt-stat-value">{records.length}</div>
            </div>
            <div>
              <div className="dt-stat-label">Matching</div>
              <div className="dt-stat-value">{filtered.length}</div>
            </div>
            <div>
              <div className="dt-stat-label">Selected</div>
              <div className="dt-stat-value">{selectedCount}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="dt-toolbar">
        <input
          className="dt-search"
          type="text"
          placeholder="Search name, email or address"
          aria-label="Search records"
          value={state.query}
          onChange={(event) => dispatch({ type: 'setQuery', query: event.target.value })}
        />

        {/* PORT: the status dropdown stood here. It is the filter dock below the
            toolbar now — one column among any of them, rather than the only
            column anything could be filtered by. Nothing takes its place: the
            search keeps its 380px cap and `.dt-spacer` absorbs the width, so the
            controls on the right do not move. */}

        {/* A <div>, deliberately not a <label>. A label's labeled control is
            the first labelable descendant — here the − button, not the input —
            and HTML forwards both activation and :hover from the whole label
            to it. As a <label> this pill decremented the count when you
            clicked the word "Rows", and lit the − button whenever the pointer
            was anywhere inside, including over +. The input names itself with
            aria-label instead, and the tag is decorative. */}
        <div className="dt-rows">
          <span className="dt-rows-tag" aria-hidden="true">Rows</span>
          <button
            type="button"
            className="dt-rows-step"
            aria-label="Decrease rows per page"
            disabled={rowsPerPage <= 1}
            onClick={() => setRowsPerPage(Math.max(1, rowsPerPage - 1))}
          >
            <StepDownIcon />
          </button>
          <input
            className="dt-rows-input"
            type="number"
            min={1}
            step={1}
            value={rowsPerPage}
            aria-label="Rows per page"
            onChange={(event) => {
              const value = Number(event.target.value)
              if (value >= 1) setRowsPerPage(value)
            }}
          />
          <button
            type="button"
            className="dt-rows-step"
            aria-label="Increase rows per page"
            onClick={() => setRowsPerPage(rowsPerPage + 1)}
          >
            <StepUpIcon />
          </button>
        </div>

        <div className="dt-spacer" />

        {/* The flow block: what the cell selection comes to, when it comes to
            anything. It sits after the spacer, so it appears and disappears in
            the gap without moving the buttons to its right. */}
        {shownReading ? (
          <div className={cx('dt-sum', !reading && 'dt-out')} aria-hidden="true">
            <span className="dt-sum-tag">{shownReading.result.tag}</span>
            <span className="dt-sum-value">{shownReading.result.value}</span>
            {/* A rate's "5 of 8". The parentheses belong to the panel rather
                than to the engine's string — they are punctuation around a
                number, not part of it. */}
            {shownReading.result.note ? (
              <span className="dt-sum-note">({shownReading.result.note})</span>
            ) : null}
            {/* PORT ADDITION: the scope, and only when it is not the obvious
                one. A whole-column reading covers rows that are not on screen,
                so a figure four times the size of the visible column needs to
                say why — otherwise it reads as a bug. */}
            {shownReading.allPages ? (
              <span className="dt-sum-scope">all pages</span>
            ) : null}
          </div>
        ) : null}

        {/* PORT ADDITION: what each kind of selection should read as. It stands
            where "Reset order" did — the flow block beside it is the only thing
            in the toolbar it speaks for, and the two want to be read together.
            What it carries — in its name and its tooltip, since a cog has no
            words — is the metric in force rather than a setting of its own, so
            it tracks the selection: drag across counts and it says Sum, drag
            across statuses and it says Success rate, with nothing to set in
            between. */}
        <MetricMenu
          prefs={state.metrics}
          value={showing}
          inForce={inForce}
          onPick={setMetric}
        />

        <button
          type="button"
          className="dt-btn-primary"
          title="New record"
          aria-label="New record"
          onClick={startDraft}
        >
          <PlusIcon />
        </button>
      </div>

      {/* PORT ADDITION: the filter dock. It sits between the toolbar and the
          table because that is the shortest trip a column can make out of the
          header — straight up, into the strip directly above it. */}
      <FilterDock
        conditions={state.conditions}
        columns={state.cols}
        draggingColumn={drag?.kind === 'col' ? drag.id : null}
        onAdd={(key) => dispatch({ type: 'addCondition', key })}
        onDropColumn={onDropColumn}
        onSetOp={(id, op) => dispatch({ type: 'setConditionOp', id, op })}
        onSetValue={(id, patch) => dispatch({ type: 'setConditionValue', id, ...patch })}
        onToggleValue={(id, option) => dispatch({ type: 'toggleConditionValue', id, option })}
        onRemove={(id) => dispatch({ type: 'removeCondition', id })}
        onClearAll={() => dispatch({ type: 'clearConditions' })}
      />

      {children}

      <div className="dt-table-scroll" ref={scrollRef}>
        {/* The insertion marker. One element, moved imperatively from the
            dragover handler — a drag that re-rendered the table on every
            pointer move is the thing this replaces. */}
        <div className="dt-drop-marker" ref={markerRef} aria-hidden="true" />
        <table
          ref={tableRef}
          onMouseDown={onCellMouseDown}
          onMouseOver={onCellMouseOver}
          onKeyDown={onCellKeyDown}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDragEnd={endDrag}
          onDrop={onDrop}
        >
          <thead>
            <tr>
              <th className="dt-col-logo">
                {logoSrc ? <img className="dt-logo" src={logoSrc} alt="" /> : null}
              </th>
              <th className="dt-col-check">
                {/* No `dt-on` here: that rule repaints the border in the
                    accent, which on the accent-coloured header bar would make
                    the box vanish. The prototype only swaps the icon. */}
                <button
                  type="button"
                  className="dt-check-box"
                  aria-pressed={allSelected}
                  aria-label="Select all rows on this page"
                  onClick={() =>
                    dispatch({
                      type: 'setSelection',
                      ids: visible.map((r) => r.id),
                      on: !allSelected,
                    })
                  }
                >
                  {allSelected ? <CheckIcon /> : null}
                </button>
              </th>

              {state.cols.map((key) => {
                const active = state.sort?.key === key
                const ascending = active && state.sort?.dir === 'asc'
                return (
                  <th
                    key={key}
                    data-key={key}
                    className={cx(
                      'dt-col-data',
                      active && 'dt-is-sorted',
                      state.wholeColumn === key && 'dt-col-picked',
                      drag?.kind === 'col' && drag.id === key && 'dt-dragging',
                    )}
                    style={{ width: COLUMN_WIDTHS[key] }}
                    aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
                    onClick={(event) => onHeadClick(event, key)}
                  >
                    <div className="dt-th-inner">
                      {/* As with the rows: the grip is the drag source, so a
                          press on the label still belongs to the sort button. */}
                      {/* PORT ADDITION: this grip does two jobs now — it
                          reorders the column, and it is the only pointer route
                          into the filter dock. The dock says so itself, but only
                          while it is empty, so the grip has to carry it too. The
                          label names "Add filter" because the drag has no
                          keyboard equivalent; that block is the one that does. */}
                      <span
                        className="dt-grip"
                        role="button"
                        tabIndex={0}
                        draggable
                        data-dt-grip="col"
                        title="Drag to reorder the column, or into the filter dock to filter by it"
                        aria-label={`Reorder ${COLUMN_LABELS[key]} column. Hold Alt and press Arrow Left or Arrow Right to move it. To filter by it, drag it into the filter dock or use the dock's Add filter button.`}
                        onKeyDown={(event) => onColGripKeyDown(event, key)}
                      >
                        ⠿
                      </span>
                      {/* PORT ADDITION: the label is not a sort target any
                          more (T-11) — it is where the whole-column gesture
                          lands, and the two cannot share an element: three
                          clicks on a sort control is three sorts, which is
                          what the user sees before the third one arrives. It
                          stays a plain span rather than becoming a third
                          button in the cell, because the header already
                          spends two tab stops per column and the gesture has
                          its keyboard route on the caret beside it. */}
                      <span
                        className="dt-th-label"
                        title={
                          cellSelection
                            ? `Triple click to select the whole ${COLUMN_LABELS[key]} column`
                            : undefined
                        }
                      >
                        {COLUMN_LABELS[key]}
                      </span>
                      {/* The caret alone sorts. It is padded out to a real hit
                          area in the stylesheet, the way the grip is. */}
                      <button
                        type="button"
                        className="dt-th-sort"
                        title={`Sort by ${COLUMN_LABELS[key]}`}
                        aria-label={`Sort by ${COLUMN_LABELS[key]}`}
                        /* The accessible name stays the button's one job. The
                           second gesture is advertised the standard way
                           instead — a name that recited it would be read out
                           on every one of the six headers, every trip through
                           the row, to say something that is true of all of
                           them. */
                        aria-keyshortcuts={cellSelection ? 'Control+Space' : undefined}
                        onClick={() => dispatch({ type: 'toggleSort', key })}
                        onKeyDown={(event) => onHeadKeyDown(event, key)}
                      >
                        <span className={cx('dt-caret', ascending && 'dt-asc')}>▼</span>
                      </button>
                    </div>
                  </th>
                )
              })}

              <th className="dt-col-action">Action</th>
            </tr>
          </thead>

          {/* the draft sits above the page rows */}
          {state.draft ? (
            <DraftRow
              draft={state.draft}
              cols={state.cols}
              editingEnumKey={state.editing?.id === DRAFT_ID ? state.editing.key : null}
              invalid={draftInvalid}
              focusToken={draftFocusToken}
              onPatch={(patch) => {
                setDraftInvalid(false)
                dispatch({ type: 'patchDraft', patch })
              }}
              onPickEnum={(key) => dispatch({ type: 'pickCell', id: DRAFT_ID, key })}
              onSetEnum={(key, value) => dispatch({ type: 'setDraftEnum', key, value })}
              onSave={saveDraft}
              onCancel={() => dispatch({ type: 'clearDraft' })}
            />
          ) : null}

          {visible.map((record, index) => (
            <RecordRow
              key={record.id}
              record={record}
              index={index}
              cols={state.cols}
              selected={!!state.selected[record.id]}
              expanded={!!state.expanded[record.id]}
              collapseHeight={state.collapsing[record.id]}
              entering={!!state.entering[record.id]}
              armed={state.picking === record.id}
              confirming={state.confirmRow === record.id}
              dragging={drag?.kind === 'row' && drag.id === record.id}
              editingKey={state.editing?.id === record.id ? state.editing.key : null}
              zebra={zebraRows}
              motion={motion}
              rowPosition={`row ${index + 1} of ${visible.length}`}
              range={paintBox}
              activeCol={activeCell?.row === index ? activeCell.col : null}
              tabCell={tabCell}
              onToggleSelect={(id) => dispatch({ type: 'toggleSelect', id })}
              onToggleExpand={toggleExpand}
              onArm={(rec) => {
                if (state.picking !== rec.id) onEditRecord?.(rec)
                dispatch({ type: 'armRow', id: rec.id })
              }}
              onPickCell={(id, key) => dispatch({ type: 'pickCell', id, key })}
              onCommitCell={commitCell}
              onCancelEdit={() => dispatch({ type: 'closeEditor' })}
              onSetEnum={setEnum}
              onRequestDelete={(id) => dispatch({ type: 'requestDelete', id })}
              onCancelDelete={() => dispatch({ type: 'cancelDelete' })}
              onConfirmDelete={confirmDelete}
              onGripKeyDown={onRowGripKeyDown}
              onEnterEnd={(id) => dispatch({ type: 'endEnter', id })}
              onCollapseEnd={(id) => dispatch({ type: 'endCollapse', id })}
            />
          ))}
        </table>
      </div>

      {/* a draft row still counts as something on screen */}
      {visible.length === 0 && !state.draft ? (
        <div className="dt-empty">
          <div className="dt-empty-title">No records match</div>
          <div className="dt-empty-body">
            Clear the search field, or loosen a filter in the dock above.
          </div>
        </div>
      ) : null}

      <div className="dt-foot">
        <div className="dt-foot-count">
          Showing <strong>{rangeLabel}</strong> of {filtered.length} entries
        </div>

        {/* PORT: the selection actions and the pager, as one right-hand group.
            Two children, so the footer's own `space-between` still means "count
            left, controls right" — and so a narrow footer wraps the group whole
            instead of dropping the pager to a line of its own and leaving the
            actions stranded above it. */}
        <div className="dt-foot-controls">
          {/* Greyed out with nothing selected. Export keeps its place either
              way, so nothing around it shifts when a selection comes and
              goes. What does move it is an export: the strip to its right
              opens out of the pager and walks it left. */}
          <div className="dt-foot-actions">
            <button
              type="button"
              className="dt-btn-secondary"
              disabled={!canExport}
              onClick={startExport}
            >
              Export
            </button>

            {/* PORT ADDITION: the export's own strip, where Archive stood
                (DEV-22). Zero width between exports — Export stands against
                the pager — then the bar's *width* is the progress: it grows
                out of the pager over 480ms, pushing Export left, and at full
                extent the slab wipes off the box that names the file. */}
            <div
              className={cx(
                'dt-foot-export',
                exporting && exporting.phase !== 'closing' && 'dt-open',
                exporting?.phase === 'closing' && 'dt-closing',
              )}
              style={
                exporting?.phase === 'working'
                  ? // The open width lives in the stylesheet beside everything
                    // else about the strip; this only takes the step's share
                    // of it, so the number is not written down twice.
                    { width: `calc(var(--dt-export-w) * ${exporting.step / EXPORT_STEPS})` }
                  : undefined
              }
            >
              {exporting?.phase === 'working' ? (
                <div
                  className="dt-export-bar"
                  role="progressbar"
                  aria-label="Exporting"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((exporting.step / EXPORT_STEPS) * 100)}
                />
              ) : exporting?.phase === 'naming' ? (
                <div className="dt-export-name">
                  <input
                    ref={exportNameRef}
                    type="text"
                    className="dt-export-input"
                    value={exporting.name}
                    aria-label="Name the exported CSV file"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      const name = event.target.value
                      setExporting((run) => run && { ...run, name })
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      saveExport()
                    }}
                  />
                  {/* Shown, not typed: the box names the file, it does not
                      choose the format. A `.csv` typed into it anyway is
                      folded back out by `csvFileName`. */}
                  <span className="dt-export-ext" aria-hidden="true">.csv</span>
                  <button
                    type="button"
                    className="dt-export-act dt-export-save"
                    title={`Save ${csvFileName(exporting.name)}`}
                    aria-label={`Save ${csvFileName(exporting.name)}`}
                    onClick={saveExport}
                  >
                    <DoneIcon />
                  </button>
                  {/* Escape does this too, and did it alone until now — which
                      made backing out of an export something you had to
                      already know. Save then discard, in the draft row's
                      order and with the draft row's two icons. */}
                  <button
                    type="button"
                    className="dt-export-act dt-export-cancel"
                    title="Cancel the export"
                    aria-label="Cancel the export"
                    onClick={cancelExport}
                  >
                    <CrossIcon />
                  </button>
                </div>
              ) : exporting ? (
                // Closing: the bar again, with nothing to say — it is only
                // here to be the thing the collapsing strip is collapsing.
                <div className="dt-export-bar" aria-hidden="true" />
              ) : null}
            </div>
          </div>

          <div className="dt-pager">
            <button
              type="button"
              className="dt-pager-nav"
              disabled={page === 0}
              onClick={() => goToPage(page - 1)}
            >
              ‹ Prev
            </button>
            <span style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: pageCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={cx('dt-pager-num', i === page && 'dt-active')}
                  aria-current={i === page ? 'page' : undefined}
                  onClick={() => goToPage(i)}
                >
                  {i + 1}
                </button>
              ))}
            </span>
            <button
              type="button"
              className="dt-pager-nav"
              disabled={page >= pageCount - 1}
              onClick={() => goToPage(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      </div>

      <div className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}

export default DataTable

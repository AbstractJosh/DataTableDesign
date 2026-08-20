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
  rangeHtml,
  rangeRect,
  rangeSize,
  rangeText,
  writeClipboard,
  type CellRef,
  type RangeRect,
} from './cellRange'
import { DetailPane } from './DetailPane'
import { FilterMenu } from './FilterMenu'
import {
  CheckIcon,
  ChevronDownIcon,
  CrossIcon,
  DoneIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './icons'
import { ALP_LOGO_DATA_URI } from './logo'
import { createDemoRecords } from './demoData'
import { DRAFT_ID, initialState, reducer, type TableAction } from './state'
import { useFlipReorder } from './useFlipReorder'
import { useMotionEnabled } from './useMotion'
import {
  COLUMN_LABELS,
  COLUMN_WIDTHS,
  DEFAULT_COLUMNS,
  PILL_CLASS,
  STATUSES,
  STATUS_FILTERS,
  type ColumnKey,
  type DataTableProps,
  type DataTableRecord,
  type DraftRecord,
  type RecordStatus,
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

/** The toolbar slider's bounds. A host opening outside them widens them. */
const ROWS_PER_PAGE_MIN = 4
const ROWS_PER_PAGE_MAX = 24

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/**
 * With the drag moved onto the grip, the browser's default drag image would be
 * the `⠿` glyph alone. Hand it the whole row (or header cell) instead, which is
 * what dragging produced while the `<tr>` itself was the source — held at the
 * point the pointer grabbed it. jsdom has no `setDragImage`, hence the guard.
 */
function dragImage(event: DragEvent<HTMLElement>, source: HTMLElement | null) {
  const { dataTransfer } = event
  if (!source || typeof dataTransfer?.setDragImage !== 'function') return
  const box = source.getBoundingClientRect()
  dataTransfer.setDragImage(source, event.clientX - box.left, event.clientY - box.top)
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
 * Status is an enum that drives the pill colours, so it gets a three-way picker
 * instead of a text box.
 */
function StatusPicker({
  current,
  onPick,
}: {
  current: RecordStatus
  onPick: (status: RecordStatus) => void
}) {
  return (
    <div className="dt-status-pick" role="group" aria-label="Edit status">
      {STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          className={cx(status === current && 'dt-on')}
          onClick={() => onPick(status)}
        >
          {status}
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
  onSetStatus: (id: string, status: RecordStatus) => void
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
      return key === 'status' ? (
        <StatusPicker
          current={record.status}
          onPick={(status) => props.onSetStatus(record.id, status)}
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

    const muted = key === 'email' || key === 'address'
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
  editingStatus,
  invalid,
  focusToken,
  onPatch,
  onPickStatus,
  onSetStatus,
  onSave,
  onCancel,
}: {
  draft: DraftRecord
  cols: ColumnKey[]
  editingStatus: boolean
  invalid: boolean
  focusToken: number
  onPatch: (patch: Partial<DraftRecord>) => void
  onPickStatus: () => void
  onSetStatus: (status: RecordStatus) => void
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
          if (key === 'status') {
            return (
              <td key={key} data-key={key}>
                {editingStatus ? (
                  <StatusPicker current={draft.status} onPick={onSetStatus} />
                ) : (
                  <button type="button" className="dt-pick" title="Set status" onClick={onPickStatus}>
                    <span className={cx('dt-pill', PILL_CLASS[draft.status])}>{draft.status}</span>
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
    zebraRows = true,
    title = 'Data table',
    kicker = 'Records / Directory',
    showHeader = true,
    logoSrc = ALP_LOGO_DATA_URI,
    motion: motionPreference = 'auto',
    cellSelection = true,
    onExport,
    onArchive,
    onSelectionChange,
    onEditRecord,
    className,
    style,
    children,
  } = props

  const defaultCols = useMemo(() => columns ?? DEFAULT_COLUMNS, [columns])

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

  // The seed is read once; `rowsPerPage` belongs to the toolbar after that.
  const [state, dispatch] = useReducer(reducer, null, () =>
    initialState(defaultCols, initialRowsPerPage),
  )
  const rowsPerPage = state.rowsPerPage

  const rootRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)

  const motion = useMotionEnabled(motionPreference)
  const flip = useFlipReorder(tableRef, motion)

  const [draftFocusToken, setDraftFocusToken] = useState(0)
  const [draftInvalid, setDraftInvalid] = useState(false)
  const [drag, setDrag] = useState<{ kind: 'row' | 'col'; id: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Held off state as well, so a drag never depends on a commit having landed.
  const dragRowRef = useRef<string | null>(null)
  const dragColRef = useRef<string | null>(null)

  // Same reasoning for the cell-range drag: the pointer moves faster than the
  // commits, and the gesture must not depend on one having landed. `live` is
  // false while a press that began on a control (the row chevron) is still
  // undecided — see onCellMouseDown.
  const cellDrag = useRef<{ from: CellRef; live: boolean } | null>(null)
  const [selecting, setSelecting] = useState(false)
  /** Set by whichever handler should pull DOM focus onto the moving corner. */
  const focusCell = useRef(false)

  /* ---- derive: filter (status, then query) -> sort -> paginate -> slice ---- */
  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase()

    const list = records.filter((r) => {
      if (state.filter !== 'All' && r.status !== state.filter) return false
      if (!q) return true
      return `${r.name} ${r.email} ${r.address} ${r.mobile}`.toLowerCase().includes(q)
    })

    if (!state.sort) return list

    const { key, dir } = state.sort
    // Lexicographic on purpose — swap in real date/number comparators when this
    // is wired to a real API.
    return list
      .slice()
      .sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (dir === 'asc' ? 1 : -1))
  }, [records, state.filter, state.query, state.sort])

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

  /* ---- drag: rows and columns share one handler set ---------------- */

  const endDrag = useCallback(() => {
    dragRowRef.current = null
    dragColRef.current = null
    setDrag(null)
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
      dragColRef.current = th.dataset.key as string
      setDrag({ kind: 'col', id: th.dataset.key as string })
      event.dataTransfer.effectAllowed = 'move'
      dragImage(event, th)
      return
    }

    const tbody = grip.closest('tbody[data-id]') as HTMLElement | null
    if (tbody && tbody.dataset.id !== DRAFT_ID) {
      dragRowRef.current = tbody.dataset.id as string
      setDrag({ kind: 'row', id: tbody.dataset.id as string })
      event.dataTransfer.effectAllowed = 'move'
      dragImage(event, tbody.querySelector('tr'))
    }
  }

  const onDragEnter = (event: DragEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement
    if (!target.closest) return

    if (dragColRef.current) {
      const th = target.closest('th[data-key]') as HTMLElement | null
      if (th) moveColumn(dragColRef.current as ColumnKey, th.dataset.key as ColumnKey)
      return
    }
    if (dragRowRef.current) {
      const tbody = target.closest('tbody[data-id]') as HTMLElement | null
      if (tbody) moveRow(dragRowRef.current, tbody.dataset.id as string)
    }
  }

  const onDragOver = (event: DragEvent<HTMLTableElement>) => {
    if (dragRowRef.current || dragColRef.current) event.preventDefault()
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
    if (rect) announce(describeRange(rect, state.cols, visible.length))
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
    if (!rangeBox) return
    const { cells } = rangeSize(rangeBox)
    void writeClipboard(
      rangeText(visible, state.cols, rangeBox),
      rangeHtml(visible, state.cols, rangeBox),
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
      if (!rangeBox) return
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

  const setStatus = (id: string, status: RecordStatus) => {
    commitRecords(records.map((r) => (r.id === id ? { ...r, status } : r)))
    dispatch({ type: 'statusSet' }) // back to picking, so another field can follow
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
        mobile: '',
        email: '',
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
        mobile: draft.mobile.trim(),
        email: draft.email.trim(),
        address: draft.address.trim(),
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
   * status picker has no blur of its own, so without this it would stay open
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

  /* ---- keyboard exits ---------------------------------------------- */

  const { confirmRow, editing, draft, picking, range } = state

  /**
   * Escape backs out one level at a time. The prototype listens on `document`;
   * scoping it to the root keeps two tables on one page from unwinding each
   * other, and focus is inside the component in every case that can arm one of
   * these modes.
   */
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    if (confirmRow) dispatch({ type: 'cancelDelete' })
    else if (editing) dispatch({ type: 'closeEditor' })
    else if (draft) dispatch({ type: 'clearDraft' })
    else if (picking) dispatch({ type: 'armRow', id: picking })
    // last in the chain, so it never swallows an Escape one of the modes above
    // was waiting for
    else if (range) dispatch({ type: 'clearRange' })
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

  // The slider's own range, widened if the host opened on a value outside it.
  const rowsMin = Math.min(ROWS_PER_PAGE_MIN, initialRowsPerPage)
  const rowsMax = Math.max(ROWS_PER_PAGE_MAX, initialRowsPerPage)

  const setRowsPerPage = (rows: number) => {
    if (rows === rowsPerPage) return
    dispatch({ type: 'setRowsPerPage', rows })
    onRowsPerPageChange?.(rows)
  }

  const selectedRecords = () => records.filter((r) => state.selected[r.id])

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

        <FilterMenu
          label="Status"
          value={state.filter}
          options={STATUS_FILTERS}
          onPick={(filter) => dispatch({ type: 'setFilter', filter })}
        />

        <label className="dt-rows">
          <span className="dt-rows-tag">Rows</span>
          <input
            className="dt-rows-range"
            type="range"
            min={rowsMin}
            max={rowsMax}
            step={1}
            value={rowsPerPage}
            aria-label="Rows per page"
            aria-valuetext={`${rowsPerPage} rows per page`}
            onChange={(event) => setRowsPerPage(Number(event.target.value))}
          />
          <span className="dt-rows-value">{rowsPerPage}</span>
        </label>

        <div className="dt-spacer" />

        {/* Selection actions — greyed out with nothing selected. They keep their
            place in the toolbar either way, so the table never shifts. */}
        <div className="dt-tool-actions">
          <button
            type="button"
            className="dt-btn-secondary"
            disabled={selectedCount === 0}
            onClick={() => onExport?.(selectedRecords())}
          >
            Export
          </button>
          <button
            type="button"
            className="dt-btn-secondary"
            disabled={selectedCount === 0}
            onClick={() => onArchive?.(selectedRecords())}
          >
            Archive
          </button>
        </div>

        <button
          type="button"
          className="dt-btn-secondary"
          onClick={() => dispatch({ type: 'resetOrder', cols: defaultCols })}
        >
          Reset order
        </button>
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

      {children}

      <div className="dt-table-scroll">
        <table
          ref={tableRef}
          onMouseDown={onCellMouseDown}
          onMouseOver={onCellMouseOver}
          onKeyDown={onCellKeyDown}
          onDragStart={onDragStart}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragEnd={endDrag}
          onDrop={endDrag}
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
                      drag?.kind === 'col' && drag.id === key && 'dt-dragging',
                    )}
                    style={{ width: COLUMN_WIDTHS[key] }}
                    aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="dt-th-inner">
                      {/* As with the rows: the grip is the drag source, so a
                          press on the label still belongs to the sort button. */}
                      <span
                        className="dt-grip"
                        role="button"
                        tabIndex={0}
                        draggable
                        data-dt-grip="col"
                        title="Drag to reorder column"
                        aria-label={`Reorder ${COLUMN_LABELS[key]} column. Hold Alt and press Arrow Left or Arrow Right to move it.`}
                        onKeyDown={(event) => onColGripKeyDown(event, key)}
                      >
                        ⠿
                      </span>
                      {/* Label and caret share one control, so the arrow is part
                          of the hit area. */}
                      <button
                        type="button"
                        className="dt-th-sort"
                        title={`Sort by ${COLUMN_LABELS[key]}`}
                        aria-label={`Sort by ${COLUMN_LABELS[key]}`}
                        onClick={() => dispatch({ type: 'toggleSort', key })}
                      >
                        <span className="dt-th-label">{COLUMN_LABELS[key]}</span>
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
              editingStatus={state.editing?.id === DRAFT_ID && state.editing.key === 'status'}
              invalid={draftInvalid}
              focusToken={draftFocusToken}
              onPatch={(patch) => {
                setDraftInvalid(false)
                dispatch({ type: 'patchDraft', patch })
              }}
              onPickStatus={() => dispatch({ type: 'pickCell', id: DRAFT_ID, key: 'status' })}
              onSetStatus={(status) => dispatch({ type: 'setDraftStatus', status })}
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
              range={rangeBox}
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
              onSetStatus={setStatus}
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
            Clear the search field or pick a different status filter.
          </div>
        </div>
      ) : null}

      <div className="dt-foot">
        <div className="dt-foot-count">
          Showing <strong>{rangeLabel}</strong> of {filtered.length} entries
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

      <div className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}

export default DataTable

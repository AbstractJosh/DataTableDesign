/**
 * All of the table's interaction state in one reducer.
 *
 * The record list itself lives outside this reducer (it can be controlled by the
 * host), so actions that change records carry only the id bookkeeping.
 */
import type { CellRange, CellRef } from './cellRange'
import {
  DEFAULT_COLUMNS,
  type ColumnKey,
  type DraftRecord,
  type RecordStatus,
  type SortState,
  type StatusFilter,
} from './types'

export const DRAFT_ID = '__draft__'

export interface TableState {
  cols: ColumnKey[]
  selected: Record<string, boolean>
  expanded: Record<string, boolean>
  sort: SortState
  query: string
  filter: StatusFilter
  page: number
  /** Owned here, not by the prop: the toolbar's slider changes it. */
  rowsPerPage: number
  /** Record id whose fields are armed for editing (the pencil is pressed). */
  picking: string | null
  /** The one field currently open in an editor. */
  editing: { id: string; key: ColumnKey } | null
  /** Record id whose delete is awaiting confirmation. */
  confirmRow: string | null
  /** The unsaved new record, pinned above the page rows. */
  draft: DraftRecord | null
  /** Ids whose detail pane should play its enter animation when it mounts. */
  entering: Record<string, true>
  /**
   * Ids whose detail pane is animating out: no longer expanded, but kept
   * mounted at its measured height until the animation reports back.
   */
  collapsing: Record<string, number>
  /**
   * The Excel-style cell rectangle, in page coordinates (see cellRange.ts).
   * Independent of `selected`: a range can sit over rows nothing has checked.
   */
  range: CellRange | null
}

export const DEFAULT_ROWS_PER_PAGE = 8

export function initialState(
  cols: ColumnKey[] = DEFAULT_COLUMNS,
  rowsPerPage: number = DEFAULT_ROWS_PER_PAGE,
): TableState {
  return {
    cols: cols.slice(),
    rowsPerPage,
    selected: {},
    expanded: {},
    sort: null,
    query: '',
    filter: 'All',
    page: 0,
    picking: null,
    editing: null,
    confirmRow: null,
    draft: null,
    entering: {},
    collapsing: {},
    range: null,
  }
}

export type TableAction =
  | { type: 'setQuery'; query: string }
  | { type: 'setFilter'; filter: StatusFilter }
  | { type: 'setPage'; page: number }
  | { type: 'setRowsPerPage'; rows: number }
  /** Silently follow a shrinking result set; not a navigation. */
  | { type: 'clampPage'; page: number }
  | { type: 'toggleSort'; key: ColumnKey }
  | { type: 'resetOrder'; cols: ColumnKey[] }
  | { type: 'moveColumn'; from: ColumnKey; to: ColumnKey }
  /** A row reorder clears any active sort; a column reorder does not. */
  | { type: 'rowsReordered' }
  | { type: 'toggleSelect'; id: string }
  | { type: 'setSelection'; ids: string[]; on: boolean }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string; height: number }
  | { type: 'endCollapse'; id: string }
  | { type: 'endEnter'; id: string }
  | { type: 'armRow'; id: string }
  | { type: 'pickCell'; id: string; key: ColumnKey }
  | { type: 'closeEditor' }
  | { type: 'statusSet' }
  | { type: 'requestDelete'; id: string }
  | { type: 'cancelDelete' }
  | { type: 'dropIds'; ids: string[] }
  | { type: 'startDraft'; draft: DraftRecord }
  | { type: 'patchDraft'; patch: Partial<DraftRecord> }
  | { type: 'setDraftStatus'; status: RecordStatus }
  | { type: 'clearDraft' }
  /** Start a range at `anchor` (a click, or an arrow key without Shift). */
  | { type: 'setRange'; anchor: CellRef; focus?: CellRef }
  /** Move the far corner — a drag, a Shift+click or a Shift+arrow. */
  | { type: 'extendRange'; focus: CellRef }
  | { type: 'clearRange' }
  /** Anything that reshuffles which rows are on screen drops the per-row modes. */
  | { type: 'clearTransient' }

/**
 * In the prototype every click on a `[data-act]` element backs out of a pending
 * delete, except the ones that drive the confirmation itself. Everything that is
 * not a click (animation callbacks, drags, typing in the draft) leaves it be.
 */
const KEEPS_PENDING_DELETE: ReadonlySet<TableAction['type']> = new Set<TableAction['type']>([
  'clampPage',
  'requestDelete',
  'cancelDelete',
  'endCollapse',
  'endEnter',
  'moveColumn',
  'rowsReordered',
  'patchDraft',
  'dropIds',
])

/**
 * In the prototype a document-level mousedown capture commits and closes the
 * open editor before any other click lands (data-table.html:1302-1320), so every
 * interaction dismisses it. React keeps the clicked node alive across the
 * re-render, so the same rule is expressed here instead: an action closes the
 * editor unless it is one that owns it, or one that is not a click at all
 * (animation callbacks, drags, typing in the draft).
 */
const KEEPS_EDITING: ReadonlySet<TableAction['type']> = new Set<TableAction['type']>([
  'clampPage',
  'pickCell',
  'patchDraft',
  'endCollapse',
  'endEnter',
  'moveColumn',
  'rowsReordered',
])

/**
 * A cell range is a rectangle over the rows and columns as they are laid out
 * right now, so only actions that leave that layout alone may keep it. Toggling
 * a checkbox, expanding a pane and the animation callbacks all qualify;
 * searching, sorting, paging, reordering and opening an editor do not.
 */
const KEEPS_RANGE: ReadonlySet<TableAction['type']> = new Set<TableAction['type']>([
  'setRange',
  'extendRange',
  'clampPage',
  'toggleSelect',
  'setSelection',
  'expand',
  'collapse',
  'endEnter',
  'endCollapse',
])

/** Drop the per-row modes and cancel any animation still in flight. */
function cleared(state: TableState): TableState {
  return {
    ...state,
    picking: null,
    editing: null,
    confirmRow: null,
    collapsing: {},
    entering: {},
    range: null,
  }
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!(id in map)) return map
  const next = { ...map }
  delete next[id]
  return next
}

export function reducer(state: TableState, action: TableAction): TableState {
  let next = apply(state, action)
  if (next.confirmRow && !KEEPS_PENDING_DELETE.has(action.type)) {
    next = { ...next, confirmRow: null }
  }
  if (next.editing && !KEEPS_EDITING.has(action.type)) {
    next = { ...next, editing: null }
  }
  if (next.range && !KEEPS_RANGE.has(action.type)) {
    next = { ...next, range: null }
  }
  return next
}

function apply(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'setQuery':
      return { ...cleared(state), query: action.query, page: 0 }

    case 'setFilter':
      return { ...cleared(state), filter: action.filter, page: 0 }

    case 'setPage':
      return { ...cleared(state), page: action.page }

    case 'setRowsPerPage': {
      if (action.rows === state.rowsPerPage) return state
      // Follow the record the user is looking at rather than snapping back to
      // page 1 — dragging the slider would otherwise throw the list away on
      // every step. An overshoot at the end is pulled back by the clamp.
      const first = state.page * state.rowsPerPage
      return {
        ...cleared(state),
        rowsPerPage: action.rows,
        page: Math.floor(first / action.rows),
      }
    }

    case 'clampPage':
      // The prototype clamps `state.page` inside render() without running
      // clearEditing(), so an armed row survives a delete that shortens the
      // list. (data-table.html:1032-1034)
      return state.page === action.page ? state : { ...state, page: action.page }

    case 'toggleSort': {
      // ascending -> descending -> unsorted
      const { key } = action
      const sort: SortState =
        state.sort && state.sort.key === key
          ? state.sort.dir === 'asc'
            ? { key, dir: 'desc' }
            : null
          : { key, dir: 'asc' }
      return { ...state, sort }
    }

    case 'resetOrder':
      return { ...cleared(state), sort: null, cols: action.cols.slice() }

    case 'moveColumn': {
      const from = state.cols.indexOf(action.from)
      const to = state.cols.indexOf(action.to)
      if (from < 0 || to < 0 || from === to) return state
      const cols = state.cols.slice()
      cols.splice(to, 0, cols.splice(from, 1)[0])
      return { ...state, cols }
    }

    case 'rowsReordered':
      return { ...state, sort: null }

    case 'toggleSelect':
      return {
        ...state,
        selected: { ...state.selected, [action.id]: !state.selected[action.id] },
      }

    case 'setSelection': {
      const selected = { ...state.selected }
      action.ids.forEach((id) => {
        selected[id] = action.on
      })
      return { ...state, selected }
    }

    case 'expand':
      return {
        ...state,
        expanded: { ...state.expanded, [action.id]: true },
        // re-opening mid-collapse cancels the collapse
        collapsing: without(state.collapsing, action.id),
        entering: { ...state.entering, [action.id]: true },
      }

    case 'collapse':
      return {
        ...state,
        expanded: without(state.expanded, action.id),
        // cancel an expand still in flight
        entering: without(state.entering, action.id),
        collapsing: { ...state.collapsing, [action.id]: action.height },
      }

    case 'endCollapse':
      if (!(action.id in state.collapsing)) return state
      return { ...state, collapsing: without(state.collapsing, action.id) }

    case 'endEnter':
      if (!(action.id in state.entering)) return state
      return { ...state, entering: without(state.entering, action.id) }

    case 'armRow':
      // The pencil arms the row rather than opening one fixed field.
      return {
        ...state,
        picking: state.picking === action.id ? null : action.id,
        editing: null,
      }

    case 'pickCell':
      return { ...state, editing: { id: action.id, key: action.key } }

    case 'closeEditor':
      return { ...state, editing: null }

    case 'statusSet':
      // back to picking, so another field can follow
      return { ...state, editing: null }

    case 'requestDelete':
      // editing and deleting are separate intents
      return { ...state, confirmRow: action.id, picking: null, editing: null }

    case 'cancelDelete':
      return { ...state, confirmRow: null }

    case 'dropIds': {
      const doomed = new Set(action.ids)
      const selected = { ...state.selected }
      const expanded = { ...state.expanded }
      const entering = { ...state.entering }
      const collapsing = { ...state.collapsing }
      doomed.forEach((id) => {
        delete selected[id]
        delete expanded[id]
        delete entering[id]
        delete collapsing[id]
      })
      return {
        ...state,
        selected,
        expanded,
        entering,
        collapsing,
        picking: state.picking && doomed.has(state.picking) ? null : state.picking,
        confirmRow:
          state.confirmRow && doomed.has(state.confirmRow) ? null : state.confirmRow,
        editing: state.editing && doomed.has(state.editing.id) ? null : state.editing,
      }
    }

    case 'startDraft':
      return { ...cleared(state), draft: action.draft, page: 0 }

    case 'patchDraft':
      if (!state.draft) return state
      return { ...state, draft: { ...state.draft, ...action.patch } }

    case 'setDraftStatus':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, status: action.status },
        editing: null,
      }

    case 'clearDraft':
      return { ...state, draft: null, editing: null }

    case 'setRange':
      return { ...state, range: { anchor: action.anchor, focus: action.focus ?? action.anchor } }

    case 'extendRange':
      // A Shift+click with nothing selected yet has no anchor to extend from,
      // so it starts the range instead of being dropped.
      return {
        ...state,
        range: state.range
          ? { anchor: state.range.anchor, focus: action.focus }
          : { anchor: action.focus, focus: action.focus },
      }

    case 'clearRange':
      return state.range ? { ...state, range: null } : state

    case 'clearTransient':
      return cleared(state)

    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

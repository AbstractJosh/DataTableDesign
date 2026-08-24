/**
 * All of the table's interaction state in one reducer.
 *
 * The record list itself lives outside this reducer (it can be controlled by the
 * host), so actions that change records carry only the id bookkeeping.
 */
import type { CellRange, CellRef } from './cellRange'
import { ENUM_OPTIONS, newCondition, type FilterCondition, type FilterOp } from './filters'
import {
  metricCategory,
  normaliseMetricPrefs,
  toggleMetricPref,
  type MetricKey,
  type MetricPrefs,
  type MetricPrefsSeed,
} from './metrics'
import {
  DEFAULT_COLUMNS,
  type ColumnKey,
  type DraftRecord,
  type SortState,
} from './types'

export const DRAFT_ID = '__draft__'

export interface TableState {
  cols: ColumnKey[]
  selected: Record<string, boolean>
  expanded: Record<string, boolean>
  sort: SortState
  query: string
  /**
   * PORT ADDITION: the filter dock's chips, ANDed. Replaces the prototype's
   * single `filter` string. An empty list filters nothing — and so does a list
   * of chips that have no operands yet, which is what keeps the table populated
   * between a column being dropped in and the user filling the chip in
   * (`isActive` in filters.ts).
   */
  conditions: FilterCondition[]
  page: number
  /** Owned here, not by the prop: the toolbar's slider changes it. */
  rowsPerPage: number
  /**
   * PORT ADDITION: what each *kind* of cell content should read as — a set of
   * preferences per category, not one metric for the whole table. Which set the
   * flow block uses is decided by the rectangle, not by this record: the cells
   * are read, their category worked out, and every metric that category holds
   * is what answers. See metrics.ts.
   *
   * Owned here for the same reason `rowsPerPage` is — the prop seeds it and the
   * toolbar's selector owns it from then on.
   */
  metrics: MetricPrefs
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
  /**
   * PORT ADDITION: the other flavour of cell selection — one whole column,
   * across every page, named by its key rather than by a pair of corners.
   *
   * It is deliberately not a `range`. A rectangle is positional and dies the
   * moment the page reshuffles under it; this one is declarative ("every value
   * in this column"), so paging, sorting and reordering all leave it standing,
   * which is the entire point of the gesture that sets it. The two are mutually
   * exclusive: starting one takes the other away.
   */
  wholeColumn: ColumnKey | null
}

export const DEFAULT_ROWS_PER_PAGE = 8

export function initialState(
  cols: ColumnKey[] = DEFAULT_COLUMNS,
  rowsPerPage: number = DEFAULT_ROWS_PER_PAGE,
  metrics?: MetricPrefsSeed | null,
): TableState {
  return {
    cols: cols.slice(),
    rowsPerPage,
    // Merged over the defaults rather than trusted, so the record is total from
    // the first render and every section of the selector has a pick to draw as
    // current. A rate key is a template literal type, so `rate:nonsense`
    // type-checks; so does a real metric filed under the wrong category. Both
    // are dropped here and the default kept. See metrics.ts.
    metrics: normaliseMetricPrefs(metrics),
    selected: {},
    expanded: {},
    sort: null,
    query: '',
    conditions: [],
    page: 0,
    picking: null,
    editing: null,
    confirmRow: null,
    draft: null,
    entering: {},
    collapsing: {},
    range: null,
    wholeColumn: null,
  }
}

export type TableAction =
  | { type: 'setQuery'; query: string }
  /** A column dropped on the filter dock, or picked from its "Add filter" head. */
  | { type: 'addCondition'; key: ColumnKey }
  | { type: 'setConditionOp'; id: string; op: FilterOp }
  /** Both operands are optional: `between` has two inputs that move separately. */
  | { type: 'setConditionValue'; id: string; value?: string; value2?: string }
  /** Enum chips only: tick or untick one option. */
  | { type: 'toggleConditionValue'; id: string; option: string }
  | { type: 'removeCondition'; id: string }
  | { type: 'clearConditions' }
  | { type: 'setPage'; page: number }
  | { type: 'setRowsPerPage'; rows: number }
  /**
   * The toolbar's metric cog: one metric switched on or off. Which category it
   * belongs to is not on the action, because the key already names it — see the
   * case.
   */
  | { type: 'toggleMetric'; metric: MetricKey }
  /** Silently follow a shrinking result set; not a navigation. */
  | { type: 'clampPage'; page: number }
  | { type: 'toggleSort'; key: ColumnKey }
  | { type: 'moveColumn'; from: ColumnKey; to: ColumnKey }
  /** Put a whole column order back, sort intact. */
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
  /** An enum picker (status, favourite season) committed a value. */
  | { type: 'enumSet' }
  | { type: 'requestDelete'; id: string }
  | { type: 'cancelDelete' }
  | { type: 'dropIds'; ids: string[] }
  | { type: 'startDraft'; draft: DraftRecord }
  | { type: 'patchDraft'; patch: Partial<DraftRecord> }
  /** The draft's enum cells. `key` is an enum column; `value` one of its options. */
  | { type: 'setDraftEnum'; key: ColumnKey; value: string }
  | { type: 'clearDraft' }
  /** Start a range at `anchor` (a click, or an arrow key without Shift). */
  | { type: 'setRange'; anchor: CellRef; focus?: CellRef }
  /** Move the far corner — a drag, a Shift+click or a Shift+arrow. */
  | { type: 'extendRange'; focus: CellRef }
  /**
   * Take one column whole, across every page (a triple click on its label, or
   * Ctrl+Space). It carries no sort of its own to restore: the label and the
   * sort caret are separate controls, so the clicks that make up the gesture
   * never reach the sort in the first place.
   */
  | { type: 'selectColumn'; key: ColumnKey }
  /** Clears both flavours: the rectangle and the whole column. */
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
  // The tail of a column drag — not a click.
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
  // Same drag, same rule: a column landing in its new slot is not a click.
  'moveColumn',
  'rowsReordered',
])

/**
 * A cell range is a rectangle over the rows and columns as they are laid out
 * right now, so only actions that leave that layout alone may keep it. Toggling
 * a checkbox, expanding a pane and the animation callbacks all qualify;
 * searching, filtering, sorting, paging, reordering and opening an editor do
 * not.
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
  // Load-bearing. The flow block reports on the rectangle, so changing the
  // preferences it reads under cannot be what takes the rectangle away — the
  // block would vanish on the press that asked it to change, and the selector
  // stays open precisely so a second metric can be switched on after the first.
  'toggleMetric',
])

/**
 * PORT ADDITION: the same rule for the whole-column selection, and a much
 * wider list — because that selection is not positional. It names a column key
 * and covers whatever the filters left, so paging, resizing the page, sorting,
 * reordering the columns and reordering the rows all leave it exactly as true
 * as it was; surviving the page turn is the point of it. What does take it
 * away is a changed record set (a query, a chip, a delete), a rectangle being
 * started instead, or any of the per-row modes opening.
 *
 * `cleared()` cannot carry this one the way it carries `range`: `setPage` and
 * `setRowsPerPage` both run it, and both must keep the column.
 */
const KEEPS_WHOLE_COLUMN: ReadonlySet<TableAction['type']> = new Set<TableAction['type']>([
  'selectColumn',
  'setPage',
  'clampPage',
  'setRowsPerPage',
  'toggleSort',
  'moveColumn',
  'rowsReordered',
  'toggleSelect',
  'setSelection',
  'expand',
  'collapse',
  'endEnter',
  'endCollapse',
  // Load-bearing for the same reason it is in KEEPS_RANGE: the flow block is
  // reporting on this column, so changing the preferences it reads under cannot
  // be what takes the column away.
  'toggleMetric',
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

/**
 * Patch one condition by id. Flat rather than per-field cases because
 * `FilterCondition` is itself flat (see the header of filters.ts) — an id that
 * matches nothing is a no-op rather than an error, since the popup dispatching
 * the patch can outlive its chip by one event.
 */
function patchCondition(
  conditions: FilterCondition[],
  id: string,
  patch: Partial<FilterCondition>,
): FilterCondition[] {
  return conditions.map((c) => (c.id === id ? { ...c, ...patch } : c))
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
  if (next.wholeColumn && !KEEPS_WHOLE_COLUMN.has(action.type)) {
    next = { ...next, wholeColumn: null }
  }
  return next
}

function apply(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'setQuery':
      return { ...cleared(state), query: action.query, page: 0 }

    /*
     * PORT ADDITION: the six dock actions below stand in for the prototype's
     * one `setFilter`, and behave the way it did — `cleared(state)` plus
     * `page: 0`, because a changed result set invalidates both the per-row
     * modes and whichever page the user was reading. `addCondition` is the sole
     * exception; the reason is on the case.
     */

    case 'addCondition':
      // One chip per column. `between` already expresses the range a second
      // chip would, and a second enum chip on the same column would AND to the
      // empty set with nothing on screen to explain why.
      if (state.conditions.some((c) => c.key === action.key)) return state
      // No `page: 0`: the new condition arrives with no operand, so it filters
      // nothing yet and the page the user is on is still the page they wanted.
      return {
        ...cleared(state),
        conditions: [...state.conditions, newCondition(action.key)],
      }

    case 'setConditionOp': {
      // Only `between` carries a second operand. Blank it on the way out, or
      // switching away and back would silently re-arm a range the user had
      // abandoned. Switching op *families* cannot happen: the popup only ever
      // offers `OPS_FOR_TYPE[COLUMN_TYPES[key]]`, and a chip's column is fixed.
      const patch: Partial<FilterCondition> =
        action.op === 'between' ? { op: action.op } : { op: action.op, value2: '' }
      return {
        ...cleared(state),
        conditions: patchCondition(state.conditions, action.id, patch),
        page: 0,
      }
    }

    case 'setConditionValue': {
      // Both operands are optional and applied independently — `between` shows
      // two inputs, and typing in one must not blank the other.
      const patch: Partial<FilterCondition> = {}
      if (action.value !== undefined) patch.value = action.value
      if (action.value2 !== undefined) patch.value2 = action.value2
      return {
        ...cleared(state),
        conditions: patchCondition(state.conditions, action.id, patch),
        page: 0,
      }
    }

    case 'toggleConditionValue': {
      const target = state.conditions.find((c) => c.id === action.id)
      if (!target) return state
      const on = target.values.includes(action.option)
      // Rebuilt from ENUM_OPTIONS rather than pushed onto the end, so the chip's
      // summary reads in the popup's order however the options were ticked.
      const values = (ENUM_OPTIONS[target.key] ?? []).filter((option) =>
        option === action.option ? !on : target.values.includes(option),
      )
      return {
        ...cleared(state),
        conditions: patchCondition(state.conditions, action.id, { values }),
        page: 0,
      }
    }

    case 'removeCondition':
      return {
        ...cleared(state),
        conditions: state.conditions.filter((c) => c.id !== action.id),
        page: 0,
      }

    case 'clearConditions':
      return { ...cleared(state), conditions: [], page: 0 }

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

    case 'toggleMetric': {
      // The action carries a metric and no category, because a metric names its
      // own: `'mean'` is the number category's, `rate:status:Success` is
      // Status's. `metricCategory` is that derivation written down, and it is
      // total — a key that names no metric names no category either, and then
      // this changes nothing rather than overwriting a preference at random.
      const category = metricCategory(action.metric)
      if (!category) return state
      // No `cleared`: this one deliberately keeps the range (see KEEPS_RANGE),
      // and there is nothing else about it a row's mode depends on. The toggle
      // also hands back the same record when it refuses to empty a category,
      // which is the other press this identity check absorbs.
      const metrics = toggleMetricPref(state.metrics, action.metric)
      return metrics === state.metrics ? state : { ...state, metrics }
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

    case 'enumSet':
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

    case 'setDraftEnum':
      if (!state.draft) return state
      return {
        ...state,
        // The computed key is sound by construction: the picker only fires for
        // a column in ENUM_OPTIONS and only with one of that column's own
        // options, which is the narrowing TypeScript cannot see from here.
        draft: { ...state.draft, [action.key]: action.value },
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

    case 'selectColumn':
      // `range` is not nulled here: `selectColumn` is outside KEEPS_RANGE, so
      // the post-pass above drops the rectangle for us — the two flavours of
      // cell selection are never live at once. The sort is untouched, and
      // `toggleSort` is in KEEPS_WHOLE_COLUMN, so the two are independent in
      // both directions.
      return { ...state, wholeColumn: action.key }

    case 'clearRange':
      if (!state.range && !state.wholeColumn) return state
      return { ...state, range: null, wholeColumn: null }

    case 'clearTransient':
      return cleared(state)

    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

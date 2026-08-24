/**
 * PORT ADDITION: the filter dock.
 *
 * The prototype filters on one thing — a "Status" segmented switch bound to a
 * single `state.filter` string. The dock replaces it with a strip between the
 * toolbar and the table that any column can be dragged into: grab a header's ⠿
 * grip, drop it here, and that column becomes a *chip* carrying one operator
 * and its operands. Chips combine with AND.
 *
 * Two things about the gesture are deliberate and easy to get wrong:
 *
 * - The column **stays in the table**. This is a filter shelf, not a pivot
 *   shelf, so the drop advertises `dropEffect = 'copy'` and `DataTable` undoes
 *   any reordering the drag did on its way up here.
 * - A freshly dropped chip **filters nothing** until it is given an operand
 *   (see `isActive` in filters.ts). So the drop opens the chip's popup and puts
 *   focus straight on that operand — a drop that lands you nowhere, with the
 *   table unchanged behind it, reads as a failed drop.
 *
 * HTML5 drag and drop is pointer-only, so the head of the chain doubles as an
 * "Add filter" menu — the same door with a keyboard on it, not a lesser
 * fallback. It is the only control on the strip that is not a block: the revert
 * beside it undoes the chain rather than belonging to it.
 *
 * Every popup in here copies FilterMenu.tsx's idioms — roving focus onto the
 * option that holds it, mousedown-outside to close, an Escape that stops
 * propagating (the table root unwinds its own modes on Escape) and returns
 * focus to the button that opened the list. Two lists on one screen answering
 * the arrow keys differently is worse than either answer.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'

import {
  COLUMN_TYPES,
  ENUM_OPTIONS,
  OPS_FOR_TYPE,
  conditionType,
  describeCondition,
  isActive,
  type FilterCondition,
  type FilterOp,
} from './filters'
import { FilterMenu } from './FilterMenu'
import { CheckIcon, CrossIcon, RevertIcon } from './icons'
import { EN, readEnum, type Strings } from './i18n'
import { type ColumnKey } from './types'

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

/**
 * The drag payload the header grip writes on dragstart. A private MIME type
 * rather than `text/plain`: it keeps a column drag from being mistaken for the
 * text the browser lets you drag out of any cell, and `dataTransfer.types`
 * carries it during dragover, where `getData` is not allowed to answer.
 */
export const COLUMN_DRAG_MIME = 'application/x-dt-column'

/** Panel widths, needed here to keep each one clear of the viewport edge. */
const POP_W = 268
const ADD_W = 232

/**
 * Viewport coordinates for a panel hung under `anchor`, which is
 * `position: fixed`.
 *
 * Both panels in the dock need this, and for the same two reasons: the chain
 * scrolls sideways, and `overflow-x: auto` clips on *both* axes whatever
 * `overflow-y` says, so an absolutely positioned panel hanging below the strip
 * would be cut off at the rail's bottom edge; and the blocks are `clip-path`'d
 * to their wedge profile, which clips descendants. A fixed box escapes both
 * without a portal, which keeps each panel inside the element whose
 * outside-press check already covers it.
 *
 * The cost of fixed is that it follows nothing on its own, so every scroll —
 * the rail's included, which is why the listener is a capturing one — and
 * every resize re-measures.
 */
function useAnchoredPanel(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  width: number,
) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = () => {
      const el = anchorRef.current
      if (!el) return
      const box = el.getBoundingClientRect()
      // Held clear of the right edge: the panel has a fixed width, and a block
      // near the end of a scrolled chain can sit closer than that to it.
      const left = Math.max(16, Math.min(box.left, window.innerWidth - width - 16))
      setAt({ top: box.bottom + 2, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, width])

  return at
}

export interface FilterDockProps {
  conditions: FilterCondition[]
  /** Droppable columns in their current table order — drives the add-picker. */
  columns: ColumnKey[]
  /** The key of the column currently being dragged, or null. Arms the dock. */
  draggingColumn: ColumnKey | null
  onAdd: (key: ColumnKey) => void
  onDropColumn: (key: ColumnKey) => void
  onSetOp: (id: string, op: FilterOp) => void
  onSetValue: (id: string, patch: { value?: string; value2?: string }) => void
  onToggleValue: (id: string, option: string) => void
  onRemove: (id: string) => void
  onClearAll: () => void
  /**
   * The dictionary in force. It reaches the chips and the picker as a prop
   * rather than through a context: a chip is already handed nine things by this
   * component, and one more that visibly changes what it renders is easier to
   * follow than an ambient one that does the same invisibly.
   */
  strings?: Strings
}

export function FilterDock({
  conditions,
  columns,
  draggingColumn,
  onAdd,
  onDropColumn,
  onSetOp,
  onSetValue,
  onToggleValue,
  onRemove,
  onClearAll,
  strings: t = EN,
}: FilterDockProps) {
  /** One popup at a time: the dock is a single strip, not a stack of panels. */
  const [openId, setOpenId] = useState<string | null>(null)
  /** Whether a droppable drag is currently over the dock. Paints `.dt-over`. */
  const [over, setOver] = useState(false)

  // Stable so a chip's document-level mousedown listener is subscribed once per
  // open rather than re-subscribed on every render of the dock.
  const openChip = useCallback((id: string) => setOpenId(id), [])
  const closeChip = useCallback(
    // Guarded: a mousedown on chip B closes A and opens B in that order, and an
    // unguarded close would then throw B's own open away.
    (id: string) => setOpenId((at) => (at === id ? null : at)),
    [],
  )

  const dockRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)

  /**
   * How many blocks are not fully inside the rail.
   *
   * The chain scrolls rather than wraps, which is the one thing wrapping was
   * better at: a filter you cannot see is still narrowing the table, and a
   * table narrowed by something invisible reads as a bug in the data. So the
   * count is kept, and it is kept outside the scroller — a counter that can
   * itself scroll out of view is worse than no counter.
   *
   * Measured off `getBoundingClientRect` rather than `offsetLeft`: nothing
   * between a block and the rail is positioned, so `offsetParent` is somewhere
   * up in the host's document and the offsets are not the rail's to compare.
   */
  const [hidden, setHidden] = useState(0)

  const measure = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const box = rail.getBoundingClientRect()
    let count = 0
    rail.querySelectorAll<HTMLElement>('.dt-chip').forEach((block) => {
      const at = block.getBoundingClientRect()
      // A pixel of slack: sub-pixel layout would otherwise report the block
      // flush with the edge as hidden.
      if (at.right > box.right + 1 || at.left < box.left - 1) count += 1
    })
    setHidden(count)
  }, [])

  // Re-measured whenever the chain changes and whenever the window does. No
  // ResizeObserver: the rail only ever changes width with the viewport, and the
  // observer is not in the test environment's DOM.
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, conditions])

  /**
   * Where a chip was, so focus can be put back there once it is gone. Both
   * controls that remove one lose the ability to hold focus in the act — the
   * chip's own × unmounts, and the revert goes `disabled` once the last chip is
   * gone — and either way focus falls to `<body>`, the top of the host's
   * document. Recorded on the press and spent by the effect below, the first
   * place the new DOM exists.
   */
  const removedAt = useRef<number | null>(null)

  /**
   * Auto-open the chip a drop just created, or catch the focus a removal
   * dropped.
   *
   * The ids are diffed rather than the length compared, so a removal and an
   * addition landing in the same commit still opens the right chip. It starts
   * as null so the first run only records a baseline: a host that mounts with
   * conditions already in its state has not just dropped anything.
   */
  const seenIds = useRef<string[] | null>(null)
  useEffect(() => {
    const ids = conditions.map((c) => c.id)
    const seen = seenIds.current
    seenIds.current = ids
    // Read once and cleared either way: an addition takes focus itself, so a
    // pending index must not sit around waiting for an unrelated shrink.
    const at = removedAt.current
    removedAt.current = null
    if (seen === null) return

    const fresh = ids.find((id) => !seen.includes(id))
    if (fresh !== undefined) {
      setOpenId(fresh)
      return
    }

    if (at === null || ids.length >= seen.length) return
    // The chip that slid into the gap, or the last one left, or the head of
    // the chain, which is the door and is always there. Queried rather than ref'd: the chips are a list whose
    // identity changed on this very commit, and the class names are fixed by
    // the dock's contract — the same idiom DataTable uses for the open editor.
    const dock = dockRef.current
    if (!dock) return
    const buttons = dock.querySelectorAll<HTMLElement>('.dt-chip-btn')
    const next =
      buttons[Math.min(at, buttons.length - 1)] ??
      dock.querySelector<HTMLElement>('.dt-dock-tag')
    next?.focus()
  }, [conditions])

  // A drag that ends anywhere but the dock sends no dragleave, so the highlight
  // is unwound from the flag going null instead of from a pointer event.
  useEffect(() => {
    if (draggingColumn === null) setOver(false)
  }, [draggingColumn])

  /**
   * `draggingColumn` is the live answer whenever the drag started in this
   * table; `types` covers the case where it did not (a drag already in flight
   * when the dock mounted). `getData` is deliberately not consulted here —
   * browsers only let it answer inside the drop event itself.
   */
  const accepts = (event: DragEvent<HTMLElement>) =>
    draggingColumn !== null || event.dataTransfer.types.includes(COLUMN_DRAG_MIME)

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event)) return
    event.preventDefault()
    setOver(true)
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event)) return
    // Without preventDefault on *every* dragover the browser refuses the drop.
    event.preventDefault()
    // "copy", not "move": the column stays in the table. The dock is additive.
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // dragleave fires again for every child the pointer crosses, so a bare
    // setOver(false) would strobe the whole way across the dock. Only a
    // relatedTarget outside the section means the pointer really left it —
    // and `contains(null)` is false, so leaving the window counts as leaving.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setOver(false)
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setOver(false)
    const dropped = draggingColumn ?? event.dataTransfer.getData(COLUMN_DRAG_MIME)
    // getData hands back a bare string, so it is checked against the column
    // table before it is trusted as a key.
    if (!dropped || !(dropped in COLUMN_TYPES)) return
    onDropColumn(dropped as ColumnKey)
  }

  // Both removals go through here so the index above is always recorded; the
  // reducer actions themselves are the caller's, untouched.
  const removeChip = (id: string) => {
    removedAt.current = conditions.findIndex((c) => c.id === id)
    onRemove(id)
  }
  const clearAll = () => {
    // Nothing is left, so this lands on the head block — and the revert goes
    // disabled in the act, so it could not keep focus even if it wanted to.
    removedAt.current = 0
    onClearAll()
  }

  const taken = new Set(conditions.map((c) => c.key))

  return (
    <section
      ref={dockRef}
      className={cx('dt-dock', draggingColumn && 'dt-armed', over && 'dt-over')}
      aria-label={t.dock}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Outside the rail, and to the left of the head: it undoes the chain
          rather than belonging to it, so it is the one thing on the strip that
          is not a block. Always rendered, and greyed out until there is
          something to revert — rendered conditionally it moved the head block
          as it arrived, and the head is the control that was just pressed. */}
      <button
        type="button"
        className="dt-dock-revert"
        disabled={conditions.length === 0}
        title={t.revert}
        aria-label={t.revert}
        onClick={clearAll}
      >
        <RevertIcon />
      </button>

      {/* The chain. "Add filter" is its head and every condition clips onto the
          right of the one before it, so the strip always ends in an open
          socket — the drop target is the shape itself rather than a frame
          drawn around the whole dock. */}
      <div className="dt-dock-rail" ref={railRef} onScroll={measure}>
        <div className="dt-dock-chain">
          <AddPicker columns={columns} taken={taken} onAdd={onAdd} strings={t} />

          {conditions.map((c) => (
            <FilterChip
              key={c.id}
              condition={c}
              open={openId === c.id}
              onOpen={openChip}
              onClose={closeChip}
              onSetOp={onSetOp}
              onSetValue={onSetValue}
              onToggleValue={onToggleValue}
              onRemove={removeChip}
              strings={t}
            />
          ))}

          {/* The socket does the pointing; this only names the gesture that
              fills it, and it goes for good at the first block. */}
          {conditions.length === 0 ? (
            <p className="dt-dock-empty">{t.dockEmpty}</p>
          ) : null}
        </div>
      </div>

      {/* A readout, not a control, and outside the scroller: a count that can
          itself scroll out of view is worse than no count. */}
      {hidden > 0 ? <p className="dt-dock-more">{hidden} more</p> : null}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * One condition
 * ------------------------------------------------------------------ */

interface FilterChipProps {
  condition: FilterCondition
  open: boolean
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onSetOp: (id: string, op: FilterOp) => void
  onSetValue: (id: string, patch: { value?: string; value2?: string }) => void
  onToggleValue: (id: string, option: string) => void
  onRemove: (id: string) => void
  strings: Strings
}

/**
 * A chip reads "Status · Success, Failed" closed and opens into the editor for
 * that one condition. It renders entirely from `COLUMN_TYPES[key]` — there is
 * no per-column branch anywhere in here — so a new column type is a new entry
 * in filters.ts and nothing else.
 *
 * Three operand shapes share the one popup: the enum tick list, a single input,
 * and the two inputs of `between`. They are laid out so switching operator
 * never changes the popup's row count — `between` splits the operand row rather
 * than adding one — because a panel that grows under the pointer swallows the
 * next click.
 */
function FilterChip({
  condition: c,
  open,
  onOpen,
  onClose,
  onSetOp,
  onSetValue,
  onToggleValue,
  onRemove,
  strings: t,
}: FilterChipProps) {
  const label = t.columns[c.key]
  const type = conditionType(c)
  const options = ENUM_OPTIONS[c.key] ?? []
  const ranged = c.op === 'between'

  const rootRef = useRef<HTMLDivElement | null>(null)
  const shapeRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const valueRef = useRef<HTMLInputElement | null>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])

  /** Hung off the block itself, not off `.dt-chip` — see useAnchoredPanel. */
  const pop = useAnchoredPanel(open, shapeRef, POP_W)

  /** Which enum option the arrows are standing on. */
  const [active, setActive] = useState(() => {
    const at = options.findIndex((option) => c.values.includes(option))
    return at < 0 ? 0 : at
  })

  /**
   * Open with focus already on the operand — the first enum option, or the
   * value input. The operator above it is on a sensible default already
   * (OPS_FOR_TYPE lists the commonest first), so it is not what to land on, and
   * for the chip a drop just created this is the whole point: the table has not
   * changed yet, so the caret sitting in the operand is the only thing telling
   * the user the drop worked.
   *
   * `type` and `active` are deliberately outside the dependency list: this is
   * the entry focus, not a follow-the-arrows effect.
   */
  useEffect(() => {
    if (!open) return
    if (type === 'enum') optionRefs.current[active]?.focus()
    else valueRef.current?.focus()
  }, [open])

  // A press anywhere else closes the popup. Focus is deliberately not pulled
  // back to the chip here — the pointer is already somewhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onClose(c.id)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose, c.id])

  const close = (returnFocus = true) => {
    onClose(c.id)
    if (returnFocus) buttonRef.current?.focus()
  }

  const onPopKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // The table root unwinds its own modes on Escape; closing this popup is the
    // whole of what this press meant. (The operator list inside stops the same
    // key first, so an Escape there closes only the list.)
    event.stopPropagation()
    close()
  }

  const onOptsKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1
    let next = active
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(last, active + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, active - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onToggleValue(c.id, options[active])
        return
      default:
        // Escape and Tab fall through: Escape belongs to the popup around this
        // list, and Tab has to be able to leave the list for the footer.
        return
    }
    event.preventDefault()
    // Roving focus, the same idiom FilterMenu and the cell grid use: the
    // highlighted option is the one that actually holds focus. Moved by hand
    // here rather than from an effect keyed on `active`, so that the entry
    // focus above stays the only thing that fires on open.
    setActive(next)
    optionRefs.current[next]?.focus()
  }

  const dirty = c.values.length > 0 || c.value !== '' || c.value2 !== ''

  const clearOperands = () => {
    if (type === 'enum') {
      // The reducer has no bulk clear — it toggles one option at a time — and
      // untoggling each ticked one in turn lands on exactly the same state.
      c.values.forEach((option) => onToggleValue(c.id, option))
      return
    }
    onSetValue(c.id, { value: '', value2: '' })
  }

  // `date` feeds parseTableDate the ISO string it already understands, and
  // `number` gets the numeric keypad on touch. Note that the date field's
  // calendar popup is browser chrome: it is the one round-cornered surface on
  // this screen that the design system does not get to flatten.
  const inputType = type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'
  const inputMode = type === 'number' ? ('numeric' as const) : undefined

  return (
    <div
      ref={rootRef}
      className={cx('dt-chip', open && 'dt-open', !isActive(c) && 'dt-idle')}
    >
      {/* The block. Its wedge profile is a clip-path, and clip-path clips
          descendants — so the popup is a sibling of this, not a child, or it
          would be sliced along the joint. */}
      <div className="dt-chip-shape" ref={shapeRef}>
        <button
          ref={buttonRef}
          type="button"
          className="dt-chip-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? close() : onOpen(c.id))}
        >
          <span className="dt-chip-tag">{label}</span>
          {/* "Any" while the condition is inert — see describeCondition. */}
          <span className="dt-chip-value">{describeCondition(c, t)}</span>
          <span className="dt-chip-caret" aria-hidden="true">
            ▼
          </span>
        </button>

        <button
          type="button"
          className="dt-chip-remove"
          aria-label={t.removeFilter(label)}
          onClick={() => onRemove(c.id)}
        >
          <CrossIcon />
        </button>
      </div>

      {open ? (
        <div
          className="dt-chip-pop"
          role="dialog"
          aria-label={t.filterDialog(label)}
          style={pop ?? undefined}
          onKeyDown={onPopKeyDown}
        >
          <div className="dt-pop-row">
            {/* The operator list is the toolbar's old dropdown, kept generic:
                the values are op keys, the words come from OP_LABELS. */}
            <FilterMenu
              label={t.opTag}
              value={c.op}
              options={OPS_FOR_TYPE[type]}
              format={(op) => t.ops[op]}
              onPick={(op) => onSetOp(c.id, op)}
            />
          </div>

          {type === 'enum' ? (
            <ul
              className="dt-pop-opts"
              role="listbox"
              aria-multiselectable="true"
              aria-label={t.filterValues(label)}
              onKeyDown={onOptsKeyDown}
            >
              {options.map((option, index) => {
                const on = c.values.includes(option)
                return (
                  <li
                    key={option}
                    ref={(el) => {
                      optionRefs.current[index] = el
                    }}
                    role="option"
                    aria-selected={on}
                    // Roving tabindex, not FilterMenu's blanket -1: that list
                    // owns the whole popup it lives in, this one is a control
                    // among several, so Tab has to reach it and leave again.
                    tabIndex={index === active ? 0 : -1}
                    className={on ? 'dt-on' : undefined}
                    onClick={() => {
                      setActive(index)
                      onToggleValue(c.id, option)
                    }}
                  >
                    {/* Label first, then the tick at the far end of the
                        space-between row, so ticking an option never shifts its
                        own text. A bare CheckIcon rather than the 22px
                        `.dt-check-box` the table's checkboxes use: that class
                        declares `color: var(--dt-accent)` on itself, which beats
                        anything inherited, so on an accent-filled row it painted
                        the tick navy on navy — an apparently empty box on the
                        one row that is selected. */}
                    {readEnum(t, c.key, option)}
                    {on ? <CheckIcon /> : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="dt-pop-row">
              {/* The labels are decorative: each input carries its own
                  accessible name, so announcing the word twice helps nobody. */}
              <span className="dt-pop-label" aria-hidden="true">
                {ranged ? t.from : t.value}
              </span>
              <input
                ref={valueRef}
                className="dt-pop-input"
                type={inputType}
                inputMode={inputMode}
                aria-label={ranged ? t.rangeStart(label) : t.filterValue(label)}
                value={c.value}
                onChange={(event) => onSetValue(c.id, { value: event.target.value })}
              />
              {ranged ? (
                <>
                  <span className="dt-pop-label" aria-hidden="true">
                    {t.to}
                  </span>
                  <input
                    className="dt-pop-input"
                    type={inputType}
                    inputMode={inputMode}
                    aria-label={t.rangeEnd(label)}
                    value={c.value2}
                    onChange={(event) => onSetValue(c.id, { value2: event.target.value })}
                  />
                </>
              ) : null}
            </div>
          )}

          <div className="dt-pop-foot">
            {/* Clear empties the operands and leaves the chip in place; the ×
                on the chip itself is the one that removes the condition. */}
            <button type="button" disabled={!dirty} onClick={clearOperands}>
              {t.clear}
            </button>
            <button type="button" onClick={() => close()}>
              {t.done}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The keyboard door
 * ------------------------------------------------------------------ */

/**
 * PORT ADDITION on a PORT ADDITION: HTML5 drag and drop is pointer-only, so the
 * dock also lists its columns as a plain listbox. The keyboard contract is
 * FilterMenu's, key for key — two lists on one screen that disagree about what
 * Home does are worse than either behaviour on its own.
 */
function AddPicker({
  columns,
  taken,
  onAdd,
  strings: t,
}: {
  columns: ColumnKey[]
  /** Columns that already have a chip: listed, but not selectable. */
  taken: ReadonlySet<ColumnKey>
  onAdd: (key: ColumnKey) => void
  strings: Strings
}) {
  const [open, setOpen] = useState(false)
  /** Which option the keyboard is standing on while the list is open. */
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLSpanElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])

  /** Anchored to the button rather than the wrapper: the wrapper is sticky, and
      a sticky box's rect is where it is *painted*, which is what we want, but
      the button is the edge the list should line up with either way. */
  const panel = useAnchoredPanel(open, buttonRef, ADD_W)

  // Roving focus, as in FilterMenu: the highlighted option holds focus, so no
  // aria-activedescendant bookkeeping.
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus()
  }, [open, active])

  // A press anywhere else closes the list. Focus is deliberately not pulled
  // back to the button here — the pointer is already somewhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openList = () => {
    // Land on the first column that can actually be added rather than on a
    // dead row.
    const first = columns.findIndex((key) => !taken.has(key))
    setActive(first < 0 ? 0 : first)
    setOpen(true)
  }

  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const pick = (key: ColumnKey) => {
    // One chip per column, so a column that already has one commits to nothing.
    // It keeps its place in the list rather than being dropped, so the picker's
    // order always matches the table's and never shuffles under the arrows.
    if (taken.has(key)) return
    onAdd(key)
    close()
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault() // Enter and Space are the button's own click
    openList()
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = columns.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((at) => Math.min(last, at + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((at) => Math.max(0, at - 1))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        pick(columns[active])
        break
      case 'Escape':
        event.preventDefault()
        // As in FilterMenu: the table root unwinds its own modes on Escape, and
        // closing this list is the whole of what this press meant.
        event.stopPropagation()
        close()
        break
      case 'Tab':
        close(false)
        break
      default:
        break
    }
  }

  return (
    // The head of the chain *is* the add button. It was a separate control in
    // the tools rail beside "Clear all"; folding it into the block that already
    // anchors the chain means the thing you add to and the thing you add with
    // are one object, and the strip is left with no controls that are not part
    // of the chain itself.
    //
    // It is sticky rather than scrolling with the chain: it is the only door in
    // and it cannot be allowed to scroll away from the hand reaching for it.
    <span className="dt-dock-head" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('dt-dock-tag', open && 'dt-open')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="dt-dock-tag-text">{t.addFilter}</span>
        <span className="dt-dock-tag-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <ul
          className="dt-dock-add-list"
          role="listbox"
          aria-label={t.addColumnFilter}
          style={panel ?? undefined}
          onKeyDown={onListKeyDown}
        >
          {columns.map((key, index) => {
            const used = taken.has(key)
            return (
              <li
                key={key}
                ref={(el) => {
                  optionRefs.current[index] = el
                }}
                role="option"
                aria-disabled={used}
                tabIndex={-1}
                onClick={() => pick(key)}
              >
                {t.columns[key]}
              </li>
            )
          })}
        </ul>
      ) : null}
    </span>
  )
}

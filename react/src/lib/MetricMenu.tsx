/**
 * PORT ADDITION: the toolbar's "Show" selector — the flow block's preferences.
 *
 * Deliberately not a `<FilterMenu>`, and the difference is not cosmetic.
 * FilterMenu is a select-only combobox: one value, one listbox, and picking
 * closes it. This holds *several* values at once — one preference per category
 * of cell content (numbers, Status values, Favourite season values) — and none
 * of them is "the" value. Worse for the analogy, the button does not name what
 * this control is set to at all: it names whichever preference the current cell
 * selection has put in force, which is not a thing FilterMenu's `value` can
 * mean. Bending it into this shape would have rewritten the operator picker
 * inside every filter chip, so this is its own small component instead.
 *
 * What it does keep, to the letter, is FilterMenu's keyboard and outside-click
 * contract: roving focus onto the option that holds it, arrows and Home / End
 * to move, Enter or Space to commit, mousedown outside to close, and an Escape
 * that stops propagating (the table root unwinds its own modes on Escape) and
 * puts focus back on the button. Every list in this port answers the keys
 * identically; one that did not would be worse than any of the answers.
 *
 * Three differences, and all three are the panel's shape rather than a change
 * of mind about the keys:
 *
 * - **Picking does not close.** The point of a preferences panel is that one
 *   visit can set more than one category.
 * - **Tab moves between sections**, each being its own radio group with its own
 *   roving tab stop. FilterMenu closes on Tab because it has exactly one stop;
 *   here the popup closes when focus leaves it altogether, which is the same
 *   rule restated for a control that has several.
 * - **The arrows move without committing.** ARIA's radio pattern checks the
 *   radio the arrows land on; this port's lists do not, and a preference that
 *   rewrote itself on the way past would be a poor trade for the convention.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'

import {
  METRIC_GROUPS,
  metricFor,
  metricLabel,
  type MetricCategory,
  type MetricGroup,
  type MetricKey,
  type MetricPrefs,
} from './metrics'

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export interface MetricMenuProps {
  /** One pick per category: what each section draws as its current radio. */
  prefs: MetricPrefs
  /**
   * The metric the flow block is displaying — the one the button names, so that
   * it tracks the selection rather than the panel. Passed in rather than worked
   * out here: it comes from the answer the block already computed, and a second
   * reading of the rectangle could disagree with the first.
   */
  value: MetricKey
  /**
   * Which category the current selection falls in, or `null` when there is no
   * selection or it answers nothing. Only the cue on the section in force reads
   * it — the button's words come from `value`.
   */
  inForce: MetricCategory | null
  onPick: (metric: MetricKey) => void
}

export function MetricMenu({ prefs, value, inForce, onPick }: MetricMenuProps) {
  const [open, setOpen] = useState(false)
  /**
   * Which option the keyboard is standing on, per section. Sections have their
   * own roving tab stop, so this cannot be the single index FilterMenu keeps: a
   * Tab into a section has to land where that section was left. Unset means "on
   * the current pick", which is where a section starts.
   */
  const [active, setActive] = useState<Record<string, number>>({})

  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef(new Map<string, HTMLLIElement | null>())

  const headingId = useId()

  const refKey = (category: MetricCategory, index: number) => `${category}#${index}`

  /** The section's own pick, as an index — where its tab stop sits by default. */
  const pickedIn = (group: MetricGroup) => {
    const key = metricFor(prefs, group.category)
    return Math.max(0, group.options.findIndex((option) => option.key === key))
  }

  const activeIn = (group: MetricGroup) => active[group.category] ?? pickedIn(group)

  const focusOption = (group: MetricGroup, index: number) => {
    optionRefs.current.get(refKey(group.category, index))?.focus()
  }

  /**
   * Focus into the panel: the section the selection has put in force, on the
   * option that section is standing on — the one the panel is there to explain
   * — and Numbers when nothing is selected.
   */
  const enterPanel = () => {
    const group =
      METRIC_GROUPS.find((candidate) => candidate.category === inForce) ?? METRIC_GROUPS[0]
    focusOption(group, activeIn(group))
  }

  /**
   * Entry focus, on the way open. Deliberately keyed on `open` alone: it is the
   * flip that this answers, and re-running it when a pick changes `prefs` would
   * drag focus back to the top of the panel mid-visit. Which also means it is
   * no help to a press that wants back into a panel already open — that one
   * calls `enterPanel` for itself.
   */
  useEffect(() => {
    if (!open) return
    enterPanel()
  }, [open])

  // A press anywhere else closes the panel. Focus is deliberately not pulled
  // back to the button — the pointer is already somewhere else. FilterMenu's.
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

  const openPanel = () => {
    // The sections start on their own picks again; a section the user walked
    // away from without choosing should not remember where they stopped.
    setActive({})
    setOpen(true)
  }

  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const pick = (group: MetricGroup, index: number) => {
    setActive((at) => ({ ...at, [group.category]: index }))
    onPick(group.options[index].key)
    // The panel stays open; the tab stop and DOM focus have to agree on where
    // it now is, and a click on an option is the case where they would not.
    focusOption(group, index)
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault() // Enter and Space are the button's own click
    // Shift+Tab out of the first section leaves focus on the button with the
    // panel still standing — `onPanelBlur` keeps it open for anywhere inside
    // the root — and an arrow from there means "back in", not "open". Going
    // through `openPanel` would do neither: `open` is already true, so the
    // entry-focus effect never re-runs, and the `setActive({})` in it would
    // quietly throw away where every section had been left.
    if (open) enterPanel()
    else openPanel()
  }

  /**
   * Escape belongs to the control as a whole rather than to any one section,
   * exactly as it does in a filter chip's popup: the sections let it through,
   * and it closes the whole thing once.
   *
   * Bound on the root rather than on the popup, because the button is a place
   * focus can be while the panel is open (Shift+Tab out of the first section)
   * and Escape has to answer from there too. Unhandled, it would carry on up to
   * the table root, whose own Escape chain would clear the cell rectangle the
   * block is reporting on — the selection `setMetric`'s place in `KEEPS_RANGE`
   * exists to protect. A *closed* selector still has no Escape of its own, and
   * lets that chain have it.
   */
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    // The table root unwinds its own modes on Escape; closing this panel is the
    // whole of what this press meant.
    event.stopPropagation()
    close()
  }

  /**
   * Tab is not handled and not swallowed — it is what moves between sections.
   * Leaving the panel entirely closes it, which is where FilterMenu's
   * `close(false)` on Tab ends up for a control with more than one tab stop.
   */
  const onPanelBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && rootRef.current?.contains(next)) return
    setOpen(false)
  }

  const onGroupKeyDown = (group: MetricGroup) => (event: KeyboardEvent<HTMLUListElement>) => {
    const last = group.options.length - 1
    const at = activeIn(group)
    let next = at

    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(last, at + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, at - 1)
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
        pick(group, at)
        return
      default:
        // Escape belongs to the panel around this section, and Tab has to be
        // able to carry focus out of it to the next one.
        return
    }

    event.preventDefault()
    // Roving focus, the idiom FilterMenu and the cell grid both use: the
    // highlighted option is the one that actually holds focus. Moved by hand
    // rather than from an effect keyed on `active`, so the entry focus above
    // stays the only thing that fires on open.
    setActive((state) => ({ ...state, [group.category]: next }))
    focusOption(group, next)
  }

  return (
    <div className="dt-metric" ref={rootRef} onKeyDown={onRootKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('dt-metric-btn', open && 'dt-open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        /* The visible words are "Show" and one metric, which names the reading
           but not the control. The value is carried in so that what the button
           says is never only available to a sighted reader — and the change a
           pick makes is announced by the radio's own checked state either way. */
        aria-label={`Showing ${metricLabel(value)}. Set what each kind of cell selection reads as.`}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="dt-metric-tag">Show</span>
        <span className="dt-metric-value">{metricLabel(value)}</span>
        <span className="dt-metric-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <div
          className="dt-metric-pop"
          role="dialog"
          aria-label="What each kind of cell selection reads as"
          onBlur={onPanelBlur}
        >
          {METRIC_GROUPS.map((group) => {
            const picked = metricFor(prefs, group.category)
            const at = activeIn(group)
            const now = group.category === inForce
            const id = `${headingId}-${group.category}`

            return (
              <div
                key={group.category}
                className={cx('dt-metric-group', now && 'dt-metric-now')}
              >
                {/* A plain heading outside the list: never a focus stop, never
                    an entry of the group it names. The note is the visual
                    accent cue's counterpart — it lands in the group's own
                    accessible name, which is where a screen reader will meet
                    it. */}
                <div className="dt-metric-head" id={id}>
                  {group.label}
                  {now ? (
                    <span className="dt-sr-only"> — in use for this selection</span>
                  ) : null}
                </div>

                <ul
                  className="dt-metric-opts"
                  role="radiogroup"
                  aria-labelledby={id}
                  onKeyDown={onGroupKeyDown(group)}
                >
                  {group.options.map((option, index) => (
                    <li
                      key={option.key}
                      ref={(el) => {
                        optionRefs.current.set(refKey(group.category, index), el)
                      }}
                      role="radio"
                      aria-checked={option.key === picked}
                      /* One tab stop per section — the option the keyboard is
                         standing on, which starts on the section's own pick. */
                      tabIndex={index === at ? 0 : -1}
                      /* No `.dt-on` marker class, which is what the port's
                         listboxes carry: `aria-checked` already says this, and
                         the stylesheet paints off the attribute so the two
                         cannot drift apart. */
                      onClick={() => pick(group, index)}
                    >
                      {option.label}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

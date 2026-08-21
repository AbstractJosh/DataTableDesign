/**
 * PORT ADDITION: the toolbar's metric cog — the flow block's preferences.
 *
 * Deliberately not a `<FilterMenu>`, and the difference is not cosmetic.
 * FilterMenu is a select-only combobox: one value, one listbox, and picking
 * closes it. This holds *several* values at once — one preference per category
 * of cell content (numbers, Status values, Favourite season values) — and none
 * of them is "the" value. Worse for the analogy, the button names none of them:
 * it is a cog. What it used to print — "SHOW / SUM", the preference the current
 * selection puts in force — was never a setting of this control's own, and it
 * was the flow block's word to say in the first place: the block tags every
 * reading with the metric it used, so the button beside it was printing the
 * same word twice whenever there was anything to print. What is left is the
 * other half, "set how these read", and a cog is that in one glyph. None of it
 * is a thing FilterMenu's `value` can mean; bending it into this shape would
 * have rewritten the operator picker inside every filter chip, so this is its
 * own small component instead.
 *
 * What it does keep, to the letter, is FilterMenu's keyboard and outside-click
 * contract: roving focus onto the option that holds it, arrows and Home / End
 * to move, Enter or Space to commit, mousedown outside to close, and an Escape
 * that stops propagating (the table root unwinds its own modes on Escape) and
 * puts focus back on the button. Every list in this port answers the keys
 * identically; one that did not would be worse than any of the answers.
 *
 * Four differences, and all four are the panel's shape rather than a change of
 * mind about the keys:
 *
 * - **The panel is two levels.** It opens on the three kinds of cell content
 *   and nothing else; one of them expands, in place, into the metrics it can be
 *   read as. Thirteen options under three headings was a list long enough to
 *   scroll, which asked the reader to find their kind inside it — and the kind
 *   is the first thing they know. Only one section is open at a time, or the
 *   collapse buys nothing back.
 * - **Picking does not close.** The point of a preferences panel is that one
 *   visit can set more than one category. It does not collapse the section
 *   either: the pick that was just made should still be on screen, checked.
 * - **Tab moves between sections**, each headed by its own button and, while
 *   open, holding its own roving tab stop. FilterMenu closes on Tab because it
 *   has exactly one stop; here the popup closes when focus leaves it
 *   altogether, which is the same rule restated for a control that has
 *   several. The arrows are how you go in and back out of a section, which is
 *   the cog's own Down / Up one level further in.
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

import { CogIcon } from './icons'
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
   * The metric the flow block is displaying — the one the button's accessible
   * name and tooltip carry, so that what this says tracks the selection rather
   * than the panel. Passed in rather than worked out here: it comes from the
   * answer the block already computed, and a second reading of the rectangle
   * could disagree with the first.
   */
  value: MetricKey
  /**
   * Which category the current selection falls in, or `null` when there is no
   * selection or it answers nothing. Only the cue on the section in force reads
   * it — the button's name comes from `value`.
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
  /**
   * Which category is showing its metrics, or `null` for none — which is where
   * every visit starts. One at a time: the panel is a list of kinds first, and
   * two sections open at once put thirteen options back on screen, which is the
   * thing the sub-menu is here to stop.
   */
  const [expanded, setExpanded] = useState<MetricCategory | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef(new Map<string, HTMLLIElement | null>())
  const headRefs = useRef(new Map<string, HTMLButtonElement | null>())
  /**
   * A section this render is about to open, whose current option wants the
   * focus once it exists. Set by the arrow that means "go in": the options are
   * not mounted at the moment the key is pressed, so the focus has to wait for
   * the render that mounts them (see the effect below).
   */
  const enterAfterOpen = useRef<MetricCategory | null>(null)

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

  const focusHead = (group: MetricGroup) => {
    headRefs.current.get(group.category)?.focus()
  }

  const groupFor = (category: MetricCategory | null) =>
    METRIC_GROUPS.find((candidate) => candidate.category === category) ?? null

  /**
   * Focus into the panel. With everything collapsed — which is how a visit
   * starts — that is the category the selection has put in force, because the
   * kind being read is the one the panel is there to explain, and Numbers when
   * nothing is selected. With a section already open it is that section's
   * current option instead: focus goes to the deepest thing standing, so a step
   * out to the cog and back lands where the keyboard left off rather than at
   * the top of the panel.
   */
  const enterPanel = () => {
    const openGroup = groupFor(expanded)
    if (openGroup) {
      focusOption(openGroup, activeIn(openGroup))
      return
    }
    focusHead(groupFor(inForce) ?? METRIC_GROUPS[0])
  }

  /**
   * The other half of "go in": the arrow that opens a section cannot focus an
   * option React has not mounted yet, so it books the move here and this runs
   * on the render that mounts them.
   */
  useEffect(() => {
    const category = enterAfterOpen.current
    if (!category || expanded !== category) return
    enterAfterOpen.current = null
    const group = groupFor(category)
    if (group) focusOption(group, activeIn(group))
  }, [expanded])

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
    // away from without choosing should not remember where they stopped. And
    // they start collapsed: the first thing a visit shows is the three kinds.
    setActive({})
    setExpanded(null)
    setOpen(true)
  }

  /** One section at a time; pressing the open one shuts it. */
  const toggle = (group: MetricGroup) => {
    setExpanded((current) => (current === group.category ? null : group.category))
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

  /**
   * A category button answers the same two arrows the cog does, one level in:
   * Down means "go in" — open the section if it is shut, then stand on the
   * option it is holding — and Up means "back out", which shuts it. Enter and
   * Space are the button's own click and toggle it, so neither is handled here.
   *
   * Nothing moves between category buttons on the arrows: Tab does that, as it
   * did between sections before there was anything to expand. A panel where
   * Down sometimes walks the headings and sometimes enters one would be worse
   * than either rule on its own.
   */
  const onHeadKeyDown = (group: MetricGroup) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (expanded === group.category) {
        focusOption(group, activeIn(group))
      } else {
        enterAfterOpen.current = group.category
        setExpanded(group.category)
      }
      return
    }
    if (event.key === 'ArrowUp' && expanded === group.category) {
      event.preventDefault()
      setExpanded(null)
    }
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
        /* The cog has no words, so the name carries both halves: what the block
           is reading the selection as, and what pressing this is for. The
           reading is the block's own to show — it prints the metric as its tag
           whenever there is a rectangle — but a name that said only "Show" would
           leave a screen reader with no way to hear which metric is in force
           without opening the panel. The change a pick makes is announced by the
           radio's own checked state either way. */
        aria-label={`Showing ${metricLabel(value)}. Set what each kind of cell selection reads as.`}
        /* The tooltip is the sighted half of the same sentence, short: it gives
           a pointer user back the readout the words used to carry, which is the
           one thing the cog costs them when nothing is selected and the block is
           not there to say it. */
        title={`Showing ${metricLabel(value)}`}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="dt-metric-cog">
          <CogIcon />
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
            const shown = group.category === expanded
            const id = `${headingId}-${group.category}`
            const listId = `${id}-opts`

            return (
              <div
                key={group.category}
                className={cx(
                  'dt-metric-group',
                  now && 'dt-metric-now',
                  shown && 'dt-metric-showing',
                )}
              >
                {/* The kind, and the control that opens what it can read as.
                    The panel asks "which kind of cell" first and "read as
                    what" second, so this row names a section rather than a
                    metric: a heading that was also an option would be
                    answering the second question in the row that asks the
                    first.

                    The note is the visual accent cue's counterpart — it lands
                    in this button's accessible name, and through
                    `aria-labelledby` in the group's, which is where a screen
                    reader will meet it. */}
                <button
                  type="button"
                  className="dt-metric-head"
                  id={id}
                  ref={(el) => {
                    headRefs.current.set(group.category, el)
                  }}
                  aria-expanded={shown}
                  aria-controls={shown ? listId : undefined}
                  onClick={() => toggle(group)}
                  onKeyDown={onHeadKeyDown(group)}
                >
                  <span>
                    {group.label}
                    {now ? (
                      <span className="dt-sr-only"> — in use for this selection</span>
                    ) : null}
                  </span>
                  <span className="dt-metric-cat-caret" aria-hidden="true">
                    ▼
                  </span>
                </button>

                {/* Unmounted rather than hidden while the section is shut. A
                    collapsed group has no tab stop, no radio in the tree and
                    nothing for `getByRole` to find, which is what "collapsed"
                    should mean to everything reading this panel and not only
                    to the eye. `active` is state and outlives the unmount, so
                    a section reopened in the same visit is still standing
                    where the keyboard left it. */}
                {shown ? (
                  <ul
                    id={listId}
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
                        /* One tab stop per open section — the option the
                           keyboard is standing on, which starts on the
                           section's own pick. */
                        tabIndex={index === at ? 0 : -1}
                        /* No `.dt-on` marker class, which is what the port's
                           listboxes carry: `aria-checked` already says this,
                           and the stylesheet paints off the attribute so the
                           two cannot drift apart. */
                        onClick={() => pick(group, index)}
                      >
                        {option.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

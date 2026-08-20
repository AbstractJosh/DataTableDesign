/**
 * The select-only combobox: a button that owns the current value plus a listbox
 * popup, rather than a native `<select>`, whose popup is drawn by the OS and
 * cannot carry the system's flat, square, accent-marked styling.
 *
 * It began life as the toolbar's "Status" dropdown — the prototype spends the
 * whole width of a four-position segmented switch on that one choice. The
 * filter dock has since taken that job over (status is one condition among
 * several there now), so the single caller left is the operator picker inside a
 * filter chip's popup. Nothing here knows about filters: it is a list of values
 * and a way to pick one, and it should stay that way.
 *
 * Because the popup is ours, so is the keyboard contract: the button opens on
 * Enter / Space / arrow, the list moves on the arrows and Home / End, Enter or
 * Space commits, Escape closes without committing, and focus comes back to the
 * button either way. Everything else in the port that opens a list copies these
 * idioms — keep them all answering the keys identically.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface FilterMenuProps<T extends string> {
  value: T
  options: readonly T[]
  /** The word above the value, and the listbox's accessible name. */
  label: string
  /**
   * How an option reads on screen, for callers whose stored value is not the
   * words the user should see — a filter operator is held as `'notContains'`
   * and shown as "does not contain". Identity by default.
   */
  format?: (option: T) => string
  onPick: (next: T) => void
}

export function FilterMenu<T extends string>({
  value,
  options,
  label,
  format = (option) => option,
  onPick,
}: FilterMenuProps<T>) {
  const [open, setOpen] = useState(false)
  /** Which option the keyboard is standing on while the list is open. */
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLLIElement | null>>([])

  // Roving focus, the same idiom the cell grid uses: the highlighted option is
  // the one that actually holds focus, so no aria-activedescendant bookkeeping.
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
    setActive(Math.max(0, options.indexOf(value)))
    setOpen(true)
  }

  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const pick = (next: T) => {
    onPick(next)
    close()
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault() // Enter and Space are the button's own click
    openList()
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1
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
        pick(options[active])
        break
      case 'Escape':
        event.preventDefault()
        // The table root unwinds its own modes on Escape; closing this list is
        // the whole of what this press meant.
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
    <div className="dt-filter" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'dt-filter-btn dt-open' : 'dt-filter-btn'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="dt-filter-tag">{label}</span>
        <span className="dt-filter-value">{format(value)}</span>
        <span className="dt-filter-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <ul
          className="dt-filter-list"
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option}
              ref={(el) => {
                optionRefs.current[index] = el
              }}
              role="option"
              aria-selected={option === value}
              tabIndex={-1}
              className={option === value ? 'dt-on' : undefined}
              onClick={() => pick(option)}
            >
              {format(option)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

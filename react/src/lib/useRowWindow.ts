/**
 * Rendering only the rows a reader can actually see.
 *
 * This is the *other* virtualisation, and it is worth being clear about which
 * problem it solves. Fetching a page at a time (see `source.ts`) is what keeps a
 * hundred thousand records out of the browser. This keeps them out of the
 * **DOM** — because the page size is a number in a box on the toolbar, with no
 * upper bound, and a reader who types 5000 into it gets five thousand rows of
 * nine cells each whether or not they are in the viewport.
 *
 * ## When it does nothing at all
 *
 * Nearly always, and deliberately:
 *
 * - **Short pages.** Below `VIRTUAL_THRESHOLD` the whole page renders, so the
 *   default eight rows — and every test written against them — never touch any
 *   of this. Windowing a page that fits on the screen costs two spacer elements
 *   and a scroll listener and saves nothing.
 * - **An expanded row.** The offsets here assume every row is the same height,
 *   which is true right up until a detail pane opens and adds its measured
 *   height to one of them. Rather than track a height per row, a page with
 *   anything open renders whole: opening a pane is an act of attention on one
 *   row, and being right about where it is beats being fast about it.
 * - **Anywhere nothing has been laid out.** A measured row height of zero — a
 *   jsdom test, a display:none ancestor, the first paint — means there is
 *   nothing to compute a window from, and the fallback is to render everything.
 *
 * ## What it assumes
 *
 * That collapsed rows are all the same height, which they are: the density
 * decides the padding and every cell on the row is one line. The height is
 * measured from a real row rather than taken from a constant, so a host that
 * restyles the table gets the right answer without telling anyone.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Rows on a page before windowing earns its keep.
 *
 * Comfortably more than a screenful at either density, so the common case — a
 * page you can scroll through — is untouched, and comfortably less than the
 * page sizes that make the DOM hurt.
 */
export const VIRTUAL_THRESHOLD = 80

/**
 * Rows rendered beyond each edge of the viewport.
 *
 * Enough that a flick of the wheel lands on rows that already exist, since a
 * blank band appearing mid-scroll is the one artefact that makes windowing
 * obvious. Twelve is about two thirds of a screenful at compact density.
 */
const OVERSCAN = 12

export interface RowWindow {
  /** Index of the first rendered row within the page. */
  first: number
  /** How many are rendered. */
  count: number
  /** Height of the spacer standing in for the rows above. */
  padTop: number
  /** …and below. */
  padBottom: number
}

/**
 * The window, or `null` when the whole page should render.
 *
 * `rowsRef` points at the element the rows live in — the table — and the
 * measurement is taken from the first row inside it. Scroll and resize are
 * listened to on the window rather than on a container: the table scrolls with
 * the page vertically, and only sideways inside its own box.
 */
export function useRowWindow(
  enabled: boolean,
  tableRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
): RowWindow | null {
  const [rowHeight, setRowHeight] = useState(0)
  const [range, setRange] = useState<{ first: number; count: number } | null>(null)
  /* The last range applied, read inside the scroll handler so it can decide
     whether anything changed without re-subscribing on every scroll. */
  const applied = useRef<{ first: number; count: number } | null>(null)
  applied.current = range

  /**
   * One row's height, from the DOM.
   *
   * Measured after layout rather than derived from the density prop, because
   * the padding is a custom property a host can override and the font is one it
   * can replace. `getBoundingClientRect` rather than `offsetHeight` so a
   * fractional height at a non-integer zoom does not accumulate into a drift of
   * several rows down a long page.
   */
  useLayoutEffect(() => {
    if (!enabled) {
      setRowHeight(0)
      return
    }
    // A row body, which is any tbody carrying a record id — the spacers below
    // deliberately carry none, so this can never measure one of them.
    const row = tableRef.current?.querySelector<HTMLElement>('tbody[data-id]')
    const height = row?.getBoundingClientRect().height ?? 0
    setRowHeight(height > 0 ? height : 0)
  }, [enabled, tableRef, rowCount])

  const recompute = useCallback(() => {
    const table = tableRef.current
    if (!table || rowHeight <= 0) return

    const box = table.getBoundingClientRect()
    /* Where the rows start, in viewport coordinates: the table's own top plus
       whatever the sticky-ish header above them occupies. */
    const head = table.querySelector<HTMLElement>('thead')
    const top = box.top + (head?.getBoundingClientRect().height ?? 0)

    // How far the first row is above the top of the viewport.
    const scrolledPast = Math.max(0, -top)
    const first = Math.max(0, Math.floor(scrolledPast / rowHeight) - OVERSCAN)
    const visible = Math.ceil(window.innerHeight / rowHeight)
    const count = Math.min(rowCount - first, visible + OVERSCAN * 2)

    const now = applied.current
    if (now && now.first === first && now.count === count) return
    setRange({ first, count })
  }, [rowHeight, rowCount, tableRef])

  useEffect(() => {
    if (!enabled || rowHeight <= 0) {
      setRange(null)
      return
    }

    recompute()

    /* Coalesced to one recompute per frame. A wheel or a trackpad fires scroll
       events faster than the browser paints, and doing this work per event is
       how a virtualised list ends up slower than the one it replaced. */
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        recompute()
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled, rowHeight, recompute])

  if (!enabled || rowHeight <= 0 || !range) return null

  const first = Math.min(range.first, Math.max(0, rowCount - 1))
  const count = Math.min(range.count, rowCount - first)
  return {
    first,
    count,
    padTop: first * rowHeight,
    padBottom: Math.max(0, (rowCount - first - count) * rowHeight),
  }
}

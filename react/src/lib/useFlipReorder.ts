/**
 * FLIP reordering.
 *
 * A reorder splices the array and repaints, which lands every row in its new
 * place instantly. FLIP measures where things were, puts them back with a
 * transform, then lets that transform animate away — so the jump plays as a
 * slide without the layout ever being faked.
 *
 * In React the measurement has to straddle a commit: `snapshot()` is called from
 * the event handler just before the state update, and the layout effect below
 * plays the difference after React has moved the DOM nodes but before the
 * browser paints. Rows and columns are keyed, so React moves the existing nodes
 * rather than rebuilding them — which is also what keeps an in-flight HTML5 drag
 * alive.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

export type FlipAxis = 'Y' | 'X'

const DURATION = '200ms'
const EASING = 'cubic-bezier(.2,.7,.3,1)'

/** `pairs` is [element, distance it appears to have travelled]. */
function play(pairs: Array<[HTMLElement, number]>, axis: FlipAxis, root: HTMLElement) {
  const moved = pairs.filter(([, delta]) => Math.abs(delta) > 0.5)
  if (!moved.length) return

  moved.forEach(([el, delta]) => {
    el.classList.add('dt-flipping')
    el.style.transition = 'none'
    el.style.transform = `translate${axis}(${delta}px)`
  })

  void root.offsetHeight // flush before the transition goes on

  requestAnimationFrame(() => {
    moved.forEach(([el]) => {
      el.style.transition = `transform ${DURATION} ${EASING}`
      el.style.transform = ''
      const done = (event: TransitionEvent) => {
        if (event.propertyName !== 'transform') return
        el.removeEventListener('transitionend', done)
        el.classList.remove('dt-flipping')
        el.style.transition = ''
      }
      el.addEventListener('transitionend', done)
    })
  })
}

function readRows(root: HTMLElement) {
  const map = new Map<string, number>()
  root.querySelectorAll<HTMLElement>('tbody[data-id]').forEach((el) => {
    map.set(el.dataset.id as string, el.getBoundingClientRect().top)
  })
  return map
}

function readCols(root: HTMLElement) {
  const map = new Map<string, number>()
  root.querySelectorAll<HTMLElement>('th[data-key]').forEach((el) => {
    map.set(el.dataset.key as string, el.getBoundingClientRect().left)
  })
  return map
}

export function useFlipReorder(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const pending = useRef<{ axis: FlipAxis; first: Map<string, number> } | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  /** Call immediately before the state update that reorders. */
  const snapshot = useCallback(
    (axis: FlipAxis) => {
      const root = rootRef.current
      if (!enabledRef.current || !root) return
      // Consumed by the layout effect below on the very next commit. Both
      // callers check that the move is real before snapshotting and always
      // dispatch afterwards, so a measurement can never be left behind to
      // replay later against stale positions.
      pending.current = { axis, first: axis === 'Y' ? readRows(root) : readCols(root) }
    },
    [rootRef],
  )

  useLayoutEffect(() => {
    const job = pending.current
    if (!job) return
    pending.current = null

    const root = rootRef.current
    if (!root || !enabledRef.current) return

    const pairs: Array<[HTMLElement, number]> = []

    if (job.axis === 'Y') {
      root.querySelectorAll<HTMLElement>('tbody[data-id]').forEach((el) => {
        const id = el.dataset.id as string
        const before = job.first.get(id)
        if (before === undefined) return
        pairs.push([el, before - el.getBoundingClientRect().top])
      })
    } else {
      root.querySelectorAll<HTMLElement>('th[data-key]').forEach((th) => {
        const key = th.dataset.key as string
        const before = job.first.get(key)
        if (before === undefined) return
        const delta = before - th.getBoundingClientRect().left
        if (Math.abs(delta) <= 0.5) return
        // the header and every cell beneath it travel together
        pairs.push([th, delta])
        root
          .querySelectorAll<HTMLElement>(`td[data-key="${key}"]`)
          .forEach((td) => pairs.push([td, delta]))
      })
    }

    play(pairs, job.axis, root)
  })

  return snapshot
}

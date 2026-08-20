import { useCallback, useSyncExternalStore } from 'react'
import type { MotionPreference } from './types'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getSnapshot() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

const getServerSnapshot = () => false

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Whether the component should animate.
 *
 * The prototype animates by default and only defers to the OS with
 * `?motion=auto`, because demonstrating the motion is the point of it. The
 * handoff says the production port should invert that, so `'auto'` — honour the
 * preference — is the default here. `'always'` restores the prototype's
 * behaviour for presenting.
 */
export function useMotionEnabled(preference: MotionPreference = 'auto'): boolean {
  const reduce = usePrefersReducedMotion()
  if (preference === 'always') return true
  if (preference === 'never') return false
  return !reduce
}

/** Reads the current value without subscribing — for event handlers. */
export function useMotionRead(preference: MotionPreference = 'auto') {
  return useCallback(() => {
    if (preference === 'always') return true
    if (preference === 'never') return false
    return !getSnapshot()
  }, [preference])
}

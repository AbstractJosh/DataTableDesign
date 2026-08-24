/**
 * The expanded row's detail panes, and the two halves of their animation.
 *
 * Opening measures the grid at its natural height and starts the animation in
 * the same commit — React re-renders synchronously out of the layout effect, so
 * no frame is painted in between and there is no flash of the pane at full
 * height before it animates open.
 *
 * Closing cannot animate an unmounted element, so the parent keeps the row
 * rendered (with the height it measured at the moment of the click) until the
 * animation reports back. The fallback for an `animationend` that never arrives
 * is a timer in `DataTable` rather than here: it has to outlive this component,
 * because the row it belongs to can be detached mid-animation.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { EN, type Strings } from './i18n'
import type { DataTableRecord } from './types'

export interface DetailPaneProps {
  record: DataTableRecord
  colSpan: number
  /** The dictionary in force. Only the six pane labels come out of it — every
      value below is the record's own and is never translated. */
  strings?: Strings
  /** Play the enter animation — set only by the click that opened the row. */
  animateIn: boolean
  /** Present while the pane is animating out: the height it was measured at. */
  collapseHeight?: number
  motion: boolean
  onEnterEnd: () => void
  onCollapseEnd: () => void
}

function Pane({ label, value }: { label: string; value: string }) {
  return (
    <div className="dt-pane">
      <div className="dt-pane-label">{label}</div>
      <div className="dt-pane-value">{value}</div>
    </div>
  )
}

export function DetailPane({
  record,
  colSpan,
  strings: t = EN,
  animateIn,
  collapseHeight,
  motion,
  onEnterEnd,
  onCollapseEnd,
}: DetailPaneProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [enterHeight, setEnterHeight] = useState<number | null>(null)

  const collapsing = collapseHeight !== undefined
  const phase = collapsing ? 'out' : animateIn ? 'in' : 'idle'

  // Callbacks are read through a ref so the effect keys on the phase alone.
  const callbacks = useRef({ onEnterEnd, onCollapseEnd })
  callbacks.current = { onEnterEnd, onCollapseEnd }

  useLayoutEffect(() => {
    if (phase === 'idle') {
      setEnterHeight(null)
      return
    }

    if (phase === 'out') {
      // A collapse that interrupts an enter has to drop the measurement, or the
      // next open renders `dt-entering` before this effect measures, and the
      // grid is then measured *through* the running animation — at max-height 0.
      setEnterHeight(null)
      if (!motion) callbacks.current.onCollapseEnd()
      return
    }

    // phase === 'in'
    const el = gridRef.current
    if (!el) return
    if (!motion) {
      callbacks.current.onEnterEnd()
      return
    }
    // A fixed 440px would spend most of the duration beyond the real height, so
    // the easing curve would land outside what you can see and the motion would
    // read as a snap. Measure instead.
    setEnterHeight(Math.ceil(el.getBoundingClientRect().height))
  }, [phase, motion])

  const entering = phase === 'in' && enterHeight !== null

  const paneHeight = collapsing ? collapseHeight : entering ? enterHeight : undefined
  const style =
    paneHeight === undefined
      ? undefined
      : ({ ['--dt-pane-h' as string]: `${paneHeight}px` } as CSSProperties)

  const className =
    'dt-detail-grid' +
    (entering ? ' dt-entering' : '') +
    (collapsing ? ' dt-collapsing' : '')

  return (
    <tr>
      <td className="dt-detail-cell" colSpan={colSpan}>
        <div
          ref={gridRef}
          className={className}
          style={style}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (collapsing) callbacks.current.onCollapseEnd()
            else if (entering) callbacks.current.onEnterEnd()
          }}
        >
          <Pane label={t.paneRecordId} value={record.id} />
          <Pane label={t.paneOwner} value={record.owner} />
          {/* PORT ADDITION: email lost its table column to `favouriteSeason` and
              lives here now. It sits on row 1 so the short values stay together
              and the note keeps a full row to itself. */}
          <Pane label={t.paneEmail} value={record.email} />
          <Pane label={t.panePlan} value={record.plan} />
          <Pane label={t.paneActivity} value={record.activity} />
          {/* Was `dt-pane-wide` (span 4) back when four panes filled row 1 exactly.
              Email makes five, so the note now shares row 2 with Last activity and
              spans the 3 remaining columns — a span of 4 would push it to its own
              row and leave three empty cells showing through the 1px var(--dt-n300)
              grid gaps as a ragged strip. */}
          <div className="dt-pane dt-pane-rest">
            <div className="dt-pane-label">{t.paneNote}</div>
            <div className="dt-pane-note">{record.note}</div>
          </div>
        </div>
      </td>
    </tr>
  )
}

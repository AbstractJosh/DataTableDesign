/**
 * Icons traced from Lucide (https://lucide.dev) — pencil, trash-2, chevron-down,
 * check, x, plus, rotate-ccw, settings — at stroke-linecap: square /
 * stroke-linejoin: miter to match the Modernist system's hard-edged geometry.
 * Swap in the host codebase's Lucide package if it has one; keep the stroke
 * widths, they are part of the design.
 */
import type { SVGProps } from 'react'

type IconProps = { size: number; width: number } & Omit<
  SVGProps<SVGSVGElement>,
  'width' | 'height'
>

function Icon({ size, width, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 12px / stroke 4 — the selection squares. */
export const CheckIcon = () => (
  <Icon size={12} width={4}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

/** 15px / stroke 2 — a check at action-icon scale (confirm, save, done editing). */
export const DoneIcon = () => (
  <Icon size={15} width={2}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

export const CrossIcon = () => (
  <Icon size={15} width={2}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
)

/** 16px / stroke 4 — the row expand chevron. Rotated by CSS, not by a second icon. */
export const ChevronDownIcon = () => (
  <Icon size={16} width={4}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

export const PencilIcon = () => (
  <Icon size={15} width={2}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon size={15} width={2}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Icon>
)

/** 18px / stroke 4 — the primary "New record" button. */
export const PlusIcon = () => (
  <Icon size={18} width={4}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
)

/** 12px / stroke 3 — the rows-per-page stepper. */
export const StepUpIcon = () => (
  <Icon size={12} width={3}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
)

/** 12px / stroke 3 — the rows-per-page stepper. */
export const StepDownIcon = () => (
  <Icon size={12} width={3}>
    <path d="M5 12h14" />
  </Icon>
)

/**
 * 15px / stroke 2 — rotate-ccw, on the dock's revert. A circular arrow rather
 * than undo-2's straight one: this puts the whole dock back to unfiltered, it
 * does not step back through the filters one at a time.
 */
export const RevertIcon = () => (
  <Icon size={15} width={2}>
    <path d="M3 2v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" />
  </Icon>
)

/**
 * 18px / stroke 2 — lucide `settings`, on the toolbar's metric cog. The
 * six-lobed gear rather than `sliders-horizontal`: the panel behind it is three
 * radio groups, not a rack of continuous controls, and a cog is the one shape
 * every toolbar spends on "set how this reads".
 *
 * Stroke 2 at 18px puts about 1.5px on screen — the pencil / trash family's
 * weight rather than the plus's 3px. A gear this size cannot take the plus's
 * stroke 4: the six tabs close up into a blob at the rim.
 */
export const CogIcon = () => (
  <Icon size={18} width={2}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

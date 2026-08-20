/**
 * Icons traced from Lucide (https://lucide.dev) — pencil, trash-2, chevron-down,
 * check, x, plus — at stroke-linecap: square / stroke-linejoin: miter to match the
 * Modernist system's hard-edged geometry. Swap in the host codebase's Lucide
 * package if it has one; keep the stroke widths, they are part of the design.
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

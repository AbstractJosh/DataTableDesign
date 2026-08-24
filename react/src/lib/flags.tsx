/**
 * PORT ADDITION: the two flags the language switch prints, drawn rather than
 * fetched.
 *
 * They are inline SVG for the same reason `icons.tsx` and `logo.ts` are: the
 * package ships one `.js` and one `.css`, and a host must not have to teach its
 * bundler about a `.png` per language. Vector also survives the one thing a
 * 24x16 raster flag cannot — a 2x display and a user zoomed to 200%.
 *
 * Two rules govern the drawing:
 *
 * 1. **No `id`s.** A `<clipPath>` or `<mask>` needs one, and an `id` inside a
 *    component that can render more than once per page is a collision. The
 *    Union Flag's counterchanged red saltire is the one shape that wants a
 *    clip, so it is drawn as four explicit quadrilaterals instead — see below.
 *    Anything that runs off the edge is left to the SVG viewport's own clip.
 *
 * 2. **One box for both.** The Turkish flag is officially 2:3 and the Union
 *    Flag 1:2, and two segments of different widths would read as a mistake in
 *    a control this small. Both are drawn into the same 60x40 viewBox, which is
 *    Turkey's true ratio and the ratio flag icon sets conventionally normalise
 *    the Union Flag to. The Union Flag's diagonals are therefore steeper than
 *    on a real one; every band width still scales from the height, so the
 *    proportions inside the flag stay right.
 *
 * The `title`/`aria-label` on the button is what names the language — these are
 * `aria-hidden`, and a reader that meets one hears nothing.
 */
import type { SVGProps } from 'react'

/** 3:2 at the size the switch prints them; the viewBox does the rest. */
type FlagProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'>

function Flag({ children, ...rest }: FlagProps) {
  return (
    <svg
      viewBox="0 0 60 40"
      width={24}
      height={16}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * Türkiye — the ay-yıldız, to the official construction scaled to G = 40:
 * the crescent is a white disc of diameter G/2 centred at G/2 from the hoist,
 * with a red disc of diameter 0.4G centred G/16 further along eating the
 * inside of it. The star's circumscribed circle is G/3 across and clears the
 * red disc by G/32, and it is rotated so one arm points back into the
 * crescent's opening — the star is not upright on this flag.
 */
export const FlagTR = (props: FlagProps) => (
  <Flag {...props}>
    <rect width="60" height="40" fill="#e30a17" />
    <circle cx="20" cy="20" r="10" fill="#fff" />
    {/* Not a crescent path: the bite is the field's own red painted back over
        the disc, so the two shapes can never disagree about the colour. */}
    <circle cx="22.5" cy="20" r="8" fill="#e30a17" />
    <path
      fill="#fff"
      d="M31.753,20 36.36,18.503 36.36,13.66 39.207,17.578 43.813,16.081 40.966,20 43.813,23.919 39.207,22.422 36.36,26.34 36.36,21.497Z"
    />
  </Flag>
)

/**
 * The Union Flag. Band widths are the standard fractions of the height H = 40:
 * the white saltire is H/5, the white cross H/3, and both red charges H/5. The
 * red saltire is the awkward one — it is counterchanged, meaning in each
 * quarter it hugs one side of the white band rather than sitting centred in it,
 * and which side alternates. Rather than clip a stroked X (which would need an
 * `id`), each of the four arms is its own quadrilateral: two long edges
 * parallel to the diagonal, H/15 apart measured square to it, cut off square at
 * x = 30 where the central cross covers the joint. The arms overshoot the
 * viewBox so the corners come to a point instead of a butt cap.
 */
export const FlagGB = (props: FlagProps) => (
  <Flag {...props}>
    <rect width="60" height="40" fill="#012169" />
    <path
      d="M-10,-6.667 70,46.667M70,-6.667 -10,46.667"
      stroke="#fff"
      strokeWidth="8"
      fill="none"
    />
    {/* Hoist-top and fly-bottom take the lower side of their diagonal; the
        other two take the upper. That alternation is the counterchange, and
        flipping it is the classic way to fly this flag upside down. */}
    <path
      fill="#c8102e"
      d="M-10,-6.667 30,20 30,23.205 -10,-3.462ZM30,20 70,46.667 70,43.462 30,16.795ZM30,20 70,-6.667 70,-9.872 30,16.795ZM30,20 -10,46.667 -10,49.872 30,23.205Z"
    />
    <path d="M30,0V40M0,20H60" stroke="#fff" strokeWidth="13.333" fill="none" />
    <path d="M30,0V40M0,20H60" stroke="#c8102e" strokeWidth="8" fill="none" />
  </Flag>
)

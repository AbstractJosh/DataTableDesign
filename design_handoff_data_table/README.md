# Handoff: Data Table Template

## Overview
A single-screen, fully interactive data table template for an internal records/directory view: search, status filtering, column sorting, row selection with a bulk-action bar, expandable row detail panels, drag-to-reorder rows AND columns, and pagination. Built on the **Modernist** design system (flat, architectural, Archivo, zero corner radius, strong 2px rules) with a project-specific navy accent.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing the intended look and behavior, not production code to copy directly. `Data Table.dc.html` uses an internal streaming-template runtime (`<x-dc>`, `{{ holes }}`, `<sc-for>`, `<sc-if>`, a `Component extends DCLogic` class); it is *not* a React/Vue file and should not be ported literally.

The task is to **recreate this design in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established patterns, table primitives and component library. If no environment exists yet, pick the most appropriate framework and implement it there. The logic class maps cleanly onto one stateful component; the spec below gives everything needed.

## Fidelity
**High fidelity.** Final colors, typography, spacing, borders and interaction states are all specified exactly and should be matched pixel-for-pixel, expressed through the target codebase's own tokens/components where equivalents exist.

## Screens / Views

### Data table (single screen)
**Purpose:** browse, filter, sort, reorder, select and act on records.

**Page frame**
- Full-height page, background `#f3f2f2`, text `#201e1d`, font `Archivo` (400/500/600/700/800), padding `40px 48px 64px`.
- Content column: `max-width: 1400px`, centered.

**1. Page header** — flex row, `align-items: flex-end`, `justify-content: space-between`, gap 32px, `border-bottom: 2px solid #201e1d`, `padding-bottom: 18px`.
- Left: kicker "Records / Directory" — 11px / 600 / `letter-spacing: .18em` / uppercase / `#7d7979`, margin-bottom 10px. Below it `<h1>` "Data table" — 44px / 800 / `letter-spacing: -.025em` / `line-height: .95`.
- Right: three stat blocks (gap 40px): label 10px/600/.16em/uppercase/`#7d7979` + value 22px/700. Labels: **Total** (all records), **Matching** (after search+filter), **Selected** (checked count).

**2. Toolbar** — flex row, gap 12px, `padding: 18px 0`, wraps.
- Search input: `flex: 1 1 280px`, max 380px, min 220px, padding `11px 13px`, `border: 2px solid #201e1d`, background `#f8f4f4`, 13px/500, radius 0, no default outline. Placeholder: "Search name, email or address". Filters on every keystroke; resets to page 1.
- Status segmented control: outer `border: 2px solid #201e1d`, background `#f8f4f4`; options **All / Success / In progress / Failed**. Each option: padding `11px 14px`, 11px/700/.12em/uppercase, `border-right: 2px solid #201e1d`, transparent background. Active option: background = accent, text `#f3f2f2`.
- Spacer (`flex: 1`).
- "Reset order" button (secondary): padding `11px 16px`, `border: 2px solid #201e1d`, transparent, 11px/700/.12em/uppercase, label flush left. Clears sorting and restores default column order.
- "New record" button (primary, icon-only): 42px square, background + border = accent, contents centered — an 18px Lucide `plus` icon at stroke-width 4, square caps, in `#f3f2f2`. No label; `title`/`aria-label` = "New record". (No handler in the prototype.)

**3. Bulk-action bar** — only rendered when ≥1 row is selected. Full-width strip, background = accent, text `#f3f2f2`, padding `12px 16px`, flex space-between.
- Left: "N SELECTED" — 12px/700/.1em/uppercase.
- Right: buttons **Export**, **Archive**, **Delete**, **Clear** — padding `7px 12px`, 10px/700/.12em/uppercase; first three `border: 2px solid #f3f2f2` on transparent; "Clear" is borderless at `opacity: .7`. Delete removes selected rows; Clear empties the selection. Export/Archive are stubs.

**4. Table** — horizontal scroll container; `table-layout: fixed`, `border-collapse: collapse`, `width: 100%`, `min-width: 1222px`, base font 13px.

Header row (the accent bar) — every `th`: background = accent, color `#f3f2f2`, `border-bottom: 2px solid` accent, `border-right: 2px solid rgba(243,242,242,.35)` (last cell none), padding `12px`, 10px/700/.16em/uppercase, left-aligned.
- Cell 1 (56px, centered, padding `8px 10px`): the ALP logo mark, height 32px, width auto.
- Cell 2 (56px, centered, padding `12px 8px`): select-all box — 22px square, `border: 2.5px solid rgba(243,242,242,.8)`, transparent; shows a 12px check icon (stroke-width 4, square caps) in `#f3f2f2` when all visible rows are selected.
- Cells 3–8 (draggable, reorderable): **Name** 200px, **Date** 140px, **Status** 140px, **Mobile no** 170px, **Email ID** 210px, **Address** 300px. Each holds a flex row (gap 7px, `user-select: none`): a grip glyph "⠿" at `rgba(243,242,242,.55)` (cursor `grab`), the label (cursor `pointer`, click = sort), and a sort caret "▼" 8px — `rgba(243,242,242,.45)` when inactive, `#f3f2f2` when the column is sorted, rotated 180° for ascending, `transition: transform 180ms ease, color 180ms ease`. Inactive columns render at `opacity: .92`.
- Cell 9 **Action** (130px, padding `12px 16px 12px 12px`).

Body rows — one `<tbody>` per record (so the detail row is a sibling `<tr>`), draggable.
- Row: `border-left: 3px solid transparent`; when selected `border-left: 3px solid` accent and background `#eae9e9`. Optional zebra: odd rows `#f8f4f4`.
- Every cell: padding `15px 12px` (comfortable) or `9px 12px` (compact), `border-bottom: 1px solid #d7d3d3` (suppressed on an expanded row), `vertical-align: middle`.
- Grip cell (centered): "⠿" glyph, 14px, `#bab6b6`, cursor `grab`.
- Select cell (centered): 22px square button, `border: 2.5px solid #9b9797` (accent when selected), transparent background, 12px check icon (stroke-width 4) in the accent when selected.
- **Name** cell: flex row gap 9px — an 18px borderless chevron-down button (16px icon, stroke-width 4, color `#201e1d`, accent when expanded, `transform: rotate(180deg)` + `transition: transform 180ms ease` when open) then the name at weight 700.
- **Status** cell: outlined pill — `display: inline-block`, padding `4px 9px`, `border: 2px solid`, 10px/700/.1em/uppercase, `white-space: nowrap`, square corners. Success → `#2f7d4f`; In progress → text `#605d5d`, border `#9b9797`; Failed → `#ec3013` (text and border alike in each case).
- Text cells: weight 500, `font-variant-numeric: tabular-nums`; Email and Address in `#605d5d`, others in `#201e1d`.
- **Action** cell: two 30px square icon buttons, gap 8px, `border: 2px solid`, transparent fill, 15px Lucide icons at stroke-width 2 with square caps — **pencil** in the accent (stub) and **trash-2** in `#ec3013` (deletes that row).

Detail row (expanded only) — `<td colspan="9">`, padding `0 12px 18px 46px`, background `#eae9e9`, `border-bottom: 1px solid #d7d3d3`. Inside: a 4-column grid, `gap: 1px`, background + border `#d7d3d3` (1px), so cells read as hairline-ruled panes; each pane background `#f8f4f4`, padding `16px 18px`, label 10px/700/.16em/uppercase/`#7d7979` (margin-bottom 8px) over a 14px/600 value. Panes: **Record ID**, **Owner**, **Last activity**, **Plan**, then a full-width (span 4) **Note** pane whose body is 14px, `line-height: 1.5`, `max-width: 70ch`, `text-wrap: pretty`.

Empty state (no rows match) — `padding: 56px 0`, `border-bottom: 2px solid #201e1d`, left aligned: "No records match" 16px/700 over "Clear the search field or pick a different status filter." 13px `#605d5d`.

**5. Footer** — `border-top: 2px solid #201e1d`, `padding-top: 18px`, flex space-between, wraps.
- Left: "Showing **1–8** of 40 entries" — 12px `#605d5d`, the range in `#201e1d`/700.
- Right: pager, gap 6px. "‹ Prev" / "Next ›": height 34px, padding `0 12px`, `border: 2px solid #bab6b6`, transparent, 11px/700/.08em/uppercase, `#605d5d`. Numbered pages: min-width 34px, height 34px, `border: 2px solid #bab6b6`, transparent, 12px/700; active page: background + border = accent, text `#f3f2f2`.

## Interactions & Behavior
- **Search** — case-insensitive substring match across name + email + address + mobile; resets to page 1.
- **Status filter** — exact match on status, "All" disables it; resets to page 1.
- **Sort** — clicking a column label cycles ascending → descending → unsorted. Comparison is `String(a[key]).localeCompare(String(b[key]))` on the filtered set (so it is lexicographic, including for dates — swap in real date/number comparators when wiring real data).
- **Row selection** — per-row toggle keyed by record id; the header box toggles all rows on the current page (checked only when every visible row is selected). Selection survives paging and filtering.
- **Bulk actions** — Delete removes all selected records and clears the selection; Clear empties selection; Export/Archive are stubs.
- **Expand** — per-row toggle keyed by record id; multiple rows can be open at once. The detail grid animates in with `@keyframes dtExpand { from { opacity: 0; max-height: 0 } to { opacity: 1; max-height: 440px } }`, `200ms ease-out`, `overflow: hidden`. Collapse is instant (the row unmounts).
- **Drag rows** — HTML5 drag on the `<tr>` (grip is the visual affordance). On `dragstart` the dragged record id is stored; on `dragenter` over another row the record is spliced into that row's position immediately (live reorder); `dragover` calls `preventDefault()`; `dragend` clears the reference. Reordering clears any active sort.
- **Drag columns** — same pattern on the `<th>` elements, splicing the column key within the column-order array.
- **Delete row** — trash button removes that record from the data array.
- **Reset order** — clears sort and restores column order `[name, date, status, mobile, email, address]`.
- **Pagination** — Prev/Next clamp to range; page count = `ceil(filtered.length / rowsPerPage)`; the current page clamps down when filtering shrinks the result set.
- **Animations** — only the two above (detail expand, caret rotation), both intentionally subtle.
- **Focus** — `:focus-visible { outline: 2px solid #1d2d46; outline-offset: 2px }` on buttons, inputs and header cells; never the browser default.
- **Responsive** — the table itself does not reflow; below ~1222px it scrolls horizontally inside its container. The toolbar and footer wrap.

## State Management
Single stateful component:
- `data: Record[]` — the record list; mutated by row reorder and delete.
- `cols: string[]` — column order, default `["name","date","status","mobile","email","address"]`.
- `selected: Record<string, boolean>` — keyed by record id.
- `expanded: Record<string, boolean>` — keyed by record id.
- `sort: { key: string, dir: "asc" | "desc" } | null`.
- `query: string`, `filter: "All" | "Success" | "In progress" | "Failed"`, `page: number` (0-indexed).
- Non-render refs: `dragRow` (record id) and `dragCol` (column key) held outside state so dragging does not re-render on every event.

Derived per render, in this order: filter (status then query) → sort → paginate → slice to the visible page.

Record shape: `{ id, name, date, status, mobile, email, address, owner, activity, plan, note }`. The prototype ships 16 placeholder records with ids `REC-4820`, `REC-4827`, … (step 7). No data fetching — swap in the real API and keep the derive order.

Configurable props (surfaced as tweaks in the prototype):
- `accentColor` — default `#1d2d46`; drives the header bar, primary button, active filter, active page, selection rules, Edit icon and expand chevron.
- `density` — `"comfortable"` (15px cell padding) | `"compact"` (9px).
- `rowsPerPage` — int, default 8 (4–16).
- `zebraRows` — boolean, default true (odd rows `#f8f4f4`).

## Design Tokens
From the Modernist system (`_ds/modernist-.../styles.css`), with project overrides noted:

Colors
- Ground `#f3f2f2`; surface `#eae9e9`; ink `#201e1d`.
- Neutrals: `#f8f4f4`, `#eae7e7`, `#d7d3d3`, `#bab6b6`, `#9b9797`, `#7d7979`, `#605d5d`, `#444141`, `#2d2b2b`.
- **Accent (project override): `#1d2d46`** — replaces the system's default red `#ec3013` as the primary accent.
- `#ec3013` is kept for destructive/negative only: Failed pills, the delete icon button, link hover.
- Success green (project addition): `#2f7d4f`.
- Reversed text on accent: `#f3f2f2`; reversed hairlines: `rgba(243,242,242,.35)` / `.55` / `.8`.

Spacing — 4 / 8 / 12 / 16 / 24 / 32px scale. Cell padding 15px (comfortable) or 9px (compact) × 12px.

Typography — Archivo throughout. 44px/800 page title; 22px/700 stat values; 16px/700 empty-state title; 14px/600 detail values; 13px body and table text; 12px pager numbers and footer copy; 11px control labels (.12em uppercase) and kickers (.18em); 10px table headers and pills (.16em / .1em uppercase). Weights 500 (data), 600, 700 (labels, names), 800 (title).

Radius — **0 everywhere** (system rule; do not round anything).

Borders — 2px is the system's structural rule (page header, footer, toolbar controls, header separators, pills, icon buttons); 1px `#d7d3d3` for row dividers; 2.5px on the 22px selection squares; 3px accent row-selected marker.

Shadows — none used. (System offers `--shadow-sm/md/lg`; a beveled/3D header treatment was tried and explicitly rejected — keep it flat.)

Motion — 180ms ease (caret + chevron rotation), 200ms ease-out (detail expand).

## Assets
- `uploads/Alp_Havacılık-1538940458.png` — ALP logo mark (166×258, transparent PNG), rendered at 32px height in the table header's first cell. Supplied by the user; replace with the codebase's own asset pipeline copy.
- Icons are inline SVGs traced from **Lucide** (`https://lucide.dev`) — `pencil`, `trash-2`, `chevron-down`, `check`, `plus` — at stroke-width 2–4, `stroke-linecap: square`, `stroke-linejoin: miter` to match the system's hard-edged geometry. Use the codebase's Lucide package rather than the inlined paths.
- Fonts: Archivo via Google Fonts (weights 400–800).
- The grip affordance is the Braille glyph "⠿" (U+283F), not an icon.

## Files
- `Data Table.dc.html` — the design prototype (template + logic class + prop metadata). Open in a browser to interact with it.
- `_ds/modernist-.../styles.css` — the Modernist design-system token sheet and component layer the design is built against.
- `_ds/modernist-.../readme.md` — the design-system guide (rules, ramps, do/don't).
- `uploads/Alp_Havacılık-1538940458.png` — the logo asset.
- `support.js` — runtime for the prototype only; nothing to port.

## Notes for implementation
- Keep the accent override: the bound design system is red-accented, but this screen is **navy `#1d2d46`**; red is reserved for destructive states.
- Keep the flat treatment. Bevels, gradients and drop shadows on the header bar were explicitly rejected.
- Prefer the codebase's own table/checkbox/button primitives styled to this spec over hand-rolled markup, and prefer a real drag-and-drop library over the raw HTML5 handlers for row/column reordering (keyboard-accessible reordering is not implemented in the prototype and should be added).

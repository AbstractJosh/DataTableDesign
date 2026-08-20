# `@alp/data-table`

The **Records / Directory** data-table screen, ported to a portable React
component. One import, zero runtime dependencies, one stylesheet.

Search, a status filter, an adjustable page size, column sort, row selection,
expandable detail rows, inline editing, a draft "new record" row, in-place
delete confirmation, drag-to-reorder rows *and* columns (from their grips),
Excel-style cell-range selection with copy, and pagination — with the
prototype's animations kept: the measured-height detail expand, the FLIP
reorder slide, and the caret/chevron rotations.

Design source: `../data-table.html` (the interactive prototype) and
`../design_handoff_data_table/README.md` (the written spec). `PARITY.md` in this
folder is the behaviour inventory the port is checked against.

---

## Install

```
npm install @alp/data-table
```

`react` and `react-dom` (18.2+ or 19) are peer dependencies. Nothing else is.

## Use

```tsx
import { DataTable } from '@alp/data-table'
import '@alp/data-table/styles.css'
// optional — only if your app does not already load Archivo
import '@alp/data-table/fonts.css'

export function RecordsPage() {
  return <DataTable />
}
```

With no props it renders the design exactly as the prototype does, on the 17
bundled demo records. Wire it to real data with `records` / `onRecordsChange`:

```tsx
const [records, setRecords] = useState<DataTableRecord[]>([])

useEffect(() => {
  fetch('/api/records').then((r) => r.json()).then(setRecords)
}, [])

<DataTable
  records={records}
  onRecordsChange={setRecords}
  onExport={(selected) => download(selected)}
  onArchive={(selected) => archive(selected.map((r) => r.id))}
/>
```

`records` makes the component controlled: it renders exactly the array you pass
and never mutates it. Every add, edit, delete and reorder arrives as a new array
through `onRecordsChange`, and nothing changes on screen until you put it back.
Omit `records` (optionally seeding with `defaultRecords`) to let the component
own the list.

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `records` | `DataTableRecord[]` | — | Controlled record list. |
| `defaultRecords` | `DataTableRecord[]` | the demo set | Initial list when uncontrolled. |
| `onRecordsChange` | `(next) => void` | — | Add, edit, delete, reorder. |
| `columns` | `ColumnKey[]` | all six | Initial column order; also what **Reset order** restores. |
| `accentColor` | `string` | `#1d2d46` | Header bar, primary button, active filter and page, selection rules, pencil, chevron. |
| `density` | `'comfortable' \| 'compact'` | `comfortable` | 15px or 9px vertical cell padding. |
| `rowsPerPage` | `number` | `8` | The page size the table **opens on**; the toolbar's slider owns it after that. |
| `onRowsPerPageChange` | `(rows) => void` | — | Fired when that slider moves. |
| `zebraRows` | `boolean` | `true` | Odd rows on `#f8f4f4`. |
| `title` | `string` | `Data table` | |
| `kicker` | `string` | `Records / Directory` | |
| `showHeader` | `boolean` | `true` | Drop the title block and stats to embed the table in an existing page frame. |
| `logoSrc` | `string \| null` | the ALP mark | The header's first cell. `null` leaves it empty. |
| `motion` | `'auto' \| 'always' \| 'never'` | `auto` | See **Motion**. |
| `cellSelection` | `boolean` | `true` | Excel-style cell ranges. See **Selecting cells**. |
| `onExport` / `onArchive` | `(selected) => void` | — | The two toolbar actions; they stay disabled until something is selected. |
| `onSelectionChange` | `(ids) => void` | — | |
| `onEditRecord` | `(record) => void` | — | Fired when the pencil arms a row, for hosts that would rather open their own editor. |
| `className` / `style` | | | Merged onto the root; `style` can override the accent and padding custom properties. |
| `children` | `ReactNode` | — | Slot between the toolbar and the table. |

A `DataTableRecord` is
`{ id, name, date, status, mobile, email, address, owner, activity, plan, note }`,
where `status` is `'Success' | 'In progress' | 'Failed'`. The last four fields
fill the detail panes.

## Selecting cells

There are two selections, and they do not talk to each other.

**Rows** are selected with the checkboxes. That selection is keyed by record id,
survives paging and filtering, drives the *Selected* stat and the Export /
Archive buttons, and is what `onSelectionChange` reports.

**Cells** are selected as a rectangle, the way a spreadsheet does it — drag
across them, or click one and Shift+click another. It is a view-level thing:
the rectangle is stored as page coordinates, so a search, a sort, a page change
or a reorder drops it rather than dragging a stale selection along. Nothing is
reported to the host; the point of it is the clipboard.

| | |
|---|---|
| drag across cells | select the rectangle they span |
| `Shift` + click | extend from the anchor, which does not move |
| `↑` `↓` `←` `→` | move the selection one cell |
| `Shift` + arrow | stretch the rectangle |
| `Home` / `End` | first / last column of the row (`Ctrl` too: first / last cell) |
| `Ctrl`/`Cmd` + `A` | every cell on the page |
| `Ctrl`/`Cmd` + `C` | copy the rectangle |
| `Escape` | clear it |

The copy carries both `text/plain` (tab-separated, Excel's quoting rule for
values holding a tab, a newline or a quote) and `text/html` (a real `<table>`),
so it pastes into Excel, Sheets and Word as cells rather than as one string. The
columns come out in the order they are on screen, not the order they are
declared. Where the async clipboard API is unavailable — an insecure `http://`
origin — it falls back to `execCommand`.

The grid is a single tab stop: the moving corner carries `tabindex="0"` and
every other cell `-1`, so Tab still steps *past* the table rather than through
150 cells. Buttons inside cells keep their own clicks and keys — pressing the
row chevron only becomes a selection if the pointer leaves that cell first.

Not supported: Ctrl+click for a second rectangle, pasting, clearing cells, and
auto-scrolling the horizontal overflow while sweeping past its edge.

`cellSelection={false}` turns all of it off and gives the cells back plain text
selection.

## Styling

Everything is scoped under `.dt-root` — the component sets no global styles and
touches nothing outside itself. The design tokens are custom properties on that
element, so a host can retheme without patching CSS:

```css
.dt-root {
  --dt-accent: #1d2d46;   /* also settable with the accentColor prop */
  --dt-ground: #f3f2f2;   --dt-surface: #eae9e9;  --dt-ink: #201e1d;
  --dt-n100: #f8f4f4;     --dt-n300: #d7d3d3;     --dt-n400: #bab6b6;
  --dt-n500: #9b9797;     --dt-n600: #7d7979;     --dt-n700: #605d5d;
  --dt-danger: #ec3013;   --dt-success: #2f7d4f;  --dt-reversed: #f3f2f2;
  --dt-cell-pad-y: 15px;  /* also settable with the density prop */
  --dt-font: 'Archivo', system-ui, sans-serif;
  --dt-max-width: 1400px; /* the design's content column; `none` to fill the host */
}
```

The component reproduces the design's centred 1400px content column by default.
Dropping it into a panel that already has its own width, set
`--dt-max-width: none` (through `style`, or a rule on your own wrapper class) —
there is no specificity to fight.

Two rules from the Modernist system are load-bearing and should not be
overridden: **radius is 0 everywhere**, and structural borders are **2px** (1px
`#d7d3d3` only for row dividers). No shadows, no gradients — a beveled header was
tried and rejected. Red `#ec3013` is reserved for destructive and negative
states; the accent is navy.

The page frame around the component (background, padding, `::selection`) belongs
to the host. `src/demo/demo.css` shows the one the design assumes.

`fonts.css` is a separate entry so an app that already ships Archivo does not
download it twice. It carries the two woff2 subsets used by the prototype.

## Motion

`motion="auto"` (the default) honours `prefers-reduced-motion`, shortening every
animation to 1ms and skipping the measured ones entirely when the OS asks for
it — the handoff asks the production port to work this way. `motion="always"`
restores the prototype's behaviour of animating regardless. `motion="never"` is
unconditionally still.

> **If nothing animates, check this first.** On Windows, *Settings →
> Accessibility → Visual effects → **Animation effects*** off makes Chrome
> report `prefers-reduced-motion: reduce`, and `auto` then correctly suppresses
> everything. macOS has the same switch under *Accessibility → Display → Reduce
> motion*. This is why the prototype animated by default and needed
> `?motion=force`; the demo app defaults to `motion="always"` for the same
> reason, and shows the detected OS preference next to the control.

The animations themselves:

| | |
|---|---|
| detail pane open | `200ms` `dt-expand`, to the pane's **measured** height |
| detail pane close | `180ms` `dt-collapse`, from the height measured at the click |
| row / column reorder | FLIP, `200ms cubic-bezier(.2,.7,.3,1)` |
| status filter menu | `140ms` `dt-menu-in`, plus a `180ms ease` caret |
| sort caret, row chevron | `180ms ease` rotation and colour |

## Keyboard and accessibility

Everything is reachable without a pointer, including the reordering the
prototype could only do by drag:

| | |
|---|---|
| `Alt` + `↑` / `↓` on a row grip | move that row within the page |
| `Alt` + `←` / `→` on a column grip | move that column |
| arrows / `Shift`+arrows in a cell | move / stretch the cell range (see **Selecting cells**) |
| `Ctrl`/`Cmd` + `A` / `C` in a cell | select the page / copy the range |
| `Enter` in a cell editor | commit the field |
| `Enter` in the draft row | save the record |
| `Escape` (focus inside the table) | back out one level: delete confirmation → open editor → draft row → armed row → cell range |
| `↓` / `Enter` / `Space` on the status filter | open the menu; arrows and `Home` / `End` move, `Enter` picks, `Escape` closes |
| `←` / `→` on the rows-per-page slider | one row at a time (`Home` / `End` for the ends) |

Moves are announced through a polite live region. Sorted columns carry
`aria-sort`, the selection boxes and filter options `aria-pressed`, the row
chevrons `aria-expanded`, and the current page `aria-current`. Focus rings are
`:focus-visible` only, 2px in the accent.

Drag-and-drop uses the native HTML5 API, as the prototype does, but only the
`⠿` grips start a drag — the rest of the row belongs to the cell selection. If
you already have a drag library in the host app, the reorder entry points are
`moveRow(fromId, toId)` and `moveColumn(fromKey, toKey)` in `DataTable.tsx` —
swap the handlers and keep the FLIP hook.

## Development

```
npm install
npm run dev        # the demo at localhost:5173, with a prop harness
npm test           # 99 behaviour tests (vitest + jsdom)
npm run typecheck
npm run build      # dist/index.js + dist/data-table.css + dist/fonts
```

## Notes on the port

Faithful to the prototype except where React makes a mechanism unnecessary or a
host app makes it unsafe:

- **Reduced motion is honoured by default.** The prototype inverted this on
  purpose, and its own comment asks the production port to invert it back.
- **Class names are `dt-` prefixed and scoped.** The prototype styled bare
  `table` / `th` / `td` / `input` selectors, which would leak into a host app.
- **Records are immutable.** The prototype spliced and mutated its array in
  place; here every change produces a new array so the host can control it.
- **Keyboard reordering and the live region are new.** The prototype has none.
- **Only the grips drag.** The prototype made the whole `<tr>` and `<th>`
  draggable and left the grip decorative; here `draggable` is on the grip, a
  `dragstart` from anywhere else in the table is refused, and `setDragImage`
  keeps the row (or header cell) as the thing you see under the cursor.
- **Cell-range selection is new**, and is what needed the row body free. See
  **Selecting cells**.
- **The status filter is a dropdown**, where the prototype uses a four-position
  segmented switch with a sliding selector. Same options, same order, same
  effect — a quarter of the width, which is what makes room for the next one.
  It is a button plus a `role="listbox"` popup rather than a native `<select>`,
  whose OS-drawn popup cannot carry the system's flat, square styling.
- **Rows per page is a toolbar control**, not a fixed prop. Resizing follows the
  record at the top of the page rather than snapping back to page 1.
- **Editors are React inputs.** The prototype kept them uncontrolled and needed a
  document-level `mousedown` capture to commit before its `innerHTML` rebuild
  destroyed the node the user was clicking. React keeps the node, so commit on
  Enter or blur is enough.
- **The row-selected marker is an inset shadow**, not a `border-left` — as in the
  prototype, because under `border-collapse` a row border half-overflows the
  table box and forces a permanent horizontal scrollbar.
- **The logo is an inlined data URI** so the component needs no asset pipeline.
  Pass `logoSrc` to route it through yours instead; `src/lib/logo.png` is the
  same file.
- Sorting is still `String(a[key]).localeCompare(...)`, so it is lexicographic
  even for dates. Swap in real comparators when you wire real data.

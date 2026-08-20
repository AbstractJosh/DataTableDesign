# `@alp/data-table`

The **Records / Directory** data-table screen, ported to a portable React
component. One import, zero runtime dependencies, one stylesheet.

Search, a drag-to-build filter dock, an adjustable page size, column sort, row
selection, expandable detail rows, inline editing, a draft "new record" row,
in-place delete confirmation, drag-to-reorder rows *and* columns (from their
grips), Excel-style cell-range selection with copy and a readout of what the
selected cells come to, and pagination — with the prototype's animations kept:
the measured-height detail expand, the FLIP reorder slide, and the
caret/chevron rotations.

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
| `columns` | `ColumnKey[]` | all six | Initial column order. The header grips own it from then on; nothing puts it back. |
| `accentColor` | `string` | `#1d2d46` | Header bar, primary button, open filter chip, active page, selection rules, pencil, chevron. |
| `density` | `'comfortable' \| 'compact'` | `comfortable` | 15px or 9px vertical cell padding. |
| `rowsPerPage` | `number` | `8` | The page size the table **opens on**; the toolbar's slider owns it after that. |
| `onRowsPerPageChange` | `(rows) => void` | — | Fired when that slider moves. |
| `metrics` | `Partial<MetricPrefs>` | Sum, Success rate, Spring rate | What each **kind** of cell content reads as in the flow block. Merged over the defaults; read once, like `rowsPerPage`. See **The flow block**. |
| `onMetricsChange` | `(prefs) => void` | — | Fired when the toolbar's **Show** panel moves one of them. Carries the whole record, not the one that moved. |
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
| `children` | `ReactNode` | — | Slot between the filter dock and the table. |

A `DataTableRecord` is
`{ id, name, date, status, solvedCases, favouriteSeason, address, email, owner, activity, plan, note }`,
where `status` is `'Success' | 'In progress' | 'Failed'` and `favouriteSeason`
is `'Spring' | 'Summer' | 'Autumn' | 'Winter'`. The first seven are the six
columns plus the id; the last five fill the detail panes. `email` is one of
them — it is not a column, but the search still reads it.

## Filtering

Above the table is the **filter dock**: a strip that starts empty, saying what
to do with it. Drag a column out of the table header by its `⠿` grip and drop it
in, and that column becomes a **chip** — its label, the condition it holds, and a
popup to set that condition in. Or press the chain's head block — **Add
filter** — and pick the column from a list; the drag is a gesture, not a
requirement.

The column stays in the table. The dock is additive — a filter shelf, not a
pivot shelf — so the drag's trip across the header is undone on drop and the
column lands back where it started, sort intact.

A few rules are worth knowing before you wire real data to it:

- **A chip with no operand yet filters nothing.** A freshly dropped chip reads
  *Any* and is drawn hollow — the darker ground on its face, its value greyed —
  so it reads as unfilled rather than as a filter quietly passing everything.
  This is why the table does not go empty the moment you drop a column in, and it is why the drop opens the
  popup with focus already on the operand — the value box, or the first entry of
  an enum column's tick list.
- **Chips combine with AND.** Each one narrows what the ones before it left.
- **One chip per column.** A column that already has one is listed in the
  add-picker but not selectable; ranges are what the `is between` operator is
  for.
- **The operators follow the column's type, not its name.** `text` gets
  contains / does not contain / is / starts with; `number` gets is / at least /
  at most / over / under / between; `date` gets on / before / after / between;
  `enum` gets is any of / is none of, over that column's own values. Teaching a
  new column to filter is one entry in `COLUMN_TYPES` — there is no per-column
  branch in the UI.
- **The search box is separate** and runs after the chips. It reads name, email
  and address; the chips read one column each.

Three ways out, and they are not the same: the cross on a chip removes it,
**Clear** inside the popup empties that chip's operands and leaves it docked
(back to *Any*, filtering nothing), and the **revert** — the circular arrow left
of the head block, greyed out until there is something to revert — empties the
dock. **Done** only closes the popup, putting focus back on the
chip's own button. After a removal — either kind — focus lands somewhere
deliberate instead of falling to the top of the host page: the chip that took
the gap, or the head block when nothing is left.

Date operands are parsed properly — both the record's `19 August, 2026` and the
`2026-08-19` an `<input type="date">` hands over, as UTC midnight. Sorting is
still `localeCompare`, so a *sorted* date column is still lexicographic. That
asymmetry is deliberate and inherited from the prototype; swap in real
comparators when you wire real data.

The dock owns its conditions — there is no prop that seeds them or reports them
back. What is exported is the engine underneath, so a host can build the same
conditions itself and apply the same rules to its own copy of the records
(server-side, or across a result set an export has to cover):

```ts
import {
  COLUMN_TYPES, OPS_FOR_TYPE, OP_LABELS, ENUM_OPTIONS, matchesAll,
  type ColumnType, type FilterOp, type FilterCondition,
} from '@alp/data-table'

const active = records.filter((r) => matchesAll(r, conditions))
```

A hand-built `FilterCondition` needs all six fields — `values` for an enum
column, `value` (and `value2` for `is between`) for the rest, and an `id`, which
`matchesAll` never reads: it is a React key inside the dock, so any unique
string will do.

> **Upgrading:** `STATUS_FILTERS` and the `StatusFilter` type are **gone** with
> the toolbar dropdown they described. What arrives in their place is the list
> above, plus `SEASONS` and the `Season` type for the new column.

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

### The flow block

Select a run of cells that are all the same kind of thing and a panel appears in
the toolbar, just left of **Export**, saying what they come to. A run of numbers
totals; a run of **Status** cells reads as a rate. It is meant for the **Solved
cases** column, but it is not tied to it — or to any column: what a rectangle
answers is decided by what is *in* it, not by which columns it covers, so it
keeps working when a host swaps the column set out.

**What each kind reads as is a preference, not a mode.** The **Show** selector at
the right of the toolbar holds one metric per kind of cell content — Sum,
Product, Mean, Median, Highest or Lowest for numbers, and one rate per value for
each enum column (Status, Favourite season) — and the *selection* decides which
of them is in force. Set numbers to Mean once, and from then on dragging across
counts reads a mean while dragging across statuses reads whatever the Status
preference says, with nothing to change in between. The button names the metric
on show rather than a setting of its own, so it tracks the selection; with
nothing selected it falls back to the numbers preference.

The panel is one section per kind, each its own radio group with its own current
pick, and the section the selection is being read under is marked. A pick commits
immediately and leaves the panel open, so one visit can set more than one kind.
`metrics` seeds the record — partially, naming only the kinds you care about —
and `onMetricsChange` reports the whole of it back.

The rules are a spreadsheet's, and all of them predate the selector. Blank cells
are skipped rather than counted as zero; a rectangle that is not all one kind
takes the panel away entirely, because "what do these come to" has no answer for
a column of names, for a column of dates, or for half counts and half statuses;
and two cells is the floor everywhere — one lone value is not a sum, and "100% of
one cell" is not a rate. A total carries no more decimals than went into it, so
`0.1 + 0.2` reads `0.3`; a mean or a median, being derived rather than one of the
cells, is allowed two places past that; a product too big to read comes out in
exponent form; and a rate is at most one decimal, with the count it was taken
over beside it — `62.5% (5 of 8)`. Everything is formatted in the reader's
locale.

It sits after the toolbar's flex spacer, so it appears and disappears in the
gap — the buttons beside it never move. It slides in from their side and fades
back out the same way; the exit is held open by a timer, because an unmounted
element cannot animate, and it is skipped entirely when motion is off. The
selector beside it is a fixed width, so the toolbar does not shift when the
reading changes what it is called.

The block is `aria-hidden`, with the reading appended to the live region that
announces the selection instead — in sentence case, and naming the metric
actually in force: "Mean 42.5.", "Success rate 62.5%."

Not supported: Ctrl+click for a second rectangle, pasting, clearing cells, and
auto-scrolling the horizontal overflow while sweeping past its edge.

`cellSelection={false}` turns all of it off and gives the cells back plain text
selection.

As with the dock, what is exported is the engine underneath, for a host that
wants to store the preferences between visits or offer its own control over the
same choice:

```ts
import {
  DEFAULT_METRIC_PREFS, METRIC_GROUPS, metricFor, metricLabel,
  normaliseMetricPrefs, setMetricPref,
  type MetricKey, type MetricPrefs,
} from '@alp/data-table'

const prefs = normaliseMetricPrefs(JSON.parse(localStorage.metrics ?? 'null'))
```

`normaliseMetricPrefs` is the guard the component runs on the way in — it drops
an unknown kind, a key that names no metric, and a real metric filed under the
wrong kind — so storage that has gone stale reads as the defaults rather than as
a blank block.

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
| filter chip popup, operator menu, add-filter list, the **Show** panel | `140ms` `dt-menu-in`, plus a `180ms ease` caret |
| filter block face, idle → armed → over → open | `140ms ease` background |
| flow block | `140ms` `dt-sum-in`, `160ms` `dt-sum-out` |
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
| any single-kind selection | reads out in a panel in the toolbar (see **The flow block**) |
| `Enter` in a cell editor | commit the field |
| `Enter` in the draft row | save the record |
| `Escape` (focus inside the table) | back out one level: delete confirmation → open editor → draft row → armed row → cell range |
| `↓` / `Enter` / `Space` on **Add filter** | open the column list; arrows and `Home` / `End` move, `Enter` adds a chip, `Escape` closes |
| inside a filter chip | the operator menu answers the same keys; the value list is multi-select, so `Enter` / `Space` ticks rather than commits; `Escape` closes the chip and goes back to its button |
| `↓` / `Enter` / `Space` on **Show** | open the preferences panel; arrows and `Home` / `End` move within a section, `Tab` crosses to the next, `Enter` / `Space` picks *without* closing, `Escape` closes and goes back to the button |
| `←` / `→` on the rows-per-page slider | one row at a time (`Home` / `End` for the ends) |

Moves are announced through a polite live region. Sorted columns carry
`aria-sort`, the selection boxes `aria-pressed`, the dock's operator and value
lists `aria-selected` (they are `role="listbox"` popups, not toggle buttons —
the add-picker marks the columns already docked `aria-disabled` instead), the
**Show** panel's sections `role="radiogroup"` over `aria-checked` radios (one
pick each, which is what makes them radios rather than a listbox), the chip
buttons `aria-haspopup="dialog"` + `aria-expanded`, the row chevrons
`aria-expanded`, and the current page `aria-current`. Focus rings are
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
npm test           # 226 behaviour tests (vitest + jsdom)
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
- **The status filter became a filter dock.** The prototype spends a
  four-position segmented switch on one column's status; the port gives every
  column a filter and puts them in a strip of their own. See **Filtering**. The
  dropdown the switch first became survives inside it, as the operator picker:
  a button plus a `role="listbox"` popup rather than a native `<select>`, whose
  OS-drawn popup cannot carry the system's flat, square styling.
- **"Reset order" is gone, and the flow block's "Show" selector has its toolbar
  slot.** One button that restored the `columns` prop *and* cleared the sort was
  two undos wearing one label, and both are a keystroke away without it:
  `Alt`+arrows on a column grip move a column, and a third press on a sorted
  header clears the sort. What took the slot is the control that says what a
  cell selection reads as — the only other thing in the toolbar that the block
  beside it speaks for. Nothing restores the initial column order any more.
- **The sum panel reads more than sums.** It began as one question — "what do
  these add up to" — and the answer to that is `null` for a column of statuses.
  Rather than a metric picker the selection has to be matched to, the toolbar
  holds a preference per kind of cell content and the rectangle decides which
  one answers. See **The flow block**.
- **`favouriteSeason` replaces `email` as the fifth column.** Two enum columns
  are what make a two-chip AND worth demonstrating. `email` keeps its place on
  the record, moves into the detail pane, and is still searched.
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
- **The fourth column is `solvedCases`, not `mobile`.** Same position, 150px,
  and still a string field like every other one. The search dropped to name,
  email and address with it — nobody searches for a case count.
- Sorting is still `String(a[key]).localeCompare(...)`, so it is lexicographic
  even for dates — **except** when both values parse as numbers, which now
  compare as numbers. A column of counts that sorts 100 above 20 reads as a
  bug, and it sits right beside a total. Swap in real comparators for the rest
  when you wire real data.

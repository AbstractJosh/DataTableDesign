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
  onExport={(exported) => log('exported', exported.length)}
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
| `metrics` | `MetricPrefsSeed` | Sum, Success rate, Spring rate | What each **kind** of cell content reads as in the flow block — a list per kind (`{ number: ['sum', 'mean'] }`), or a bare key for a list of one. Merged over the defaults; read once, like `rowsPerPage`. See **The flow block**. |
| `onMetricsChange` | `(prefs) => void` | — | Fired when the toolbar's metric-cog panel switches one on or off. Carries the whole record, not the kind that moved. |
| `zebraRows` | `boolean` | `true` | Odd rows on `#f8f4f4`. |
| `locale` | `'en' \| 'tr'` | — | Controlled language. See **Language**. |
| `defaultLocale` | `'en' \| 'tr'` | `en` | The language to open in when uncontrolled. |
| `onLocaleChange` | `(locale) => void` | — | Fired by the switch beside the title. |
| `showLanguageSwitch` | `boolean` | `true` | Hides the switch without taking the header away. |
| `title` | `string` | the language's own | `Data table` / `Veri Tablosu`. Pass one and you own it in every language. |
| `kicker` | `string` | the language's own | `Records / Directory` / `Kayıtlar / Dizin`. |
| `showHeader` | `boolean` | `true` | Drop the title block and stats to embed the table in an existing page frame. |
| `logoSrc` | `string \| null` | the ALP mark | The header's first cell. `null` leaves it empty. |
| `motion` | `'auto' \| 'always' \| 'never'` | `auto` | See **Motion**. |
| `cellSelection` | `boolean` | `true` | Excel-style cell ranges. See **Selecting cells**. |
| `onExport` | `(exported) => void` | — | Fired when an export is **saved**, not when Export is pressed. The component writes the `.csv` itself. See **Exporting**. |
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

## Language

The table ships in **English and Turkish**, and the switch that changes it sits
beside the title — two segments, the Union Flag and the Turkish flag, the one in
force filled in the accent and the other drained to greyscale. It is a
`radiogroup` with a roving tab stop: Tab reaches it once and the arrows move
between the languages.

The flags are drawn, not fetched: `flags.tsx` builds both from primitives in one
60x40 viewBox, so the package still ships one `.js` and one `.css` and neither
flag needs a bundler to know about an image. Know what the marks cost, though — a
flag is a country and not a language, and a reader who does not recognise one has
nothing left to read. They are `aria-hidden`, so the accessible names are
untouched (`English` / `Switch to Türkçe`, and `title` on hover), and
`LOCALE_SHORT` is still exported if you would rather print `EN` / `TR`.

```tsx
<DataTable defaultLocale="tr" />                        // opens in Turkish
<DataTable locale={lang} onLocaleChange={setLang} />    // the host owns it
<DataTable showLanguageSwitch={false} locale="tr" />    // no switch, Turkish
```

### What it changes, and what it must not

The switch changes the **words**. It does not change the **data**.

Every record value stays canonical English: a status is the string `'Success'`
whatever the table reads it as, a season is `'Spring'`, and a date keeps the
`19 August, 2026` format it was stored in. That is not an oversight — it is what
lets everything else go on working:

- the filter dock matches on `'Success'`, so a chip set in English still filters
  a table switched to Turkish;
- a metric key is `rate:status:Success` in both languages, so stored preferences
  survive the switch;
- `PILL_CLASS` paints off the canonical value, so the green pill stays green;
- `onRecordsChange` hands a host the same bytes it was given;
- a `.csv` cell is the record's own value, so a second system can read it back.

What *is* translated is how those values read on screen. `readEnum` and
`readCell` do that at the point of render, and `formatDate` swaps a month it
recognises (`19 August, 2026` → `19 Ağustos, 2026`) and leaves every other date
format exactly as it found it.

Three things follow the language beyond the labels:

- **Collation and case folding.** The sort runs `localeCompare` with the table's
  tag and the search folds with `toLocaleLowerCase`. Turkish needs both:
  `'İSTANBUL'.toLowerCase()` leaves a combining dot behind and stops matching a
  typed `istanbul`.
- **Number formatting.** The flow block's readouts group and point the way the
  table's language does, not the way the host machine does.
- **The export.** A `.csv` saved from a Turkish table is headed `Ad`, `Tarih`,
  `Durum`, and the suggested file name folds the letters rather than dropping
  them (`Çözülen vaka` → `cozulen-vaka`). The cells stay canonical.

### Reading the strings yourself

`STRINGS`, `EN` and `TR` are exported, so a host can label its own chrome to
match: `STRINGS.tr.columns.status` is `'Durum'`. `Strings` is one type covering
both dictionaries, so a string added to English fails to compile until Turkish
names it.

A third language is a new entry in `STRINGS` inside this package rather than a
prop — the type is what makes a missing string an error instead of a blank.

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
survives paging and filtering, drives the *Selected* stat and the Export
button in the footer, and is what `onSelectionChange` reports.

**Cells** are selected as a rectangle, the way a spreadsheet does it — drag
across them, or click one and Shift+click another. It is a view-level thing:
the rectangle is stored as page coordinates, so a search, a sort, a page change
or a reorder drops it rather than dragging a stale selection along. Nothing is
reported to the host; the point of it is the clipboard and the Export button
(see **Exporting**).

| | |
|---|---|
| drag across cells | select the rectangle they span |
| `Shift` + click | extend from the anchor, which does not move |
| `↑` `↓` `←` `→` | move the selection one cell |
| `Shift` + arrow | stretch the rectangle |
| `Home` / `End` | first / last column of the row (`Ctrl` too: first / last cell) |
| `Ctrl`/`Cmd` + `A` | every cell on the page |
| `Ctrl`/`Cmd` + `C` | copy the selection |
| `Escape` | clear it |

**A whole column** is the one selection a rectangle cannot express, because a
rectangle stops at the edge of the page. Triple click a column's label — or
press `Ctrl`/`Cmd` + `Space`, on the header or on any cell in that column — and
the column is taken across *every* page: all 17 rows of it, not the 8 in front
of you. That selection is not stored as corners but as the column's key, so it
is not page-shaped and does not die like a rectangle: turning the page, resizing
it, sorting, and reordering the rows or the columns all leave it exactly as true
as it was. A changed record set does end it — a search, a filter chip, a delete
— and so does starting a rectangle instead, or `Escape`.

The header of a taken column carries a rule under its label, and on the page the
selection's border closes only where the selection really ends: no top edge
except on the first page, no bottom edge except on the last, so an open edge
means there is more of it out of sight. `Ctrl`/`Cmd` + `C` copies all of it.

**Sorting is the caret's job, not the label's.** The two used to be one button;
they were split when the gesture arrived, because three clicks on a sort control
is three sorts — you would watch the table sort ascending and then descending on
the way to a selection that meant neither. So the arrow sorts and the title
selects, and neither one reaches the other: sorting a taken column leaves it
taken, and taking a column leaves the sort exactly where it was. A third click
on the arrow itself, or on the grip, is three presses of that control and no
gesture at all.

The caret button's accessible name stays `Sort by Name`; it carries the shortcut
as `aria-keyshortcuts` rather than reciting a second gesture on all six headers
every time you tab past them.

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
the toolbar, just left of the cog that sets it, saying what they come to. A run of numbers
totals; a run of **Status** cells reads as a rate. It is meant for the **Solved
cases** column, but it is not tied to it — or to any column: what a rectangle
answers is decided by what is *in* it, not by which columns it covers, so it
keeps working when a host swaps the column set out.

**What each kind reads as is a preference, not a mode.** The cog at the right of
the toolbar holds a set of metrics per kind of cell content — any of Sum,
Product, Mean, Median, Highest and Lowest for numbers, and any of the rates for
each enum column's values (Status, Favourite season) — and the *selection*
decides which set is in force. Set numbers to Mean once, and from then on
dragging across counts reads a mean while dragging across statuses reads whatever
Status is set to, with nothing to change in between. The block itself names each
metric it used, as that reading's tag, so the cog says nothing back — it carries
the reading in its accessible name and its tooltip, which track the selection the
same way: counts read Sum, statuses read Success rate, and with nothing selected
it falls back to the numbers set.

**A kind can be asked for several things at once.** Tick Sum, Mean and Highest
under **Numbers** and a run of counts prints all three, side by side in one
block, each with its own tag and separated by a hairline — always in the panel's
own order, never the order they were switched on, so the strip does not
re-arrange itself under the reader. The same goes for the rates: Success rate and
Failed rate together read one column of statuses two ways, each with its own
`(2 of 4)` beside it. Only the kind in the rectangle is ever printed, however
much else is switched on elsewhere, and the one thing the panel refuses is
emptying a kind — the last ticked option of a section is `aria-disabled` and its
press does nothing, because a kind that read as nothing would look exactly like a
rectangle that is not one kind of thing.

The panel opens on the kinds and nothing else — **Numbers**, **Status**,
**Favourite season** — with the one the current selection is being read under
marked in the accent. Press a kind and it expands in place into the metrics it
can be read as, as its own multi-select listbox; a second kind takes the first
one's place, so the panel is never longer than one list. The kinds are the
heavier type of the two, the metrics under them lighter and indented, because the
first question is which kind and the second is how to read it. A press commits
immediately and leaves both the panel and the section open, so one visit can
switch on several metrics across several kinds. `metrics` seeds the record —
partially, naming only the kinds you care about — and `onMetricsChange` reports
the whole of it back.

The rules are a spreadsheet's, and all of them predate the selector. Blank cells
are skipped rather than counted as zero; a rectangle that is not all one kind
takes the panel away entirely, because "what do these come to" has no answer for
a column of names, for a column of dates, or for half counts and half statuses;
and two cells is the floor everywhere — one lone value is not a sum, and "100% of
one cell" is not a rate. A total carries no more decimals than went into it, so
`0.1 + 0.2` reads `0.3`; a mean or a median, being derived rather than one of the
cells, is allowed two places past that; a product too big to read comes out in
exponent form; and a rate is at most one decimal, with the count it was taken
over beside it — `62.5% (5 of 8)`. **Favourite season** is the one exception: its
rates print the percentage alone, because a season's share is a categorisation
rather than a figure the table is read for, and four of them can be on at once,
each dragging its own parenthetical along the strip. Everything is formatted in
the reader's locale. One metric that cannot answer at all — a product that
overflows a double — drops out of the strip and leaves the readings beside it
standing; the block only goes away when nothing answers.

A whole-column selection is read the same way, over every page rather than over
the one on screen, and the panel says so: an **ALL PAGES** tag at the end of the
block, which appears only when there is more than one page to cover. Without it a
total four times the size of the column in front of you would read as a bug. It
is drawn once however many readings are on show — it qualifies the rectangle,
which is the one thing they all have in common.

It sits after the toolbar's flex spacer, so it appears and disappears in the
gap — the buttons beside it never move. It slides in from their side and fades
back out the same way; the exit is held open by a timer, because an unmounted
element cannot animate, and it is skipped entirely when motion is off. The
selector beside it is a fixed width, so the toolbar does not shift when the
reading changes what it is called.

The block is `aria-hidden`, with the readings appended to the live region that
announces the selection instead — in sentence case, and naming the metrics
actually in force: "Mean 42.5.", "Success rate 62.5%.", "Sum 177, Mean 59."

Not supported: Ctrl+click for a second rectangle, more than one column at a
time, pasting, clearing cells, and auto-scrolling the horizontal overflow while
sweeping past its edge.

`cellSelection={false}` turns all of it off and gives the cells back plain text
selection.

As with the dock, what is exported is the engine underneath, for a host that
wants to store the preferences between visits or offer its own control over the
same choice:

```ts
import {
  DEFAULT_METRIC_PREFS, METRIC_GROUPS, metricNames, metricsFor,
  normaliseMetricPrefs, toggleMetricPref,
  type MetricKey, type MetricPrefs,
} from '@alp/data-table'

const prefs = normaliseMetricPrefs(JSON.parse(localStorage.metrics ?? 'null'))
```

`normaliseMetricPrefs` is the guard the component runs on the way in — it drops
an unknown kind, a key that names no metric, and a real metric filed under the
wrong kind, de-duplicates what is left and puts it in the panel's order — so
storage that has gone stale reads as the defaults rather than as a blank block. A
kind left with nothing valid in it, `[]` included, keeps its default, which is
the same rule `toggleMetricPref` enforces when it refuses to untick a kind's last
metric.

## Pagination

The footer's pager is a **sliding window of five numbers** with four jumps
around it:

```
[«] [‹]  3  4  5  6  7  [›] [»]
 │   │                   │   └── last page
 │   │                   └────── next page
 │   └────────────────────────── previous page
 └────────────────────────────── first page
```

The window centres on the current page and slides one step at a time, so the
page you just pressed is still on the strip and the numbers either side of you
are the ones you would reach for next. At the ends it stops rather than centring
— there is no page 0 to pad with — so page 1 shows `1 2 3 4 5` with the current
page at the left edge, and the last page shows the final five with it at the
right. Fewer pages than the window means all of them, not five buttons with two
pointing nowhere.

Why a window at all: the prototype draws one button per page, which is fine for
17 records over 3 pages and unusable at 1000 over 125 — the strip outgrows the
footer, wraps over several lines and pushes Export off the row. The two outer
jumps are the window's other half: once the strip stops showing every page,
"go to the last one" stops being something you can point at.

`pageWindow(page, pageCount, size?)` is exported if you are building your own
pager over the same rule.

The four jumps print `« ‹ › »` and carry their names on `aria-label` (the
glyphs are `aria-hidden`), the numbered buttons are named `Page 3 of 125` rather
than a bare digit, the current one is marked `aria-current="page"`, and the whole
strip is a `<nav>` labelled *Pagination*. Both ends go **disabled together** —
first and previous on page 1, next and last on the final page — rather than
being removed, so the strip never changes width under the pointer.

## Demo data, and larger sets

`createDemoRecords(count?)` builds the placeholder list. It defaults to the
prototype's **17**, and those first 17 are byte-identical whatever you ask for —
they are hand-checked (the Success+Spring and In progress+Summer overlaps exist
so two enum chips in the dock demonstrate an AND instead of emptying the table),
and the behaviour tests are written against them. Records 18 and up are
generated around that fixed head.

```tsx
import { createDemoRecords } from '@alp/data-table'

<DataTable defaultRecords={createDemoRecords(1000)} />
```

It is **deterministic** — no `Math.random` — so the same call twice gives the
same rows: a bug found at row 743 is still at row 743 after a reload, and a sort
or a filter can be checked by eye against a set that does not move underneath
it. The generated rows keep every guarantee the rest of the port leans on:
unique ids continuing the `REC-4820 + 7i` series, unique emails, canonical
`status` and `favouriteSeason` values, dates in the parseable `19 August, 2026`
format, all twelve status×season pairs reachable, and case counts spread wide
enough that a sum, a mean and a median over a run read differently.

The dev harness (`npm run dev`) runs on **1000** and has a `records` control for
17 / 100 / 1000 / 5000. Eight rows over two pages say nothing about how the
pager, a whole-column selection or the search behave at the size this will
actually be used at.

## Exporting

The footer's **Export** button writes a `.csv`. The component builds it and
hands it to the browser — nothing has to be wired up for the button to work.

What it exports is whatever is selected, and the table has three ways of
selecting something, so the narrowest one live wins:

| what is selected | what the file holds |
|---|---|
| a whole column | that column, every row the filters left, across every page |
| a rectangle of cells | those columns, those rows, as they sit on the page |
| checked rows | those records, every column, in the order the columns are on screen |

A cell selection beats the checkboxes because it is the more specific of the
two: someone who dragged across four cells after ticking a row is looking at
the four cells. With nothing selected at all the button is disabled.

Every file opens with a header row of column labels — a paste lands beside the
columns it came from and needs none, but a file is opened later by someone who
was not there. Values are quoted to RFC 4180 (a comma, a quote or a line break
in a value; a leading or trailing space too, which a spreadsheet would
otherwise trim), records are separated by CRLF, and the file is written with a
UTF-8 BOM so Excel on Windows does not mangle non-ASCII text.

**The flow.** Export sits against the pager with nothing between them. Press
it and a solid accent bar grows out of the pager over 480ms, shouldering Export
leftwards as it fills — the bar's *width* is the progress, so there is no track
for it to fill inside; the bar is the number. At full extent the slab wipes off
left to right, uncovering a box holding a suggested file name, focused with the
suggestion selected.

Type over it and press Enter — or click the tick — to save. The cross beside
the tick discards the export, and so does Escape; either way the strip slides
back to nothing and Export returns to the pager with the selection untouched,
ready to be pressed again. The `.csv` is shown beside the box rather than typed
into it, and a `.csv` typed in anyway is folded back out, so the file never
lands as `report.csv.csv`.

The pager never moves through any of this: the bar opens leftwards into Export,
not rightwards into the pager. With `motion="never"` (or a reduced-motion OS
setting) the twelve steps still play — progress is information, not decoration
— but the tween between them, the wipe, and the slide back out are dropped.

The file is built at the press, not at the save: the selection is free to move
while the bar fills, and what Export exports is what was selected when Export
was pressed.

`onExport` fires when the file is **saved**, with the records the exported cells
came from. It is a notification, not the implementation — use it to log the
export or mark the records, not to write the file:

```tsx
<DataTable onExport={(exported) => track('csv_export', { rows: exported.length })} />
```

The pieces are exported for a host that wants to build the same file itself —
`planCsv`, `csvCell`, `toCsv`, `csvFileName`, `defaultExportName` and
`downloadCsv`, over an `ExportPlan` of `{ source, columns, records }`.

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
| filter chip popup, operator menu, add-filter list, the metric-cog panel | `140ms` `dt-menu-in`, plus a `180ms ease` caret — the cog turns 60° and each kind's caret flips on the same clock |
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
| click a column's caret | sort by it — ascending, descending, unsorted |
| arrows / `Shift`+arrows in a cell | move / stretch the cell range (see **Selecting cells**) |
| `Ctrl`/`Cmd` + `A` / `C` in a cell | select the page / copy the selection |
| `Ctrl`/`Cmd` + `Space` (cell or header) | select that whole column, every page |
| any single-kind selection | reads out in a panel in the toolbar (see **The flow block**) |
| `Enter` in a cell editor | commit the field |
| `Enter` in the draft row | save the record |
| `Escape` (focus inside the table) | back out one level: delete confirmation → open editor → draft row → armed row → cell range |
| `↓` / `Enter` / `Space` on **Add filter** | open the column list; arrows and `Home` / `End` move, `Enter` adds a chip, `Escape` closes |
| inside a filter chip | the operator menu answers the same keys; the value list is multi-select, so `Enter` / `Space` ticks rather than commits; `Escape` closes the chip and goes back to its button |
| `↓` / `Enter` / `Space` on the metric cog | open the preferences panel, on the kind in force |
| on a kind | `Enter` / `Space` expands it, `↓` goes in to its first ticked metric, `↑` shuts it again, `Tab` crosses to the next kind |
| inside a kind | arrows and `Home` / `End` move without committing, `Enter` / `Space` ticks or unticks *without* closing the panel or the section, `Tab` leaves for the next kind, `Escape` closes the panel and goes back to the cog |
| `←` / `→` on the rows-per-page slider | one row at a time (`Home` / `End` for the ends) |

Moves are announced through a polite live region. Sorted columns carry
`aria-sort`, the selection boxes `aria-pressed`, the dock's operator and value
lists `aria-selected` (they are `role="listbox"` popups, not toggle buttons —
the add-picker marks the columns already docked `aria-disabled` instead), the
metric cog's kinds `aria-expanded` buttons over `role="listbox"
aria-multiselectable` sections of `aria-selected` options (the dock's own
multi-select shape, since a kind holds as many metrics as the reader ticks; the
last one on is `aria-disabled`, and a shut section is unmounted, so it has no
option in the tree and no tab stop) under a button named "Showing <metrics>. Set
what each kind of cell selection reads as." — an icon-only control has to say
both halves — the chip buttons
`aria-haspopup="dialog"` + `aria-expanded`, the row chevrons
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
- **Taking a whole column is new** — triple click a header label, or
  `Ctrl`/`Cmd` + `Space` — and is the one selection the rectangle below cannot
  express, since it runs past the end of the page. See **Selecting cells**.
- **Cell-range selection is new**, and is what needed the row body free. See
  **Selecting cells**.
- **The status filter became a filter dock.** The prototype spends a
  four-position segmented switch on one column's status; the port gives every
  column a filter and puts them in a strip of their own. See **Filtering**. The
  dropdown the switch first became survives inside it, as the operator picker:
  a button plus a `role="listbox"` popup rather than a native `<select>`, whose
  OS-drawn popup cannot carry the system's flat, square styling.
- **"Reset order" is gone, and the flow block's metric cog has its toolbar
  slot.** One button that restored the `columns` prop *and* cleared the sort was
  two undos wearing one label, and both are a keystroke away without it:
  `Alt`+arrows on a column grip move a column, and a third press on a sorted
  header clears the sort. What took the slot is the control that says what a
  cell selection reads as — the only other thing in the toolbar that the block
  beside it speaks for. It is a cog, and 42px square: the words it first carried
  were the block's own tag repeated, and what is left — "set how these read" —
  is one glyph, which pairs it with the New record square at the end of the
  toolbar. Nothing restores the initial column order any more.
- **Export sits in the footer, left of the pager.** The prototype puts it in the
  toolbar. Everything else up there changes what the table shows — the search,
  the rows-per-page slider, the metric cog, New record — while Export does
  something with rows already chosen, which is what the footer is about:
  "Showing 1–8 of 17 entries", and the way to the rest of them. It keeps the
  prototype's enabled-only-with-a-selection behaviour and drops to the pager's
  34px rank so the bottom strip reads as one row of controls.
- **Archive is gone, and Export does something.** Both were stubs in the
  prototype — two labels with no handlers. Rather than ship a second one, the
  port drops Archive (a host that needs it has `onSelectionChange` and its own
  button) and spends the slot it vacated on the export the other label was
  promising: a progress bar that becomes the box naming the file. See
  **Exporting**.
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

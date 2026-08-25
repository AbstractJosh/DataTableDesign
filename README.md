# Data Table

A design handoff for a records/directory screen, and the React component built
from it.

The screen is a data table: search it, filter it, sort it, tick rows, open a row
for its detail, edit a cell in place, drag rows and columns into a different
order, select a rectangle of cells and read what they come to, export the
selection as a `.csv`, and page through the rest. It is built on the
**Modernist** design system — flat, Archivo, zero corner radius, 2px rules —
with a navy `#1d2d46` accent.

```
design_handoff_data_table/   the design: the written spec, the prototype, the design system
react/                       the port: @alp/data-table, its demo, and a SQLite dev server
react/PARITY.md              the ledger the port was checked against, item by item
```

The handoff is the source of truth for **what it should look like**;
`react/README.md` is the reference for **how to use the component**. This file
is the map between them.

---

## Quick start

Developed on Node 24. The dev server runs under bare `node server/index.ts`, so
it needs a Node with unflagged TypeScript type stripping and the built-in
`node:sqlite` — 22.18+ or 24+. Nothing in the published package needs either.

```
cd react
npm install
npm run dev
```

That starts two things — the API on `:5174` and the demo on `:5173` — and opens
on a table of 100,000 records. The database builds itself on first run, which
takes about three seconds.

```
npm test         # 635 tests
npm run build    # dist/index.js + dist/data-table.css + dist/fonts
```

---

## What it does

**Finding rows.** A search box over name, email and address. A filter *dock*:
drag a column header into the strip and it becomes a chip with its own operator
— `is`, `contains`, `before`, `>=`, whichever the column's content supports —
and the chips are ANDed. Click a header to sort, click again to reverse, a third
time to clear it.

**Working with rows.** Tick them individually or a page at a time. Expand one
for a detail pane that measures its own height on the way open. Edit a cell by
clicking it. Add a record through a draft row that sits at the top until it is
saved or abandoned. Delete with the confirmation stepping into the row itself
rather than into a modal.

**Reordering.** Rows and columns both drag, from their `⠿` grips only, and both
also move from the keyboard — `Alt` + arrows on a focused grip — which the
prototype could not do. A landed reorder plays a FLIP slide.

**Cells, not just rows.** Click and drag across cells for an Excel-style
rectangle, `Ctrl`/`Cmd` + `C` to copy it — tab-separated text and an HTML
flavour, so it pastes into Sheets or Excel as a real table. Triple-click a
column header to take that whole column across every page. Whatever is
selected, a block beside
the toolbar says what it reads as — a sum for numbers, a range for dates, a
count per value for statuses — and a cog decides which metric answers for each
kind of content.

**Getting data out.** Export writes a `.csv` of the selection: a progress bar
that becomes a box naming the file, with the name editable before it saves.

**Two languages.** English and Turkish, from a switch beside the title. Turkish
is the reason case folding is done with a locale rather than `toLowerCase()` —
a dotted capital `İ` folds to something a typed `i` stops matching otherwise.

The screen is keyboard-navigable throughout, honours `prefers-reduced-motion` by
default, and announces reorders and page changes through a live region.

---

## How it is built

`@alp/data-table` is a single React component with **zero runtime
dependencies** — `react` and `react-dom` are peers and nothing else is. No table
library, no drag library, no date library, no CSS framework. That constraint is
deliberate and it is why the repository has its own `sort.ts`, `filters.ts`,
`tableDate.ts` and `cellRange.ts`.

### Two ways to give it rows

```tsx
// an array: the component holds every record
<DataTable records={records} onRecordsChange={setRecords} />

// a query: the component asks for the page it is drawing
const source = createRemoteSource(createRecordsClient({ baseUrl: '/api' }))
<DataTable source={source} />
```

The **array** path is the simple one and the original one: the component holds
every record and derives what to draw in a fixed order — filter, then sort, then
paginate, then slice. It is synchronous, it runs during render, and it is what
almost every test in the repo exercises.

The **source** path exists because that has a size limit, and the limit is lower
than it looks: 100,000 records is 39.7 MB of JSON before a single row is drawn.
A `RecordSource` is the component asking for the page it is about to draw
instead of holding what it might. Six questions — the page, a whole column, the
ticked rows, a collection, a fresh id, and an applied change — each one
something the screen actually does. The derive order is identical; what changes
is who runs it.

`arraySource` is the in-browser implementation and doubles as the specification:
the SQLite one in `server/` is run against it question for question, and
`server/endToEnd.test.tsx` renders the real component over a real socket into a
real DOM to check they agree.

### Long pages render a window

Page size is a control with no ceiling, so a page can be thousands of rows.
Above 80 the table renders what is near the viewport plus twelve rows of
overscan and pads the rest with two spacer `<tbody>`s of the right height — the
scrollbar keeps meaning what it means. It stands down below the threshold, while
a detail pane is open, and wherever a row measures zero.

### The dev server

`react/server/` is a local SQLite database and a small HTTP API in front of it —
**dev tooling, not part of the published package**. It exists so the demo runs
on stored records, and so the windowed path has something real to be windowed
against. Every conversion the component does in JavaScript (date parsing, case
folding, numeric coercion) is done once at write time by *those same functions*
and stored beside the row, so the server and the browser cannot quietly
disagree. Row order is a `REAL` column, so dragging a row from the bottom to the
top is one write rather than a hundred thousand.

See `react/server/README.md` for the routes and the schema.

### Build output

`npm run build` runs a Vite library build:

| | |
|---|---|
| `dist/index.js` | ES module, `'use client'` banner, React left external |
| `dist/data-table.css` | one stylesheet, not split per chunk |
| `dist/fonts/` | Archivo woff2 + `fonts.css`, an opt-in second entry point |
| `dist/index.d.ts` | types, emitted by `vite-plugin-dts` |

Fonts are copied rather than bundled so a host that already ships Archivo is not
made to download it again. `files` in `package.json` ships `dist` only.

### Tests

635 tests under Vitest, in one run. The component's tests use jsdom; the
server's live beside it and declare `@vitest-environment node`, because
`node:sqlite` has no business being loaded into a fake DOM. `npm run typecheck`
checks the package and the server as two projects.

---

## Design constraints worth knowing before changing anything

- **Radius is 0 everywhere, and structural borders are 2px** (1px `#d7d3d3` only
  for row dividers). Flat only — bevels, gradients and drop shadows on the table
  header were tried during design and rejected.
- **The accent is navy `#1d2d46`, not the design system's red.** Red is reserved
  for destructive and negative: the Failed pill, delete, link hover. Green
  `#2f7d4f` is a project addition for Success.
- **Class names are `dt-` prefixed.** The prototype styled bare `table` / `td` /
  `input` selectors, which would leak into a host app.
- **Records are immutable.** Every change produces a new array so a host can
  control the list.

`design_handoff_data_table/README.md` has the exact colors, px values and
typography. Don't re-derive them from the prototype's inline styles.

---

## Where to read what

| | |
|---|---|
| Using the component | `react/README.md` — props, filtering, selection, exporting, styling, a11y |
| The design spec | `design_handoff_data_table/README.md` |
| The design system | `design_handoff_data_table/_ds/modernist-*/readme.md` |
| The API and schema | `react/server/README.md` |
| What was ported, and what was changed on purpose | `react/PARITY.md` |

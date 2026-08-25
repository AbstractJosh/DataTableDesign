# The records server

A local SQLite database and a small HTTP API in front of it, so the demo screen
runs on stored records instead of an array built in the browser.

It is **dev tooling**, not part of the published package. `files` in
`package.json` ships `dist` only.

```
npm run dev          # this, plus Vite, together
npm run dev:api      # just this, on http://127.0.0.1:5174
npm run db:seed      # rebuild the database from the generator
npm run db:seed -- 250000
```

The database is `server/records.db`, git-ignored, and built on first run from
`createDemoRecords` — **100,000 rows**, taking about three seconds and 66 MB.
The first seventeen are the hand-checked records every behaviour test in the
repo is written against, unchanged; the rest are generated around that fixed
head, deterministically, so row 743 is the same row after a reload.

Loopback only, and unauthenticated. It has no business being reachable from
anywhere else.

---

## Why it exists

Because a table that can only be handed all of its rows has a size limit, and
the limit is lower than it looks: 100,000 records is **39.7 MB** of JSON, 3.3 MB
gzipped, about 1.6 seconds over loopback — before a single row is drawn, and
again on every reload.

So there are two read endpoints, and the demo can switch between them:

| | |
|---|---|
| `GET /api/records/all` | the whole set, in table order |
| `GET /api/records` | one window, filtered and sorted in SQL, plus the matching total |

The second is what the table runs on now, through `createRemoteSource` in
`src/lib/recordsApi.ts` — a `RecordSource`, which is the component's way of
asking for the page it is about to draw rather than holding what it might. The
first is kept, and kept working, because it is what most hosts will do and
because putting the two side by side on one screen is what makes the difference
legible.

Every question the table can ask has an endpoint, and the list is short because
the questions were chosen to be answerable:

| the table needs | it asks |
|---|---|
| the rows on screen, both header counts | `GET /api/records` |
| a whole column, across every page | `GET /api/records/column` |
| the ticked rows, for an export | `POST /api/records/by-ids` |
| an id for a new record | `GET /api/records/next-id` |
| an edit, a delete, a new row, a drag | `POST /api/records/sync` |

Note what is **not** there: nothing asks for every record in order to count
them, to read a column, or to write a `.csv` of one. A whole column of 100,000
names is one request returning strings — a couple of megabytes rather than
forty — because the other eleven fields were never going to be read.

---

## Routes

```
GET    /api/health                        { ok, rows }
GET    /api/records/all?limit=            { records, total }
GET    /api/records?offset&limit&q&sort&dir&locale&where
                                          { rows, total, grandTotal, offset, limit }
GET    /api/records/column?key&<filter>   { values }   one column, every matching row
GET    /api/records/next-id               { id }
POST   /api/records/by-ids                { ids } -> { records }
GET    /api/records/:id                   { record }        404 if absent
POST   /api/records                       { record, afterId }
PATCH  /api/records/:id                   a whole record
DELETE /api/records/:id                   204
POST   /api/records/sync                  { added, updated, removed, moved, dragged, order }
POST   /api/records/reseed                { count }         destructive
```

`grandTotal` is the row count before any filter — the header's first stat, and
the one number a windowed client cannot work out for itself, since it has never
seen the unfiltered set.

Window parameters:

| | |
|---|---|
| `offset` / `limit` | `limit` defaults to 100 and is capped at 5000 — the window endpoint is not a download |
| `q` | the toolbar search box, verbatim; folded and trimmed here |
| `sort` / `dir` | a column key and `asc` / `desc`. An unknown column is a **400**, not a silent fall back to unsorted |
| `locale` | `en` or `tr`. Decides case folding, never which records exist |
| `where` | a JSON array of `FilterCondition` — the dock's chips, ANDed |

Responses carry the twelve public fields of a `DataTableRecord` and nothing
else. The derived columns below are the server's own.

Whole-set responses are gzipped when the client will take them, streamed rather
than `gzipSync` so a 40 MB body does not hold the event loop for a second.

The client for all of this is `src/lib/recordsApi.ts`, exported from the package
as `createRecordsClient` / `diffRecords`.

---

## What is stored, and why it is more than twelve columns

`DataTable` filters in JavaScript: `Number(cell)` for a count,
`parseTableDate(cell)` for a date, `cell.trim().toLowerCase()` for text. Asking
SQLite to reproduce that per row per query means a full scan that reparses
`19 August, 2026` a hundred thousand times — and it means SQLite's `lower()`,
which is ASCII-only and would quietly disagree with JavaScript's.

So every conversion is done **once, in JavaScript, at write time, by the
functions the component itself uses**, and stored beside the row:

| column | is |
|---|---|
| `ord` | the row's place in the table's order — see below |
| `date_ms` | `parseTableDate(date)`, `NULL` when it does not parse |
| `solved_num` | `Number(solvedCases)` when finite, else `NULL` |
| `name_lc`, `address_lc` | `norm()` from `filters.ts` — trimmed, plainly folded |
| `search_lc`, `search_lc_tr` | `` `${name} ${email} ${address}` `` folded, untrimmed |

The two search columns are the only thing folded twice, and following the
component rather than assuming is the trick: the text *operators* fold plainly
on both sides, with no locale, so one column is right for both languages. The
toolbar *search* does not — it folds with the table's own language tag, because
a dotted capital I folds to an i with a combining dot under the default rules
and stops matching a typed `i`. One extra column, and the search box finds the
same rows the client-side one does in Turkish.

### Position is a float

Rows are drag-reordered and that order is data. Storing it as 1, 2, 3 means a
row dragged from the bottom to the top renumbers every row it passed — a hundred
thousand writes for one drag. `ord` is a `REAL`, so a row dropped between two
others takes the midpoint of theirs and nothing else is touched.

Halving the same gap runs out of double precision after about fifty drops into
it; `ordFor` notices and renumbers the table 1..n instead. That is the expensive
operation the scheme exists to avoid, and it now happens once every fifty drags
into one spot rather than on every drag anywhere.

---

## Writes, from either side

A windowed table says what it **did** — `{ kind: 'update', record }`,
`{ kind: 'delete', ids }`, `{ kind: 'create', record }`, `{ kind: 'move',
fromId, toId }` — and `createRemoteSource` turns each into one `POST
/api/records/sync`. That is the easy direction, and it is the one the demo uses.

The other direction is what a host with an *array* has to do, and it is harder:
`onRecordsChange` hands it the whole next list, so it has to work out what
changed. Posting the array back would be 40 MB per rename. `diffRecords`
compares the two and sends only the difference — one record, or one moved id.

A reorder is the awkward case there, handled in two tiers. `moveRow` splices one
element out and back in, so a drag is always exactly that; `detectMove`
recognises it and sends `{ id, afterId }`, one `UPDATE` of one row. Anything it
cannot name falls back to sending the whole id order, because a wrong guess
about position is a table that reorders itself on reload and a slow correct
answer is not.

`store.test.ts` asserts the property that matters for that path: for a battery
of mutations, `applySync(db, diffRecords(prev, next))` leaves the database
holding exactly `next`.

### A drag is two ids

A windowed client holds one page, so for a row dropped *upwards* it often cannot
see the row that would be the anchor — it is on the page before. So the table
sends `dragged: [{ fromId, toId }]` and `moveRelative` works out which way it
went: **down lands after the target, up lands before it.** That asymmetry is
what an array splice has always done, and the two implementations reach it from
completely different places — a splice against an index, a midpoint between two
floats. `source.test.ts` runs both over the same records and compares, because
if they ever disagree the table silently reorders itself on reload.

---

## The tests

```
npm test
```

- **`query.test.ts`** — the differential test, and the reason to trust any of
  this. Nothing in it asserts that a filter returns "the rows it should"; every
  case runs the component's own `matchesAll` and `compareCells` over the same
  400 records and asserts the database agrees, id for id, in order. Forty-odd
  filter cases, every column sorted both ways, windows walked end to end.
- **`source.test.ts`** — the same trick one layer up: `createRemoteSource` over
  a real socket against `arraySource` over the same records, question for
  question, including every shape of write. The array path is the specification
  and this is what keeps it that way.
- **`store.test.ts`** — writes, position, and the diff round trip above.
- **`http.test.ts`** — the routes over a real socket on an ephemeral port.
- **`modules.test.ts`** — the constraint below, as a test.

## The loading constraint

The server runs under bare `node server/index.ts`. Node strips the types; it
does **not** resolve extensionless import specifiers. So a `src/lib` module is
reachable from here only if its own *runtime* import list is empty, and the four
that are reachable — `demoData.ts`, `i18n.ts`, `tableDate.ts`, `types.ts`, plus
`sort.ts` for the tests — are exactly those four by design.

That is why `parseTableDate` lives in `tableDate.ts` rather than in
`filters.ts`, which imports `i18n.ts` at runtime; `filters.ts` re-exports it, so
nothing that used it had to move. It is also why `query.ts` keeps its own copy
of the column-type table, with a test asserting it equals `COLUMN_TYPES`.

`modules.test.ts` spawns a fresh Node process per module and asserts each comes
up — and asserts that `filters.ts` still does not, so that if the constraint
ever lifts, the workarounds can be deleted and the failure message says so.

---

## Known divergence: collation

`compareCells` falls back to `String.localeCompare`, which is ICU collation — in
Turkish, c-cedilla sorts after `c` rather than folding into it. SQLite has no
equivalent it can reach without a registered collation, and `node:sqlite` does
not expose one. `ORDER BY` here is byte order over the pre-folded column.

For the ASCII the demo data is made of the two agree exactly — `query.test.ts`
checks all six columns in both directions and they match — and they will diverge
on accented letters.

The table now **does** take its ordering from this file, so this is a live
limitation rather than a future one. It costs nothing on the demo data and would
show up as a name in the wrong place on a set with accented letters in it. The
fix is a precomputed rank column per sortable column per locale, written at seed
time by `compareCells` itself and reranked on every write — which is the price,
and the reason it is not here until something needs it.

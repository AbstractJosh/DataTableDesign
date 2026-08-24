/**
 * The prototype's 17 placeholder records: one hand-written record plus 16
 * generated ones with ids REC-4820, REC-4827, … (step 7).
 *
 * PORT ADDITION: and as many more as a caller asks for. `createDemoRecords(1000)`
 * is what the dev harness runs on — eight rows over two pages tell you nothing
 * about how the pager, the whole-column selection or the search behave against a
 * real set, and every one of those has a shape that only appears at scale: 125
 * pages will not fit in the footer, and a whole-column copy is a thousand cells.
 *
 * The **first 17 are untouched** whatever the count. They are hand-checked — the
 * Success+Spring and In progress+Summer overlaps below exist so two enum chips
 * in the dock demonstrate an AND rather than emptying the table — and every
 * behaviour test in this repo is written against them. Records 18 and up are
 * generated around that fixed head.
 *
 * Deterministic, and deliberately so: no `Math.random`. The same call twice
 * gives the same thousand rows, so a bug found at row 743 is still at row 743
 * after a reload, and a sort or a filter can be checked by eye against a set
 * that does not move underneath it.
 *
 * Swap in the real API and keep the derive order in `DataTable`.
 */
import type { DataTableRecord, RecordStatus, Season } from './types'

const NAMES = [
  'Ethan Noah', 'Amelia Hart', 'Marcus Reed', 'Priya Anand', 'Sofia Lindqvist',
  'Daniel Osei', 'Clara Whitfield', 'Tomas Berger', 'Naomi Castillo', 'Owen Fletcher',
  'Hana Sato', 'Julien Moreau', 'Ruth Abebe', 'Victor Ilyin', 'Mia Donnelly',
  'Samir Haddad',
]

const STATUS: RecordStatus[] = [
  'Success', 'In progress', 'Failed', 'Success', 'In progress', 'Success', 'Failed',
  'In progress', 'Success', 'In progress', 'Success', 'Failed', 'In progress',
  'Success', 'In progress', 'Success',
]

/**
 * PORT ADDITION: written out per record rather than derived from the index, the
 * same way STATUS is, so the overlap with STATUS is reviewable by eye. Two enum
 * chips in the dock only demonstrate an AND if the pairs actually overlap:
 * Success+Spring lands three records (Ethan Noah, Naomi Castillo, Victor Ilyin)
 * and In progress+Summer another three, so combining two chips narrows the set
 * instead of emptying it.
 */
const SEASON: Season[] = [
  'Spring', 'Summer', 'Autumn', 'Winter', 'Spring', 'Summer', 'Winter',
  'Autumn', 'Spring', 'Summer', 'Autumn', 'Spring', 'Winter',
  'Spring', 'Summer', 'Winter',
]

const CITIES = [
  '132 My Street, Kingston, New York 12401',
  '41 Halsey Row, Newark, New Jersey 07102',
  '8 Wren Court, Brookline, Massachusetts 02445',
  '260 Bay Ridge, Brooklyn, New York 11209',
  '17 Foundry Lane, Providence, Rhode Island 02903',
  '903 Mesa Drive, Austin, Texas 78701',
  '55 Kilburn Place, Chicago, Illinois 60614',
  '19 Ashfield Way, Portland, Oregon 97205',
]

/** Spread wide enough that a sum over a few rows is worth reading. */
const SOLVED = [
  42, 7, 213, 96, 18, 154, 3, 77, 261, 31, 108, 65, 12, 189, 54, 23,
]

const PLANS = ['Standard', 'Professional', 'Exclusive', 'Free']
const DATES = ['04 March, 2026', '10 March, 2026', '18 March, 2026', '02 April, 2026']
const ACTIVITY = ['2 hours ago', 'Yesterday', '3 days ago', 'Last week']

const NOTE =
  'Imported from the March intake batch. Verification pending on the billing address; ' +
  'contact prefers email over phone.'

/* ---- the pools the generated tail draws on ------------------------- *
 * Sized so the pairs do not repeat inside a thousand rows. 40 and 37 are
 * coprime, so `(i % 40, i % 37)` is a distinct pair for 1480 consecutive
 * indices — a thousand rows of "Ethan Noah" over and over would make the sort
 * and the search untestable by eye, which is the whole point of having them.
 * ------------------------------------------------------------------- */

const FIRST_NAMES = [
  'Ethan', 'Amelia', 'Marcus', 'Priya', 'Sofia', 'Daniel', 'Clara', 'Tomas',
  'Naomi', 'Owen', 'Hana', 'Julien', 'Ruth', 'Victor', 'Mia', 'Samir',
  'Elena', 'Kwame', 'Ingrid', 'Rafael', 'Yuki', 'Nadia', 'Oscar', 'Leila',
  'Anton', 'Beatriz', 'Idris', 'Freya', 'Mateo', 'Zara', 'Henrik', 'Aisha',
  'Lucas', 'Mira', 'Pavel', 'Rosa', 'Kenji', 'Talia', 'Gustav', 'Nour',
]

const LAST_NAMES = [
  'Noah', 'Hart', 'Reed', 'Anand', 'Lindqvist', 'Osei', 'Whitfield', 'Berger',
  'Castillo', 'Fletcher', 'Sato', 'Moreau', 'Abebe', 'Ilyin', 'Donnelly',
  'Haddad', 'Vargas', 'Okonkwo', 'Bergstrom', 'Kaur', 'Tanaka', 'Rahman',
  'Lindgren', 'Farouk', 'Novak', 'Mendes', 'Bello', 'Sorensen', 'Duarte',
  'Nasser', 'Larsen', 'Achebe', 'Rossi', 'Petrova', 'Kovac', 'Silva', 'Mori',
]

const STREETS = [
  'Halsey Row', 'Wren Court', 'Bay Ridge', 'Foundry Lane', 'Mesa Drive',
  'Kilburn Place', 'Ashfield Way', 'Lantern Street', 'Quarry Hill', 'Verge Road',
  'Marlowe Crescent', 'Sable Walk', 'Corbin Yard',
]

const PLACES = [
  'Kingston, New York 12401', 'Newark, New Jersey 07102',
  'Brookline, Massachusetts 02445', 'Brooklyn, New York 11209',
  'Providence, Rhode Island 02903', 'Austin, Texas 78701',
  'Chicago, Illinois 60614', 'Portland, Oregon 97205',
  'Boulder, Colorado 80302', 'Savannah, Georgia 31401',
  'Tacoma, Washington 98402',
]

/** English, because the record's `date` is stored English — see `i18n.ts`. */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')

/**
 * One generated record, from its index alone.
 *
 * Every field is a different stride through its pool, and the strides are
 * coprime with the pool lengths so no two columns fall into step with each
 * other. Statuses cycling 3 and seasons cycling 4 would otherwise pair up
 * identically on every row and the dock's two-chip AND would be either the
 * whole set or empty — which is exactly the case the hand-written head exists
 * to avoid, and it has to hold in the tail too.
 *
 * Dates spread over two years, 28 days at most so no month rolls over
 * (`parseTableDate` rejects `31 February` rather than shifting it), and in the
 * record's own `'19 August, 2026'` format — the one the filters parse and the
 * language switch reads a month out of.
 */
function generated(i: number): DataTableRecord {
  const name = FIRST_NAMES[i % FIRST_NAMES.length] + ' ' + LAST_NAMES[i % LAST_NAMES.length]
  const day = String(1 + ((i * 11) % 28)).padStart(2, '0')
  const month = MONTH_NAMES[(i * 5) % 12]
  const year = 2025 + ((i * 3) % 2)
  const owner =
    FIRST_NAMES[(i * 13) % FIRST_NAMES.length] + ' ' + LAST_NAMES[(i * 17) % LAST_NAMES.length]

  return {
    id: 'REC-' + (4820 + i * 7),
    name,
    date: day + ' ' + month + ', ' + year,
    status: STATUS[(i * 5) % STATUS.length],
    // Wide and uneven: a sum, a mean and a median over a run of these should
    // each land somewhere different, or the flow block's metrics are
    // indistinguishable in the demo.
    solvedCases: String(((i * 37) % 300) + (i % 7)),
    favouriteSeason: SEASON[(i * 7) % SEASON.length],
    address:
      1 + ((i * 23) % 900) + ' ' + STREETS[i % STREETS.length] + ', ' +
      PLACES[(i * 3) % PLACES.length],
    // The index keeps it unique where two people share a name past row 1480.
    email: slug(name) + '.' + i + '@xyz.com',
    owner,
    activity: ACTIVITY[i % ACTIVITY.length],
    plan: PLANS[(i * 3) % PLANS.length],
    note: NOTE,
  }
}

/** The hand-written head: one record plus the prototype's sixteen. */
const FIXED = 17

/**
 * Built fresh on each call so a caller can reset to a pristine list.
 *
 * `count` is the total, head included, and defaults to the prototype's 17 — so
 * every existing caller, and every test written against those records, is
 * unaffected. Ask for fewer than 17 and you get the first `count` of the head;
 * ask for more and the head is followed by generated rows.
 */
export function createDemoRecords(count: number = FIXED): DataTableRecord[] {
  const first: DataTableRecord = {
    id: 'REC-4813',
    name: 'Tunc Yanik',
    date: '19 August, 2026',
    status: 'Success',
    solvedCases: '128',
    favouriteSeason: 'Summer',
    address: '456 Boss Street, Yenimahalle, Eskisehir 15305',
    email: 'tyanik@yopmail.com',
    owner: 'Amelia Hart',
    activity: '2 hours ago',
    plan: 'Exclusive',
    note: NOTE,
  }

  const head: DataTableRecord[] = [first].concat(
    NAMES.map((name, i) => ({
      id: 'REC-' + (4820 + i * 7),
      name,
      date: DATES[i % 4],
      status: STATUS[i],
      solvedCases: String(SOLVED[i]),
      favouriteSeason: SEASON[i],
      address: CITIES[i % CITIES.length],
      email: slug(name) + '@xyz.com',
      owner: NAMES[(i + 5) % NAMES.length],
      activity: ACTIVITY[i % 4],
      plan: PLANS[i % PLANS.length],
      note: NOTE,
    })),
  )

  const total = Math.max(0, Math.floor(count))
  if (total <= FIXED) return head.slice(0, total)

  const tail: DataTableRecord[] = []
  // From `NAMES.length`, not from 17: `generated(16)` is the first id the head
  // has not spent, so the REC-4820 + 7i series carries on unbroken and `nextId`
  // in `DataTable` still lands past the end of it.
  for (let i = NAMES.length; i < total - 1; i += 1) tail.push(generated(i))
  return head.concat(tail)
}

export const DEMO_RECORDS: DataTableRecord[] = createDemoRecords()

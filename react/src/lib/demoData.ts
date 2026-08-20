/**
 * The prototype's 17 placeholder records: one hand-written record plus 16
 * generated ones with ids REC-4820, REC-4827, … (step 7).
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

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')

/** Built fresh on each call so a caller can reset to a pristine list. */
export function createDemoRecords(): DataTableRecord[] {
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

  return [first].concat(
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
}

export const DEMO_RECORDS: DataTableRecord[] = createDemoRecords()

/**
 * The prototype's 17 placeholder records: one hand-written record plus 16
 * generated ones with ids REC-4820, REC-4827, … (step 7).
 *
 * Swap in the real API and keep the derive order in `DataTable`.
 */
import type { DataTableRecord, RecordStatus } from './types'

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
    mobile: '+1 111 111 1111',
    email: 'tyanik@yopmail.com',
    address: '456 Boss Street, Yenimahalle, Eskisehir 15305',
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
      mobile: '+1 ' + (200 + i) + ' 0' + (40 + i) + ' ' + (1000 + i * 37),
      email: slug(name) + '@xyz.com',
      address: CITIES[i % CITIES.length],
      owner: NAMES[(i + 5) % NAMES.length],
      activity: ACTIVITY[i % 4],
      plan: PLANS[i % PLANS.length],
      note: NOTE,
    })),
  )
}

export const DEMO_RECORDS: DataTableRecord[] = createDemoRecords()

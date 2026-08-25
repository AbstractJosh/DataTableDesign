/**
 * @vitest-environment node
 *
 * Writes, and the one thing about them that is not obvious: position.
 *
 * Reading a row back is hard to get wrong. Keeping a hundred thousand rows in
 * the order someone dragged them into, without rewriting all of them every
 * time, is the part with a scheme behind it — so most of this file is about
 * `ord`, and in particular about the case the scheme is designed to fail at.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { ensureSchema, insertAll, openDatabase } from './db.ts'
import { EMPTY_QUERY, queryRecords } from './query.ts'
import {
  applySync,
  deleteRecord,
  getRecord,
  insertRecord,
  listRecords,
  moveRecord,
  rebalance,
  reorderAll,
  updateRecord,
} from './store.ts'
import { createDemoRecords } from '../src/lib/demoData'
import { diffRecords } from '../src/lib/recordsApi'
import type { DataTableRecord } from '../src/lib/types'

const SEED = createDemoRecords(12)

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
  ensureSchema(db)
  insertAll(db, SEED)
})

const order = () => listRecords(db).map((r) => r.id)

const ords = () =>
  (db.prepare('SELECT "id", ord FROM records ORDER BY ord').all() as {
    id: string
    ord: number
  }[])

const clone = (record: DataTableRecord, over: Partial<DataTableRecord>) => ({
  ...record,
  ...over,
})

describe('reading', () => {
  it('hands rows back in the table order they were written in', () => {
    expect(order()).toEqual(SEED.map((r) => r.id))
  })

  it('takes a prefix when asked for a limit', () => {
    expect(listRecords(db, 3).map((r) => r.id)).toEqual(SEED.slice(0, 3).map((r) => r.id))
  })

  it('returns null for an id it does not hold', () => {
    expect(getRecord(db, 'REC-nope')).toBeNull()
  })
})

describe('adding', () => {
  const fresh: DataTableRecord = clone(SEED[0], { id: 'REC-new', name: 'Added Row' })

  it('puts a record with no anchor at the top, where the draft row commits', () => {
    insertRecord(db, fresh, null)
    expect(order()[0]).toBe('REC-new')
  })

  it('puts a record directly after its anchor', () => {
    insertRecord(db, fresh, SEED[3].id)
    const ids = order()
    expect(ids[ids.indexOf(SEED[3].id) + 1]).toBe('REC-new')
  })

  it('derives the filterable columns on the way in', () => {
    insertRecord(db, clone(fresh, { solvedCases: '999', date: '02 January, 2030' }), null)

    const byNumber = queryRecords(db, {
      ...EMPTY_QUERY,
      where: [
        { id: 'n', key: 'solvedCases', op: 'gte', values: [], value: '900', value2: '' },
      ],
    })
    expect(byNumber.rows.map((r) => r.id)).toEqual(['REC-new'])

    const byDate = queryRecords(db, {
      ...EMPTY_QUERY,
      where: [{ id: 'd', key: 'date', op: 'after', values: [], value: '2029-12-31', value2: '' }],
    })
    expect(byDate.rows.map((r) => r.id)).toEqual(['REC-new'])
  })
})

describe('editing', () => {
  it('rewrites the record and says whether it found one', () => {
    expect(updateRecord(db, clone(SEED[2], { name: 'Renamed Person' }))).toBe(true)
    expect(getRecord(db, SEED[2].id)?.name).toBe('Renamed Person')
    expect(updateRecord(db, clone(SEED[2], { id: 'REC-nope' }))).toBe(false)
  })

  it('rewrites the derived columns too, so the search follows the edit', () => {
    const found = (q: string) => queryRecords(db, { ...EMPTY_QUERY, q }).rows.map((r) => r.id)

    expect(found('renamed')).toEqual([])
    updateRecord(db, clone(SEED[2], { name: 'Renamed Person' }))
    expect(found('renamed')).toEqual([SEED[2].id])
    // And the old name stops matching, which a stale derived column would not.
    expect(found(SEED[2].name.toLowerCase())).toEqual([])
  })

  it('leaves a record where it was in the order', () => {
    const before = order()
    updateRecord(db, clone(SEED[5], { name: 'Still Fifth' }))
    expect(order()).toEqual(before)
  })
})

describe('deleting', () => {
  it('removes the row and reports whether there was one', () => {
    expect(deleteRecord(db, SEED[1].id)).toBe(true)
    expect(order()).not.toContain(SEED[1].id)
    expect(deleteRecord(db, SEED[1].id)).toBe(false)
  })
})

describe('moving', () => {
  it('drags a row down to sit after another', () => {
    moveRecord(db, SEED[0].id, SEED[4].id)
    const ids = order()
    expect(ids[ids.indexOf(SEED[4].id) + 1]).toBe(SEED[0].id)
    // It moved rather than being copied: the row it used to be is gone from
    // the top, and the table is the same length.
    expect(ids[0]).toBe(SEED[1].id)
    expect(ids).toHaveLength(SEED.length)
  })

  it('drags a row up to the top', () => {
    moveRecord(db, SEED[7].id, null)
    expect(order()[0]).toBe(SEED[7].id)
  })

  it('refuses to anchor a row to itself', () => {
    expect(moveRecord(db, SEED[3].id, SEED[3].id)).toBe(false)
    expect(order()).toEqual(SEED.map((r) => r.id))
  })

  it('reports a row it does not hold rather than inventing one', () => {
    expect(moveRecord(db, 'REC-nope', SEED[0].id)).toBe(false)
  })

  /**
   * The failure mode the float scheme is built around.
   *
   * Every drop into the same gap halves it, so after about fifty the midpoint
   * stops being strictly between its neighbours and two rows would share an
   * `ord` — which is a page boundary that shows a row twice. `ordFor` watches
   * for that and renumbers instead. Sixty is comfortably past it.
   */
  it('renumbers rather than running out of room in one gap', () => {
    const anchor = SEED[0].id
    for (let i = 0; i < 60; i += 1) {
      insertRecord(db, clone(SEED[1], { id: `REC-x${i}`, name: `Squeezed ${i}` }), anchor)
    }

    const rows = ords()
    expect(rows).toHaveLength(SEED.length + 60)
    // Strictly increasing: no two rows ended up on the same position.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].ord).toBeGreaterThan(rows[i - 1].ord)
    }
    // Last one in sits closest to the anchor — each went in directly after it.
    expect(rows[0].id).toBe(anchor)
    expect(rows[1].id).toBe('REC-x59')
  })

  it('leaves the order alone when it renumbers', () => {
    const before = order()
    rebalance(db)
    expect(order()).toEqual(before)
    expect(ords().map((r) => r.ord)).toEqual(before.map((_, i) => i + 1))
  })
})

describe('reordering wholesale', () => {
  it('takes the order from a list of ids', () => {
    const reversed = SEED.map((r) => r.id).reverse()
    expect(reorderAll(db, reversed)).toBe(SEED.length)
    expect(order()).toEqual(reversed)
  })

  it('skips ids it does not hold', () => {
    expect(reorderAll(db, ['REC-nope', ...SEED.map((r) => r.id)])).toBe(SEED.length)
  })
})

describe('a batch from the client', () => {
  it('applies a removal, an addition, an edit and a move at once', () => {
    const result = applySync(db, {
      removed: [SEED[0].id],
      added: [
        { record: clone(SEED[1], { id: 'REC-added', name: 'Brand New' }), afterId: null },
      ],
      updated: [clone(SEED[2], { name: 'Edited' })],
      moved: [{ id: SEED[9].id, afterId: SEED[3].id }],
    })

    expect(result).toMatchObject({ added: 1, updated: 1, removed: 1, moved: 1 })
    expect(result.rows).toBe(SEED.length)

    const ids = order()
    expect(ids[0]).toBe('REC-added')
    expect(ids).not.toContain(SEED[0].id)
    expect(ids[ids.indexOf(SEED[3].id) + 1]).toBe(SEED[9].id)
    expect(getRecord(db, SEED[2].id)?.name).toBe('Edited')
  })

  it('does nothing at all for an empty batch', () => {
    const before = order()
    expect(applySync(db, {})).toMatchObject({
      added: 0,
      updated: 0,
      removed: 0,
      moved: 0,
      reordered: 0,
    })
    expect(order()).toEqual(before)
  })

  /**
   * Removals run before additions so an id can be handed back. The table's own
   * `nextId` counts from the highest `REC-<n>` it can see, so deleting the last
   * record and adding one immediately after is exactly how a client produces
   * the same id twice in a row.
   */
  it('frees an id before reusing it', () => {
    const reused = clone(SEED[4], { id: SEED[4].id, name: 'Second Life' })
    const batch = { removed: [SEED[4].id], added: [{ record: reused, afterId: null }] }
    expect(() => applySync(db, batch)).not.toThrow()
    expect(getRecord(db, SEED[4].id)?.name).toBe('Second Life')
    expect(order()).toHaveLength(SEED.length)
  })
})

/* ---- the two halves together ----------------------------------------- */

/**
 * The property that has to hold, and the reason both halves are worth having.
 *
 * `diffRecords` guesses what changed from two arrays; `applySync` acts on that
 * guess. Either one can be self-consistently wrong — a diff that mislabels a
 * drag as a reshuffle still produces a payload, and a store that applies it in
 * the wrong order still returns counts. The only question worth asking is
 * whether the database ends up holding exactly the list the component now has,
 * so that is the only thing asserted: put `next` through the round trip and
 * read the table back.
 */
describe('a client diff, applied', () => {
  const shift = <T,>(list: T[], from: number, to: number): T[] => {
    const next = list.slice()
    const [taken] = next.splice(from, 1)
    next.splice(to, 0, taken)
    return next
  }

  const edited = (record: DataTableRecord, name: string) => clone(record, { name })
  const fresh = (id: string) => clone(SEED[0], { id, name: `New ${id}`, solvedCases: '7' })

  const CASES: [string, (list: DataTableRecord[]) => DataTableRecord[]][] = [
    ['nothing at all', (list) => list.slice()],
    ['a rename', (list) => list.map((r, i) => (i === 2 ? edited(r, 'Renamed') : r))],
    ['two renames at once', (list) => list.map((r, i) => (i % 5 ? r : edited(r, `R${i}`)))],
    [
      'an edit to a detail-pane field',
      (list) => list.map((r, i) => (i === 4 ? clone(r, { note: 'seen' }) : r)),
    ],
    ['a deletion', (list) => list.filter((_, i) => i !== 3)],
    ['three deletions', (list) => list.filter((_, i) => i !== 0 && i !== 5 && i !== 11)],
    ['a record added at the top', (list) => [fresh('REC-top'), ...list]],
    [
      'a record added in the middle',
      (list) => [...list.slice(0, 4), fresh('REC-mid'), ...list.slice(4)],
    ],
    ['a record added at the end', (list) => [...list, fresh('REC-end')]],
    ['a row dragged down', (list) => shift(list, 1, 8)],
    ['a row dragged up', (list) => shift(list, 9, 2)],
    ['a row dragged to the top', (list) => shift(list, 6, 0)],
    ['a row dragged to the bottom', (list) => shift(list, 0, 11)],
    ['a one-place nudge', (list) => shift(list, 4, 5)],
    ['a full reversal', (list) => list.slice().reverse()],
    [
      'a delete that also moved the survivors',
      (list) => shift(list.filter((_, i) => i !== 2), 0, 5),
    ],
    [
      'an add, an edit, a delete and a drag together',
      (list) => {
        const withEdit = list.map((r, i) => (i === 7 ? edited(r, 'Edited') : r))
        const withoutOne = withEdit.filter((_, i) => i !== 1)
        return shift([fresh('REC-all'), ...withoutOne], 5, 2)
      },
    ],
  ]

  it.each(CASES)('%s', (_name, mutate) => {
    const next = mutate(SEED)
    const payload = diffRecords(SEED, next)

    if (payload) applySync(db, payload)
    else expect(next.map((r) => r.id)).toEqual(SEED.map((r) => r.id))

    // Ids in order, then the fields, so a failure says which of the two broke.
    expect(order()).toEqual(next.map((r) => r.id))
    expect(listRecords(db)).toEqual(next)
  })

  it('survives being applied one edit after another', () => {
    let current = SEED as DataTableRecord[]
    for (const [, mutate] of CASES) {
      const next = mutate(current)
      const payload = diffRecords(current, next)
      if (payload) applySync(db, payload)
      expect(listRecords(db)).toEqual(next)
      current = next
    }
  })
})

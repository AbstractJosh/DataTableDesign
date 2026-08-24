/**
 * The demo set, and the guarantees the generated tail has to keep.
 *
 * The head is fixed and hand-checked; the tail exists so the table can be driven
 * against something the size of a real set. What is worth testing is not the
 * content of any one generated row but the properties the *rest of the port*
 * relies on: unique ids, parseable dates, canonical enum values, and enough
 * variety that a sort or a filter over a thousand rows is something a person can
 * check by eye.
 */
import { describe, expect, it } from 'vitest'

import { createDemoRecords } from './demoData'
import { parseTableDate } from './filters'
import { SEASONS, STATUSES } from './types'

describe('the fixed head', () => {
  it('defaults to the prototype’s seventeen', () => {
    expect(createDemoRecords()).toHaveLength(17)
    expect(createDemoRecords()[0].name).toBe('Tunc Yanik')
  })

  it('is byte-identical however many records are asked for', () => {
    // Every behaviour test in this repo is written against these seventeen, so
    // asking for a thousand must not move one byte of them.
    const head = createDemoRecords()
    expect(createDemoRecords(1000).slice(0, 17)).toEqual(head)
    expect(createDemoRecords(18).slice(0, 17)).toEqual(head)
  })

  it('is truncated, not padded, below seventeen', () => {
    expect(createDemoRecords(0)).toHaveLength(0)
    expect(createDemoRecords(5)).toHaveLength(5)
    expect(createDemoRecords(5)).toEqual(createDemoRecords().slice(0, 5))
  })

  it('builds the same list twice', () => {
    // No `Math.random`: a bug found at row 743 is still at row 743 on reload.
    expect(createDemoRecords(1000)).toEqual(createDemoRecords(1000))
  })

  it('hands back a fresh array each call', () => {
    const a = createDemoRecords(20)
    a[0].name = 'mutated'
    expect(createDemoRecords(20)[0].name).toBe('Tunc Yanik')
  })
})

describe('a thousand records', () => {
  const records = createDemoRecords(1000)

  it('is a thousand records', () => {
    expect(records).toHaveLength(1000)
  })

  it('never repeats an id', () => {
    // Ids are React keys and the reorder logic diffs them; a duplicate is a
    // silently wrong row, not a visible error.
    expect(new Set(records.map((r) => r.id)).size).toBe(1000)
    // And the REC-4820 + 7i series carries on unbroken through the join.
    expect(records[16].id).toBe('REC-4925')
    expect(records[17].id).toBe('REC-4932')
  })

  it('never repeats an email', () => {
    expect(new Set(records.map((r) => r.email)).size).toBe(1000)
  })

  it('spreads the names wide enough to sort by eye', () => {
    // A thousand rows of sixteen names would make the sort untestable.
    expect(new Set(records.map((r) => r.name)).size).toBeGreaterThan(900)
  })

  it('keeps every enum value canonical', () => {
    // The filter dock matches on these, `PILL_CLASS` paints off them and the
    // metric keys are built from them — a generated row that invented its own
    // status would be invisible to all three.
    records.forEach((r) => {
      expect(STATUSES).toContain(r.status)
      expect(SEASONS).toContain(r.favouriteSeason)
    })
  })

  it('writes dates the filters can parse', () => {
    records.forEach((r) => expect(parseTableDate(r.date)).not.toBeNull())
    // …and in the stored English format the language switch reads a month out of.
    records.forEach((r) =>
      expect(r.date).toMatch(
        /^\d{2} (January|February|March|April|May|June|July|August|September|October|November|December), \d{4}$/,
      ),
    )
  })

  it('lands every status against every season', () => {
    // The dock's two-chip AND is only a demonstration if the pairs overlap. All
    // twelve combinations have to be reachable, or some pair of chips empties
    // the table and reads as a broken filter.
    const pairs = new Set(records.map((r) => `${r.status}|${r.favouriteSeason}`))
    expect(pairs.size).toBe(STATUSES.length * SEASONS.length)
  })

  it('keeps the case counts numeric and worth summing', () => {
    const numbers = records.map((r) => Number(r.solvedCases))
    numbers.forEach((n) => expect(Number.isFinite(n)).toBe(true))
    // Spread wide, or a sum, a mean and a median over a run read the same.
    expect(Math.max(...numbers) - Math.min(...numbers)).toBeGreaterThan(200)
  })

  it('fills every field of every record', () => {
    records.forEach((r) => {
      // `email` and `note` included: the search reads email, and an empty note
      // leaves the detail pane with a hole in it.
      Object.entries(r).forEach(([key, value]) => {
        expect(String(value).length, `${r.id}.${key}`).toBeGreaterThan(0)
      })
    })
  })
})

/**
 * Behaviour parity tests — the numbered ids refer to PARITY.md.
 *
 * Most tests run with motion="never" so the expand/collapse lifecycle resolves
 * synchronously; jsdom never fires `animationend`, and the animation's own
 * fallback timer is exercised separately.
 */
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable } from './DataTable'
import { createDemoRecords } from './demoData'
import { COLUMN_DRAG_MIME } from './FilterDock'
import type { RateMetricKey } from './metrics'
import type { DataTableRecord } from './types'

function setup(props: Partial<React.ComponentProps<typeof DataTable>> = {}) {
  const user = userEvent.setup()
  const utils = render(<DataTable motion="never" {...props} />)
  return { user, ...utils }
}

const rowNames = () =>
  screen
    .getAllByRole('button', { name: /^Reorder (?!.*column)/ })
    .map((el) => (el.getAttribute('aria-label') || '').replace(/^Reorder /, '').split(',')[0])

const byTitle = (title: string, root: ParentNode = document) =>
  root.querySelector(`[title="${title}"]`) as HTMLElement

/**
 * A numbered pager button, by the page it goes to.
 *
 * Not `{ name: '3' }` any more: the strip shows a window of five now, and a
 * bare digit in a window says nothing about how much is either side of it, so
 * the buttons carry "Page 3 of 125". The count is left off the pattern here —
 * a test that changes the page size should not also have to restate how many
 * pages that leaves.
 */
const pageBtn = (page: number) =>
  screen.getByRole('button', { name: new RegExp(`^Page ${page} of `) })

/* ---- aiming a drag ------------------------------------------------ *
 * A reorder is committed on the drop, and which slot it lands in comes from a
 * midpoint test against the cell under the pointer. jsdom supplies neither
 * half: it has no `DragEvent`, so testing-library falls back to a plain
 * `Event` and drops `clientX`/`clientY` from the init (`dataTransfer` is
 * special-cased back on; nothing else is), and it lays nothing out, so every
 * rect measures zero. So both halves are handed over here — a real box on the
 * element the component measures, and a pointer position on the event.
 * ------------------------------------------------------------------- */

const dragOverWithin = (
  target: HTMLElement,
  measured: HTMLElement,
  box: Partial<DOMRect>,
  pointer: { clientX?: number; clientY?: number },
) => {
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...box } as DOMRect
  const spy = vi.spyOn(measured, 'getBoundingClientRect').mockReturnValue(rect)
  const event = createEvent.dragOver(target)
  Object.entries(pointer).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  )
  fireEvent(target, event)
  spy.mockRestore()
}

/**
 * A `dragstart` carrying a pointer position and a `setDragImage`, over a source
 * with a real box — enough for the component to record where along the element
 * the drag took hold. Same jsdom workaround as `dragOverWithin`: the
 * plain-`Event` fallback drops `clientX`/`clientY`. Without the `setDragImage`
 * there is no grab to record and the slot test falls back to the bare cursor,
 * which is what every other drag test here exercises.
 */
const dragStartAt = (
  grip: HTMLElement,
  source: HTMLElement,
  box: Partial<DOMRect>,
  pointer: { clientX?: number; clientY?: number },
) => {
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...box } as DOMRect
  const spy = vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect)
  const event = createEvent.dragStart(grip, {
    dataTransfer: { effectAllowed: '', setData: () => {}, setDragImage: () => {} },
  })
  Object.entries(pointer).forEach(([key, value]) =>
    Object.defineProperty(event, key, { value }),
  )
  fireEvent(grip, event)
  spy.mockRestore()
}

/** Point the column in flight at the gap on one side of a header cell. */
const aimAtColumn = (th: HTMLElement, side: 'before' | 'after') =>
  dragOverWithin(th, th, { left: 100, right: 200, width: 100 }, {
    clientX: side === 'before' ? 120 : 180,
  })

/**
 * The same for a row, aimed at a cell inside it. The component measures the
 * row's first `<tr>` and never the `<tbody>`, which an open detail pane makes
 * taller than the row it belongs to.
 */
const aimAtRow = (tbody: HTMLElement, side: 'before' | 'after') =>
  dragOverWithin(
    tbody.querySelector('td') as HTMLElement,
    tbody.querySelector('tr') as HTMLElement,
    { top: 100, bottom: 140, height: 40 },
    { clientY: side === 'before' ? 110 : 130 },
  )

type User = ReturnType<typeof userEvent.setup>

/* ---- the filter dock ---------------------------------------------- *
 * PORT ADDITION. The toolbar's single "Status" dropdown is gone; filtering is
 * a strip of chips between the toolbar and the table, one per column. Inside
 * the dock `/Status/` matches the chip's own button *and* its "Remove the
 * Status filter" button, so these helpers reach for the class names the dock's
 * markup contract fixes rather than for accessible names.
 * ------------------------------------------------------------------- */

const dock = () => screen.getByRole('region', { name: 'Filter dock' })

/** The chip for a column, by the label in its tag. Undefined when there is none. */
const chip = (label: string) =>
  Array.from(dock().querySelectorAll('.dt-chip')).find(
    (el) => el.querySelector('.dt-chip-tag')?.textContent === label,
  ) as HTMLElement

const chips = () => dock().querySelectorAll('.dt-chip')
const chipButton = (label: string) => chip(label).querySelector('.dt-chip-btn') as HTMLElement
/** The chip's summary text — "Any" while it has no operand yet. */
const chipValue = (label: string) => chip(label).querySelector('.dt-chip-value')?.textContent
const popup = (label: string) => chip(label).querySelector('.dt-chip-pop') as HTMLElement
/** The operator dropdown inside a chip's popup: a plain FilterMenu. */
const opButton = (label: string) => popup(label).querySelector('.dt-filter-btn') as HTMLElement

/**
 * The head of the chain, which is also the door into it. Matched exactly: the
 * column grips name this button in their own aria-label, as the keyboard route
 * into the dock, so a substring match finds seven buttons.
 */
const addButton = () => screen.getByRole('button', { name: 'Add filter' })
/** The revert. Always on the strip; disabled until there is something to revert. */
const revertButton = () =>
  screen.getByRole('button', { name: 'Revert — remove every filter' })

/** The pointer-free door into the dock; the drop gesture is covered separately. */
const addFilter = async (user: User, label: string) => {
  await user.click(addButton())
  await user.click(screen.getByRole('option', { name: label }))
}

/** Tick or untick one option of an enum chip. Its popup must be open. */
const tick = async (user: User, label: string, option: string) => {
  await user.click(within(popup(label)).getByRole('option', { name: option }))
}

/** Take an operator by the words it reads as, not by its stored key. */
const pickOp = async (user: User, label: string, op: string) => {
  await user.click(opButton(label))
  await user.click(screen.getByRole('option', { name: op }))
}

/** The data columns, left to right. `email` is not one of them any more. */
const columnKeys = () =>
  Array.from(document.querySelectorAll('th[data-key]')).map((th) => th.getAttribute('data-key'))

const DEFAULT_KEYS = ['name', 'date', 'status', 'solvedCases', 'favouriteSeason', 'address']

const rowsInput = () => screen.getByLabelText('Rows per page') as HTMLInputElement

const stat = (label: string) =>
  screen.getByText(label, { selector: '.dt-stat-label' }).nextElementSibling?.textContent

describe('frame', () => {
  it('renders the header, kicker and the three stats', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Data table' })).toBeInTheDocument()
    expect(screen.getByText('Records / Directory')).toBeInTheDocument()
    expect(stat('Total')).toBe('17')
    expect(stat('Matching')).toBe('17')
    expect(stat('Selected')).toBe('0')
  })

  it('shows one page of rows and the footer range', () => {
    setup()
    expect(rowNames()).toHaveLength(8)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–8 of 17 entries')
  })

  it('honours rowsPerPage, density and accentColor', () => {
    const { container } = setup({ rowsPerPage: 4, density: 'compact', accentColor: '#ff0000' })
    expect(rowNames()).toHaveLength(4)
    const root = container.querySelector('.dt-root') as HTMLElement
    expect(root.style.getPropertyValue('--dt-cell-pad-y')).toBe('9px')
    expect(root.style.getPropertyValue('--dt-accent')).toBe('#ff0000')
  })
})

describe('search and filter', () => {
  it('filters across name, email and address, case-insensitively', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'AMELIA')
    expect(rowNames()).toEqual(['Amelia Hart'])
    expect(stat('Matching')).toBe('1')
    expect(stat('Total')).toBe('17')
  })

  it('matches on the address too', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'Eskisehir')
    expect(rowNames()).toEqual(['Tunc Yanik'])
  })

  it('still searches the email, which is a detail-pane field now', async () => {
    const { user } = setup()
    // `favouriteSeason` took the column; `email` stayed on the record, so the
    // query keeps reading it (see the derive in DataTable).
    expect(document.querySelector('th[data-key="email"]')).toBeNull()
    await user.type(screen.getByLabelText('Search records'), 'tyanik@yopmail')
    expect(rowNames()).toEqual(['Tunc Yanik'])
  })

  it('resets to page 1 when the query changes', async () => {
    const { user } = setup()
    await user.click(pageBtn(3))
    expect(pageBtn(3)).toHaveAttribute('aria-current', 'page')
    await user.type(screen.getByLabelText('Search records'), 'a')
    expect(pageBtn(1)).toHaveAttribute('aria-current', 'page')
  })

  it('filters by status and combines with the query', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await tick(user, 'Status', 'Failed')
    expect(rowNames()).toEqual(['Marcus Reed', 'Clara Whitfield', 'Julien Moreau'])
    await user.type(screen.getByLabelText('Search records'), 'clara')
    expect(rowNames()).toEqual(['Clara Whitfield'])
  })

  it('names the active filter on its chip and marks the ticked option', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    expect(chipValue('Status')).toBe('Any')
    expect(chip('Status')).toHaveClass('dt-idle')

    await tick(user, 'Status', 'Success')
    expect(chipValue('Status')).toBe('Success')
    expect(chip('Status')).not.toHaveClass('dt-idle')

    const options = within(popup('Status'))
    expect(options.getByRole('option', { name: 'Success' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(options.getByRole('option', { name: 'Failed' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('shows the empty state when nothing matches', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'zzzzz')
    expect(screen.getByText('No records match')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 0 entries')
  })
})

/**
 * PORT ADDITION: the filter dock. The prototype had one status dropdown; the
 * dock takes any column as a chip and ANDs them. The pointer gesture that fills
 * it lives in its own block below — this one is the state machine behind the
 * chips, reached through the chain's head block — "Add filter" — which is the
 * same door with a keyboard on it rather than a lesser fallback.
 */
describe('filter dock', () => {
  it('starts empty, prompting for the gesture that fills it', () => {
    setup()
    expect(chips()).toHaveLength(0)
    expect(within(dock()).getByText(/Drag a column here/)).toBeInTheDocument()
    // The revert holds its place either way — it moved the head block about
    // when it was rendered conditionally — so it is here, greyed out, rather
    // than absent.
    expect(revertButton()).toBeDisabled()
  })

  it('adds a filter from the keyboard and lands inside the open popup', async () => {
    const { user } = setup()
    addButton().focus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Name' })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Status' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.queryByRole('listbox', { name: 'Add a column filter' })).toBeNull()
    // The table has not changed — an inert chip filters nothing — so the caret
    // arriving on the first operand is the only thing that says it worked.
    expect(popup('Status')).toBeInTheDocument()
    expect(within(popup('Status')).getByRole('option', { name: 'Success' })).toHaveFocus()
  })

  it('a freshly added chip filters nothing', async () => {
    const { user } = setup()
    const before = rowNames()

    await addFilter(user, 'Status')

    // The rule the whole dock rests on (isActive in filters.ts): a condition
    // with no operand is skipped, so the table stands still between the drop
    // and the first tick. Going blank here would read as a broken drop.
    expect(rowNames()).toEqual(before)
    expect(stat('Matching')).toBe('17')
    expect(chipValue('Status')).toBe('Any')
    expect(chip('Status')).toHaveClass('dt-idle')
  })

  it('ticks an enum as a union, not an intersection', async () => {
    const { user } = setup({ rowsPerPage: 16 })
    await addFilter(user, 'Status')

    await tick(user, 'Status', 'Success')
    expect(stat('Matching')).toBe('8')

    await tick(user, 'Status', 'Failed')
    expect(stat('Matching')).toBe('11') // 8 + 3, not the 0 an AND would give
    // and the summary reads in ENUM_OPTIONS order, not tick order
    expect(chipValue('Status')).toBe('Success, Failed')

    const pills = Array.from(document.querySelectorAll('td[data-key="status"] .dt-pill'))
    expect(new Set(pills.map((el) => el.textContent))).toEqual(new Set(['Success', 'Failed']))
  })

  it('combines two chips with AND — narrowing, not emptying', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await tick(user, 'Status', 'Success')
    expect(stat('Matching')).toBe('8')

    // This pairing is the demo the whole feature exists for, and demoData holds
    // the overlap open on purpose.
    await addFilter(user, 'Favourite season')
    await tick(user, 'Favourite season', 'Spring')
    expect(rowNames()).toEqual(['Ethan Noah', 'Naomi Castillo', 'Victor Ilyin'])
    expect(stat('Matching')).toBe('3')
  })

  it('filters a text column with contains, ignoring case', async () => {
    const { user } = setup()
    await addFilter(user, 'Name')
    // `contains` leads OPS_FOR_TYPE.text, so the chip opens on it already
    await user.type(screen.getByLabelText('Name value'), 'HART')

    expect(rowNames()).toEqual(['Amelia Hart'])
    // the chip does not shout — the uppercasing is CSS
    expect(chipValue('Name')).toBe('contains HART')
  })

  it('filters a number column with between, either way round', async () => {
    const { user } = setup()
    await addFilter(user, 'Solved cases')
    await pickOp(user, 'Solved cases', 'is between')

    const from = () => screen.getByLabelText('Solved cases range start')
    const to = () => screen.getByLabelText('Solved cases range end')

    await user.type(from(), '100')
    // one end alone is not half a range, it is nothing
    expect(stat('Matching')).toBe('17')

    await user.type(to(), '200')
    expect(rowNames()).toEqual(['Tunc Yanik', 'Daniel Osei', 'Hana Sato', 'Victor Ilyin'])
    expect(chipValue('Solved cases')).toBe('is between 100 and 200')

    // typed backwards it is still a range: the operands are swapped, not refused
    await user.clear(from())
    await user.type(from(), '200')
    await user.clear(to())
    await user.type(to(), '100')
    expect(rowNames()).toEqual(['Tunc Yanik', 'Daniel Osei', 'Hana Sato', 'Victor Ilyin'])
  })

  it('filters a date column on parsed dates, not on text order', async () => {
    const { user } = setup()
    await addFilter(user, 'Date')
    await pickOp(user, 'Date', 'is after')

    // `<input type="date">` has no keyboard path through its segments in jsdom,
    // and hands back ISO — which parseTableDate takes alongside the record's
    // "18 March, 2026" shape.
    fireEvent.change(screen.getByLabelText('Date value'), { target: { value: '2026-03-18' } })

    // "02 April" sorts *below* "18 March" as text, and the column's sort still
    // does exactly that (a documented handoff gotcha); the filter does not.
    expect(rowNames()).toEqual([
      'Tunc Yanik', 'Priya Anand', 'Tomas Berger', 'Julien Moreau', 'Samir Haddad',
    ])
  })

  it('removing a chip gives the rows back', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await tick(user, 'Status', 'Failed')
    expect(stat('Matching')).toBe('3')

    await user.click(screen.getByRole('button', { name: 'Remove the Status filter' }))
    expect(chip('Status')).toBeUndefined()
    expect(stat('Matching')).toBe('17')
  })

  // The button that takes the press unmounts itself, so without a deliberate
  // hand-off focus falls to <body> — the top of the host's document, a long way
  // back for anyone who arrived here by keyboard.
  it('puts focus somewhere deliberate when a chip goes away', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await addFilter(user, 'Name')

    // the chip that slid into the gap
    await user.click(screen.getByRole('button', { name: 'Remove the Status filter' }))
    expect(document.activeElement).toBe(chipButton('Name'))

    // the last one out lands on the door back in
    await user.click(screen.getByRole('button', { name: 'Remove the Name filter' }))
    expect(document.activeElement).toBe(addButton())
  })

  it('Revert takes several chips at once', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await tick(user, 'Status', 'Success')
    await addFilter(user, 'Favourite season')
    await tick(user, 'Favourite season', 'Spring')
    expect(stat('Matching')).toBe('3')

    await user.click(revertButton())
    expect(chips()).toHaveLength(0)
    expect(stat('Matching')).toBe('17')
    expect(within(dock()).getByText(/Drag a column here/)).toBeInTheDocument()
    // The revert goes disabled once the last chip is gone, which drops focus
    // exactly as unmounting would, so it hands focus on for the same reason the
    // × does.
    expect(document.activeElement).toBe(addButton())
  })

  it('clearing a chip empties its operands but keeps the chip', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    const clear = () => within(popup('Status')).getByRole('button', { name: 'Clear' })
    // nothing to empty yet
    expect(clear()).toBeDisabled()

    await tick(user, 'Status', 'Success')
    await tick(user, 'Status', 'Failed')
    expect(chipValue('Status')).toBe('Success, Failed')

    // the reducer has no bulk clear, so this untoggles each ticked option in
    // turn — every one of them, not just the first
    await user.click(clear())
    expect(chips()).toHaveLength(1)
    expect(chipValue('Status')).toBe('Any')
    expect(chip('Status')).toHaveClass('dt-idle')
    expect(stat('Matching')).toBe('17')
  })

  it('Done closes the popup and hands focus back to the chip', async () => {
    const { user } = setup()
    await addFilter(user, 'Favourite season')
    await tick(user, 'Favourite season', 'Winter')

    await user.click(within(popup('Favourite season')).getByRole('button', { name: 'Done' }))
    expect(chip('Favourite season').querySelector('.dt-chip-pop')).toBeNull()
    expect(chipButton('Favourite season')).toHaveFocus()
    expect(chipValue('Favourite season')).toBe('Winter')
  })

  it('lists a column that already has a chip, but will not add it twice', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')

    await user.click(addButton())
    const taken = screen.getByRole('option', { name: 'Status' })
    // listed rather than dropped, so the picker's order always matches the
    // table's and never shuffles under the arrows
    expect(taken).toHaveAttribute('aria-disabled', 'true')

    await user.click(taken)
    expect(chips()).toHaveLength(1)
    // a dead row commits to nothing at all, so the list is still standing
    expect(screen.getByRole('listbox', { name: 'Add a column filter' })).toBeInTheDocument()
  })

  it('a filter change resets to page 1; adding an inert chip does not', async () => {
    const { user } = setup({ rowsPerPage: 4 })
    await user.click(pageBtn(4))

    await addFilter(user, 'Status')
    // nothing about the result set has changed yet, so the page the user was
    // reading is still the page they wanted
    expect(pageBtn(4)).toHaveAttribute('aria-current', 'page')

    await tick(user, 'Status', 'Success')
    // 8 matches over 2 pages, so a bare clamp would have settled on page 2
    expect(pageBtn(1)).toHaveAttribute('aria-current', 'page')
  })

  it('a filter change backs out of a pending delete, an armed row and a cell range', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    const reopen = async () => user.click(chipButton('Status'))

    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
    await reopen()
    await tick(user, 'Status', 'Success')
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull()

    // Any *press* outside an open editor commits and closes it first (the
    // document capture in DataTable), so the armed row is the half of
    // `cleared()` a pointer can still be seen to take: `picking` survives the
    // press that reopens the popup, and only the tick clears it.
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
    await user.click(byTitle('Edit Name'))
    expect(screen.getByLabelText('Edit Name')).toBeInTheDocument()
    await reopen()
    expect(byTitle('Edit Name')).toBeInTheDocument()
    await tick(user, 'Status', 'Failed')
    expect(screen.queryByLabelText('Edit Name')).toBeNull()
    expect(byTitle('Edit Name')).toBeNull()

    const cell = (row: number, col: number) =>
      document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseOver(cell(1, 1))
    fireEvent.mouseUp(document)
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(4)
    await reopen()
    await tick(user, 'Status', 'Failed')
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(0)
  })

  it('Escape closes a chip popup and hands focus back, leaving the table alone', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'New record' }))
    await addFilter(user, 'Status')
    expect(popup('Status')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(chip('Status').querySelector('.dt-chip-pop')).toBeNull()
    expect(chipButton('Status')).toHaveFocus()
    // the root's own Escape chain never saw the key
    expect(document.querySelector('tbody[data-id="__draft__"]')).toBeInTheDocument()
  })

  it('a press outside closes the popup, leaving the condition alone', async () => {
    const { user } = setup()
    await addFilter(user, 'Status')
    await tick(user, 'Status', 'Failed')

    await user.click(screen.getByRole('heading', { name: 'Data table' }))
    expect(chip('Status').querySelector('.dt-chip-pop')).toBeNull()
    expect(chipValue('Status')).toBe('Failed')
    expect(stat('Matching')).toBe('3')
  })

  it('offers the empty state when a chip filters everything out', async () => {
    const { user } = setup()
    await addFilter(user, 'Name')
    await user.type(screen.getByLabelText('Name value'), 'zzzzz')

    expect(screen.getByText('No records match')).toBeInTheDocument()
    // the copy names the dock now: the search field is no longer the only
    // thing that can empty the table
    expect(screen.getByText(/loosen a filter in the dock above/)).toBeInTheDocument()
  })

  it('the search and the chips narrow together', async () => {
    const { user } = setup()
    await addFilter(user, 'Favourite season')
    await tick(user, 'Favourite season', 'Summer')
    expect(stat('Matching')).toBe('5') // Tunc plus four generated records

    await user.type(screen.getByLabelText('Search records'), 'eskisehir')
    expect(rowNames()).toEqual(['Tunc Yanik'])
  })
})

describe('sort', () => {
  const sortButton = () => screen.getByRole('button', { name: 'Sort by Name' })
  const nameHeader = () => sortButton().closest('th') as HTMLElement

  it('cycles ascending -> descending -> unsorted', async () => {
    const { user } = setup()
    const before = rowNames()

    await user.click(sortButton())
    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')
    expect(rowNames()[0]).toBe('Amelia Hart')

    await user.click(sortButton())
    expect(nameHeader()).toHaveAttribute('aria-sort', 'descending')
    expect(rowNames()[0]).toBe('Victor Ilyin')

    await user.click(sortButton())
    expect(nameHeader()).toHaveAttribute('aria-sort', 'none')
    expect(rowNames()).toEqual(before)
  })

  it('sorts lexicographically, including dates', async () => {
    const { user } = setup({ rowsPerPage: 16 })
    await user.click(screen.getByRole('button', { name: 'Sort by Date' }))
    const dates = Array.from(document.querySelectorAll('td[data-key="date"]')).map(
      (td) => td.textContent,
    )
    expect(dates).toEqual([...dates].sort((a, b) => String(a).localeCompare(String(b))))
  })

  it('rotates the caret only for ascending', async () => {
    const { user } = setup()
    await user.click(sortButton())
    expect(nameHeader().querySelector('.dt-caret')).toHaveClass('dt-asc')
    await user.click(sortButton())
    expect(nameHeader().querySelector('.dt-caret')).not.toHaveClass('dt-asc')
  })
})

describe('selection', () => {
  it('toggles one row and counts it', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(screen.getByRole('button', { name: 'Select Tunc Yanik' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(stat('Selected')).toBe('1')
  })

  it('select-all touches only the current page', async () => {
    const { user } = setup()
    const box = screen.getByRole('button', { name: 'Select all rows on this page' })
    await user.click(box)
    expect(stat('Selected')).toBe('8')
    // the accent border of `.dt-on` would disappear into the accent header bar
    expect(box).not.toHaveClass('dt-on')
    await user.click(pageBtn(2))
    expect(
      screen.getByRole('button', { name: 'Select all rows on this page' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(stat('Selected')).toBe('8')
  })

  it('keeps the selection across paging and filtering', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(pageBtn(2))
    await user.click(pageBtn(1))
    expect(screen.getByRole('button', { name: 'Select Tunc Yanik' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(stat('Selected')).toBe('1')
  })

  it('stands Export and the export strip in the footer, immediately left of the pager', () => {
    setup()
    const actions = document.querySelector('.dt-foot-actions') as HTMLElement
    expect(actions).not.toBeNull()
    // the toolbar is left with nothing that acts on the selection (DEV-19)
    expect(actions.closest('.dt-toolbar')).toBeNull()
    expect(actions.closest('.dt-foot')).not.toBeNull()
    expect(actions.nextElementSibling).toHaveClass('dt-pager')
    // Archive is gone and its place belongs to the export now (DEV-22). The
    // strip is in the DOM but shut — no `dt-open`, so no width — which is
    // what leaves Export standing against the pager between exports.
    expect(Array.from(actions.children).map((el) => el.className)).toEqual([
      'dt-btn-secondary',
      'dt-foot-export',
    ])
    expect(Array.from(actions.children).map((el) => el.textContent)).toEqual(['Export', ''])
    expect(actions.lastElementChild).not.toHaveClass('dt-open')
    expect(actions.lastElementChild!.children).toHaveLength(0)
    // the pair is one group, so the footer's space-between still has two
    // children and a narrow footer wraps them together
    expect(actions.parentElement).toHaveClass('dt-foot-controls')
    expect(
      Array.from(document.querySelector('.dt-foot')!.children).map(
        (el) => el.className,
      ),
    ).toEqual(['dt-foot-count', 'dt-foot-controls'])
  })

  it('enables Export only with something selected', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('reports selection changes', async () => {
    const onSelectionChange = vi.fn()
    const { user } = setup({ onSelectionChange })
    expect(onSelectionChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(onSelectionChange).toHaveBeenCalledWith(['REC-4813'])
  })
})

/**
 * The select-only combobox that used to be the toolbar's status dropdown. Its
 * one caller now is the operator picker inside a filter chip's popup, so the
 * keyboard contract is exercised there — same component, same keys, and the
 * dock's own lists are held to it too.
 *
 * The toolbar's metric cog is deliberately NOT this component — it holds a set
 * of values per kind of cell content rather than one value — but it answers the
 * same keys, and the "flow block" describe holds it to them.
 */
describe('operator menu', () => {
  /** A text column's operators, in the words OP_LABELS gives them. */
  const TEXT_OPS = ['contains', 'does not contain', 'is', 'starts with']
  const options = () => screen.getAllByRole('option').map((el) => el.textContent)

  /** A Name chip with its popup open — nothing else on screen holds options. */
  const withNameChip = async () => {
    const { user } = setup()
    await addFilter(user, 'Name')
    return user
  }

  it('opens with every operator in it and closes on a pick', async () => {
    const user = await withNameChip()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(opButton('Name')).toHaveAttribute('aria-expanded', 'false')

    await user.click(opButton('Name'))
    expect(opButton('Name')).toHaveAttribute('aria-expanded', 'true')
    expect(options()).toEqual(TEXT_OPS)

    await user.click(screen.getByRole('option', { name: 'starts with' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(opButton('Name')).toHaveTextContent('starts with')
    expect(opButton('Name')).toHaveFocus()
  })

  it('a second press on the button closes it again', async () => {
    const user = await withNameChip()
    await user.click(opButton('Name'))
    await user.click(opButton('Name'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens on ArrowDown with the current value focused, and walks the list', async () => {
    const user = await withNameChip()
    opButton('Name').focus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'contains' })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: 'is' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByRole('option', { name: 'starts with' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(opButton('Name')).toHaveTextContent('starts with')

    await user.type(screen.getByLabelText('Name value'), 'm')
    expect(rowNames()).toEqual(['Marcus Reed', 'Mia Donnelly'])
  })

  it('stops at the ends of the list', async () => {
    const user = await withNameChip()
    await user.click(opButton('Name'))
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('option', { name: 'contains' })).toHaveFocus()
  })

  it('Escape closes it without picking, and gives the button back its focus', async () => {
    const user = await withNameChip()
    await user.click(opButton('Name'))
    await user.keyboard('{ArrowDown}{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(opButton('Name')).toHaveTextContent('contains')
    expect(opButton('Name')).toHaveFocus()
  })

  it('that Escape does not also unwind the table behind it', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'New record' }))
    await addFilter(user, 'Name')
    await user.click(opButton('Name'))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    // one level only: the chip's own popup is still open behind the list, and
    // the draft never heard the key
    expect(popup('Name')).toBeInTheDocument()
    expect(document.querySelector('tbody[data-id="__draft__"]')).toBeInTheDocument()
  })

  it('a press outside closes it', async () => {
    const user = await withNameChip()
    await user.click(opButton('Name'))
    await user.click(screen.getByLabelText('Search records'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('rows per page', () => {
  it('resizes the page from the toolbar', async () => {
    setup()
    expect(rowNames()).toHaveLength(8)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–8 of 17 entries')

    fireEvent.change(rowsInput(), { target: { value: '4' } })
    expect(rowNames()).toHaveLength(4)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–4 of 17 entries')
    expect(screen.getAllByRole('button', { name: /^Page \d+ of 5$/ })).toHaveLength(5)
  })

  it('keeps the record at the top of the page in view', async () => {
    const { user } = setup()
    await user.click(pageBtn(2))
    const first = rowNames()[0]

    fireEvent.change(rowsInput(), { target: { value: '4' } })
    expect(rowNames()[0]).toBe(first)
    expect(pageBtn(3)).toHaveAttribute('aria-current', 'page')
  })

  it('takes the prop as its opening value and reports every change', () => {
    const onRowsPerPageChange = vi.fn()
    setup({ rowsPerPage: 5, onRowsPerPageChange })
    expect(rowsInput()).toHaveValue(5)
    expect(rowNames()).toHaveLength(5)

    fireEvent.change(rowsInput(), { target: { value: '9' } })
    expect(onRowsPerPageChange).toHaveBeenCalledWith(9)
    expect(rowNames()).toHaveLength(9)
  })

  it('accepts any value above 1 without bounds constraints', () => {
    setup({ rowsPerPage: 40 })
    expect(rowsInput()).not.toHaveAttribute('max')
    expect(rowsInput()).toHaveAttribute('min', '1')
    fireEvent.change(rowsInput(), { target: { value: '100' } })
    expect(rowNames()).toHaveLength(17) // page has 17 rows, all shown
  })

  it('drops the cell range, which was measured against the old page', () => {
    setup()
    const cell = (row: number, col: number) =>
      document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseOver(cell(2, 1))
    fireEvent.mouseUp(document)
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(6)

    fireEvent.change(rowsInput(), { target: { value: '4' } })
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(0)
  })
})

describe('pagination', () => {
  it('clamps Prev and Next', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 17–17 of 17 entries')
  })

  it('renders one numbered button per page while they all fit', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Page 3 of 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Page 4 / })).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * PORT ADDITION: the windowed pager
 *
 * The prototype prints one button per page, which the 1000-record set turns
 * into 125 of them. What replaces it is a sliding window of five plus the four
 * jumps, and the tests below are about the window's *edges* — the middle case
 * is the easy one and the ends are where a centring rule goes wrong.
 * ------------------------------------------------------------------ */

/** The numbered buttons on screen, left to right, as the digits they print. */
const pageNums = () =>
  Array.from(document.querySelectorAll('.dt-pager-num')).map((el) => el.textContent)

const jump = (name: string) => screen.getByRole('button', { name })

describe('the page window', () => {
  /* 1000 records at 8 a page is 125 pages. Built once per test through `setup`,
     which is slower than the 17-record default but it is the only size at which
     the window has anything to do. */
  const big = (props: Partial<React.ComponentProps<typeof DataTable>> = {}) =>
    setup({ defaultRecords: createDemoRecords(1000), ...props })

  it('shows five numbers, not one hundred and twenty-five', () => {
    big()
    expect(pageNums()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('stops at the start rather than centring off the end of the strip', async () => {
    const { user } = big()
    // There is no page 0 to pad with, so the window cannot centre on page 1 —
    // it stops, and the current page sits at the left edge.
    expect(pageNums()).toEqual(['1', '2', '3', '4', '5'])
    await user.click(jump('Page 2 of 125'))
    expect(pageNums()).toEqual(['1', '2', '3', '4', '5'])
    await user.click(jump('Page 3 of 125'))
    expect(pageNums()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('slides one step at a time once it is clear of the start', async () => {
    const { user } = big()
    await user.click(jump('Page 4 of 125'))
    // Centred now: two either side.
    expect(pageNums()).toEqual(['2', '3', '4', '5', '6'])
    await user.click(jump('Next page'))
    expect(pageNums()).toEqual(['3', '4', '5', '6', '7'])
    // The button just pressed is still on the strip, which is the whole reason
    // the window slides instead of paging in fixed blocks of five.
    expect(jump('Page 5 of 125')).toHaveAttribute('aria-current', 'page')
  })

  it('stops at the end, with the last page at the right edge', async () => {
    const { user } = big()
    await user.click(jump('Last page'))
    expect(pageNums()).toEqual(['121', '122', '123', '124', '125'])
    expect(jump('Page 125 of 125')).toHaveAttribute('aria-current', 'page')
  })

  it('marks exactly one page current', async () => {
    const { user } = big()
    await user.click(jump('Page 3 of 125'))
    const current = document.querySelectorAll('.dt-pager-num[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('3')
    expect(current[0]).toHaveClass('dt-active')
  })

  it('never shows more numbers than there are pages', () => {
    // 17 records over 3 pages: the window is the whole strip, not five buttons
    // with two of them pointing nowhere.
    setup()
    expect(pageNums()).toEqual(['1', '2', '3'])
  })
})

describe('the four jumps', () => {
  const big = () => setup({ defaultRecords: createDemoRecords(1000) })

  it('goes to the first and last page in one press', async () => {
    const { user } = big()
    await user.click(jump('Last page'))
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 993–1000 of 1000 entries')

    await user.click(jump('First page'))
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–8 of 1000 entries')
  })

  it('steps one page with the single arrows', async () => {
    const { user } = big()
    await user.click(jump('Next page'))
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 9–16 of 1000 entries')
    await user.click(jump('Previous page'))
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–8 of 1000 entries')
  })

  it('deadens both ends together', async () => {
    const { user } = big()
    // Nothing before page 1.
    expect(jump('First page')).toBeDisabled()
    expect(jump('Previous page')).toBeDisabled()
    expect(jump('Next page')).toBeEnabled()
    expect(jump('Last page')).toBeEnabled()

    await user.click(jump('Last page'))
    expect(jump('Next page')).toBeDisabled()
    expect(jump('Last page')).toBeDisabled()
    expect(jump('First page')).toBeEnabled()
    expect(jump('Previous page')).toBeEnabled()
  })

  it('keeps its shape when a filter collapses the table to one page', async () => {
    const { user } = big()
    await user.click(jump('Last page'))

    // A search that leaves one page has to clamp the current page with it, or
    // the pager points at a page the table no longer has.
    await user.type(screen.getByLabelText('Search records'), 'Tunc')
    expect(pageNums()).toEqual(['1'])
    expect(jump('First page')).toBeDisabled()
    expect(jump('Last page')).toBeDisabled()
  })

  it('names itself as a landmark and carries the glyphs as decoration', () => {
    big()
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    // The « ‹ › » are aria-hidden: the accessible name is on the button, so a
    // screen reader says "Last page", not "right-pointing double angle".
    expect(within(nav).getByRole('button', { name: 'Last page' })).toHaveTextContent('»')
    expect(nav.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
  })
})

describe('expand and collapse', () => {
  it('opens the detail panes for a row and closes them again', async () => {
    const { user } = setup()
    const toggles = screen.getAllByRole('button', { name: 'Toggle details' })
    await user.click(toggles[0])

    expect(screen.getByText('Record ID')).toBeInTheDocument()
    expect(screen.getByText('REC-4813')).toBeInTheDocument()
    expect(screen.getByText('Last activity')).toBeInTheDocument()
    // and the values are the prototype's, unedited. "Unassigned" is the owner
    // this port writes on a *freshly saved draft*; the seed row picking it up
    // would quietly make the demo set say something the design never did.
    expect(screen.getByText('Amelia Hart', { selector: '.dt-pane-value' })).toBeInTheDocument()
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggles[0])
    expect(screen.queryByText('Record ID')).not.toBeInTheDocument()
  })

  it('shows the email in the pane, where the column used to be', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[0])

    // PORT ADDITION: `favouriteSeason` took the column; email moved down here
    // and shares row 1 with the other short values.
    expect(screen.getByText('Email', { selector: '.dt-pane-label' })).toBeInTheDocument()
    expect(screen.getByText('tyanik@yopmail.com')).toBeInTheDocument()
    // and the note keeps the rest of row 2, so no cell is left ragged
    expect(document.querySelector('.dt-pane-rest .dt-pane-label')).toHaveTextContent('Note')
  })

  it('lets several rows stay open at once', async () => {
    const { user } = setup()
    const toggles = screen.getAllByRole('button', { name: 'Toggle details' })
    await user.click(toggles[0])
    await user.click(toggles[1])
    expect(screen.getAllByText('Record ID')).toHaveLength(2)
  })

  it('keeps expansion across paging', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[0])
    await user.click(pageBtn(2))
    expect(screen.queryByText('Record ID')).not.toBeInTheDocument()
    await user.click(pageBtn(1))
    expect(screen.getByText('Record ID')).toBeInTheDocument()
  })

  it('unmounts the pane through the fallback timer when animationend never arrives', async () => {
    // jsdom never fires `animationend`, which is exactly the case the 400ms
    // fallback exists for: the pane stays mounted while it animates out, then
    // the timer unmounts it.
    const user = userEvent.setup()
    render(<DataTable motion="always" />)
    const toggle = screen.getAllByRole('button', { name: 'Toggle details' })[0]

    await user.click(toggle)
    expect(screen.getByText('Record ID')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByText('Record ID')).toBeInTheDocument()
    expect(document.querySelector('.dt-detail-grid')).toHaveClass('dt-collapsing')

    await waitFor(() => expect(screen.queryByText('Record ID')).not.toBeInTheDocument(), {
      timeout: 2000,
    })
  })
})

describe('delete', () => {
  it('asks for confirmation before removing a row', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])

    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete' })).toBeInTheDocument()
    expect(rowNames()).toContain('Tunc Yanik')

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(rowNames()).not.toContain('Tunc Yanik')
    expect(stat('Total')).toBe('16')
  })

  it('puts the confirm in the pencil slot so a second click where the trash was cancels', async () => {
    const { user } = setup()
    const row = screen.getByText('Tunc Yanik', { selector: '.dt-name-text' }).closest('tr')!
    const before = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    await user.click(within(row).getByRole('button', { name: 'Delete record' }))
    const after = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))

    expect(before.slice(-2)).toEqual(['Edit record', 'Delete record'])
    expect(after.slice(-2)).toEqual(['Confirm delete', 'Cancel delete'])
  })

  it('backs out of a pending delete on any other interaction', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[1])
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
    expect(rowNames()).toContain('Tunc Yanik')
  })

  it('Escape cancels the pending delete', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
  })

  it('clears the deleted row out of the selection', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(stat('Selected')).toBe('1')
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(stat('Selected')).toBe('0')
  })
})

describe('inline editing', () => {
  const armFirstRow = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
  }

  it('arms the row, then a field, then commits on Enter', async () => {
    const { user } = setup()
    await armFirstRow(user)
    expect(screen.getAllByRole('button', { name: 'Done editing' })).toHaveLength(1)

    await user.click(byTitle('Edit Name'))
    const input = screen.getByLabelText('Edit Name')
    await user.clear(input)
    await user.type(input, 'Renamed Person{Enter}')

    expect(screen.getByText('Renamed Person', { selector: '.dt-name-text' })).toBeInTheDocument()
  })

  it('refuses to blank a field', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(byTitle('Edit Name'))
    const input = screen.getByLabelText('Edit Name')
    await user.clear(input)
    await user.type(input, '   {Enter}')
    expect(screen.getByText('Tunc Yanik', { selector: '.dt-name-text' })).toBeInTheDocument()
  })

  it('Escape discards the edit but keeps the row armed', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(byTitle('Edit Name'))
    const input = screen.getByLabelText('Edit Name')
    await user.clear(input)
    await user.type(input, 'Discarded{Escape}')
    expect(screen.getByText('Tunc Yanik', { selector: '.dt-name-text' })).toBeInTheDocument()
    expect(byTitle('Edit Name')).toBeInTheDocument()
  })

  it('commits when focus leaves the editor', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(byTitle('Edit Address'))
    const input = screen.getByLabelText('Edit Address')
    await user.clear(input)
    await user.type(input, '9 Kestrel Way, Ankara')
    await user.tab()
    expect(screen.getByText('9 Kestrel Way, Ankara')).toBeInTheDocument()
  })

  it('edits the status through the three-way picker and returns to picking', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(byTitle('Edit Status'))
    const picker = screen.getByRole('group', { name: 'Edit Status' })
    await user.click(within(picker).getByRole('button', { name: 'Failed' }))

    const row = screen.getByText('Tunc Yanik', { selector: '.dt-name-text' }).closest('tr')!
    expect(row.querySelector('.dt-pill')).toHaveTextContent('Failed')
    expect(row.querySelector('.dt-pill')).toHaveClass('dt-failed')
    expect(byTitle('Edit Status')).toBeInTheDocument()
  })

  it('edits the favourite season through that same picker, without a pill', async () => {
    const { user } = setup()
    await armFirstRow(user)
    // PORT ADDITION: the picker is generic over ENUM_OPTIONS now, so the second
    // enum column gets it without naming a column anywhere.
    await user.click(byTitle('Edit Favourite season'))
    const picker = screen.getByRole('group', { name: 'Edit Favourite season' })
    await user.click(within(picker).getByRole('button', { name: 'Autumn' }))

    const row = screen.getByText('Tunc Yanik', { selector: '.dt-name-text' }).closest('tr')!
    const cell = row.querySelector('td[data-key="favouriteSeason"]')!
    expect(cell).toHaveTextContent('Autumn')
    // the pill's three colours mean success / in progress / failed; a season
    // painted the same way would claim a meaning it does not have
    expect(cell.querySelector('.dt-pill')).toBeNull()
    expect(byTitle('Edit Favourite season')).toBeInTheDocument()
  })

  it('un-arms the row when the pencil is clicked again', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(screen.getByRole('button', { name: 'Done editing' }))
    expect(byTitle('Edit Name')).toBeNull()
  })

  it('an armed row is not draggable', async () => {
    const { user } = setup()
    const grip = screen
      .getByText('Tunc Yanik', { selector: '.dt-name-text' })
      .closest('tbody')!
      .querySelector('.dt-row-grip')!
    expect(grip).toHaveAttribute('draggable', 'true')
    await armFirstRow(user)
    expect(grip).toHaveAttribute('draggable', 'false')
  })

  it('reports the edited list through onRecordsChange', async () => {
    const onRecordsChange = vi.fn()
    const { user } = setup({ onRecordsChange })
    await armFirstRow(user)
    await user.click(byTitle('Edit Name'))
    await user.clear(screen.getByLabelText('Edit Name'))
    await user.type(screen.getByLabelText('Edit Name'), 'Changed{Enter}')
    expect(onRecordsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'REC-4813', name: 'Changed' })]),
    )
  })
})

describe('draft row', () => {
  const newRecord = () => screen.getByRole('button', { name: 'New record' })

  it('pins an editable row above the page and saves it', async () => {
    const { user } = setup()
    await user.click(newRecord())

    const nameInput = screen.getByLabelText('Name')
    expect(nameInput).toHaveFocus()
    await user.type(nameInput, 'Brand New')
    await user.click(screen.getByRole('button', { name: 'Save record' }))

    expect(rowNames()[0]).toBe('Brand New')
    expect(stat('Total')).toBe('18')
  })

  it('refuses to save without a name', async () => {
    const { user } = setup()
    await user.click(newRecord())
    await user.click(screen.getByRole('button', { name: 'Save record' }))
    expect(screen.getByLabelText('Name')).toHaveClass('dt-invalid')
    expect(stat('Total')).toBe('17')
  })

  it('gives the new record the next id in the series', async () => {
    const onRecordsChange = vi.fn()
    const { user } = setup({ onRecordsChange })
    await user.click(newRecord())
    await user.type(screen.getByLabelText('Name'), 'Brand New{Enter}')
    expect(onRecordsChange.mock.calls[0][0][0]).toMatchObject({
      id: 'REC-4932',
      owner: 'Unassigned',
      activity: 'Just now',
      plan: 'Standard',
      // the draft collects the visible columns, so the season comes from the
      // row and the email — a detail-pane field now — is filled in later
      favouriteSeason: 'Spring',
      email: '',
    })
  })

  it('is discarded by the cross and by Escape', async () => {
    const { user } = setup()
    await user.click(newRecord())
    await user.click(screen.getByRole('button', { name: 'Discard record' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    await user.click(newRecord())
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('holds off the empty state while it is open', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'zzzzz')
    expect(screen.getByText('No records match')).toBeInTheDocument()
    await user.click(newRecord())
    expect(screen.queryByText('No records match')).not.toBeInTheDocument()
  })

  it('survives a status change without leaving the draft', async () => {
    const { user } = setup()
    await user.click(newRecord())
    await user.click(byTitle('Set Status'))
    await user.click(
      within(screen.getByRole('group', { name: 'Edit Status' })).getByRole('button', {
        name: 'Success',
      }),
    )
    expect(byTitle('Set Status')).toHaveTextContent('Success')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('opens on a season and takes no email', async () => {
    const { user } = setup()
    await user.click(newRecord())
    // Both enum cells open on a value: the draft's picker edits in place, it
    // has no empty state to show.
    expect(byTitle('Set Favourite season')).toHaveTextContent('Spring')
    expect(screen.queryByLabelText('Email ID')).toBeNull()

    await user.click(byTitle('Set Favourite season'))
    await user.click(
      within(screen.getByRole('group', { name: 'Edit Favourite season' })).getByRole('button', {
        name: 'Winter',
      }),
    )
    expect(byTitle('Set Favourite season')).toHaveTextContent('Winter')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })
})

describe('reordering', () => {
  it('moves a row with Alt+ArrowDown', async () => {
    const { user } = setup()
    const [first, second] = rowNames()

    const grip = screen.getAllByRole('button', { name: /^Reorder (?!.*column)/ })[0]
    grip.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    expect(rowNames().slice(0, 2)).toEqual([second, first])
  })

  it('a row reorder clears the sort, a column reorder does not', async () => {
    const { user } = setup()
    const sorted = () =>
      screen.getByRole('button', { name: 'Sort by Name' }).closest('th')

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    screen.getByRole('button', { name: /^Reorder Date column/ }).focus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    screen.getAllByRole('button', { name: /^Reorder (?!.*column)/ })[0].focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(sorted()).toHaveAttribute('aria-sort', 'none')
  })

  it('does nothing at the edge of the page', async () => {
    const { user } = setup()
    const before = rowNames()
    const grip = screen.getAllByRole('button', { name: /^Reorder (?!.*column)/ })[0]
    grip.focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(rowNames()).toEqual(before)
  })

  /**
   * PORT: this used to end on a "Reset order" click. That button is gone — the
   * flow block's metric cog has its toolbar slot — and with it the only
   * control that restored `columns` or cleared the sort from the toolbar. What
   * is left is the move itself, and the way back is the way it came: the header
   * cell is keyed by its column, so the `th` node (and the focus inside it)
   * travels with the column and the next press lands on the same grip.
   */
  it('moves a column with Alt+ArrowRight, and Alt+ArrowLeft brings it back', async () => {
    const { user } = setup()
    expect(columnKeys()).toEqual(DEFAULT_KEYS)

    const grip = () => screen.getByRole('button', { name: /^Reorder Name column/ })
    grip().focus()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(columnKeys()).toEqual([
      'date', 'name', 'status', 'solvedCases', 'favouriteSeason', 'address',
    ])

    expect(grip()).toHaveFocus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(columnKeys()).toEqual(DEFAULT_KEYS)
  })
})

describe('html5 drag', () => {
  const dataTransfer = () => ({ dataTransfer: { effectAllowed: '', setData: () => {} } })
  const tbodyOf = (name: string) =>
    screen.getByText(name, { selector: '.dt-name-text' }).closest('tbody') as HTMLElement
  const th = (key: string) =>
    document.querySelector(`th[data-key="${key}"]`) as HTMLElement
  const rowGrip = (name: string) =>
    tbodyOf(name).querySelector('.dt-row-grip') as HTMLElement
  const colGrip = (key: string) => th(key).querySelector('.dt-grip') as HTMLElement

  it('lands a row where it is dropped, and nowhere on the way there', () => {
    setup()
    const [first, second, third] = rowNames()

    fireEvent.dragStart(rowGrip(first), dataTransfer())
    expect(tbodyOf(first)).toHaveClass('dt-dragging')

    // crossing the third row moves nothing — a splice on the way past pulls
    // the target out from under a pointer that has not moved, which is the
    // flicker the drop marker replaces
    aimAtRow(tbodyOf(third), 'after')
    expect(rowNames().slice(0, 3)).toEqual([first, second, third])

    fireEvent.drop(tbodyOf(third).querySelector('td')!)
    expect(rowNames().slice(0, 3)).toEqual([second, third, first])
    expect(tbodyOf(first)).not.toHaveClass('dt-dragging')

    fireEvent.dragEnd(tbodyOf(first).querySelector('tr')!)
  })

  it('lands a column where it is dropped, and nowhere on the way there', () => {
    setup()

    fireEvent.dragStart(colGrip('name'), dataTransfer())
    expect(th('name')).toHaveClass('dt-dragging')

    aimAtColumn(th('solvedCases'), 'after')
    expect(columnKeys()).toEqual(DEFAULT_KEYS)

    fireEvent.drop(th('solvedCases'))
    expect(columnKeys()).toEqual([
      'date', 'status', 'solvedCases', 'name', 'favouriteSeason', 'address',
    ])
    expect(th('name')).not.toHaveClass('dt-dragging')

    fireEvent.dragEnd(th('name'))
  })

  it('takes the side of the cell the pointer is on', () => {
    setup()

    fireEvent.dragStart(colGrip('address'), dataTransfer())
    aimAtColumn(th('date'), 'before')
    fireEvent.drop(th('date'))
    expect(columnKeys()).toEqual([
      'name', 'address', 'date', 'status', 'solvedCases', 'favouriteSeason',
    ])
  })

  /**
   * A column's own two slots are no-ops, so the dead zone around it is about two
   * columns wide — and the gesture starts at the grip, on its leading edge.
   * Read on the cursor, leaving that zone leftwards costs half a neighbour and
   * rightwards costs the whole of the dragged column and then half a neighbour,
   * which is what "it takes two steps to go right" is. Reading from the middle
   * of the dragged column takes the grab out of it: one place costs the
   * distance between the two columns' centres, the same measure either way.
   */
  it('costs the same travel to move one place in either direction', () => {
    setup()
    const box = {
      first: { left: 0, right: 200, width: 200 },
      second: { left: 200, right: 400, width: 200 },
      third: { left: 400, right: 600, width: 200 },
    }

    // `name`, taken 10px in. 199px of travel is not a move yet...
    dragStartAt(colGrip('name'), th('name'), box.first, { clientX: 10 })
    dragOverWithin(th('date'), th('date'), box.second, { clientX: 209 })
    fireEvent.drop(th('date'))
    expect(columnKeys()).toEqual(DEFAULT_KEYS)

    // ...200px, one column, is. Read on the cursor this needed 290 — the rest
    // of `name` and then half of `date`.
    dragStartAt(colGrip('name'), th('name'), box.first, { clientX: 10 })
    dragOverWithin(th('date'), th('date'), box.second, { clientX: 210 })
    fireEvent.drop(th('date'))
    expect(columnKeys()).toEqual([
      'date', 'name', 'status', 'solvedCases', 'favouriteSeason', 'address',
    ])

    // and back: `status` taken 10px in at 410, landing on the same boundary at
    // 209 — 201px, the same column's width approached from the other side
    dragStartAt(colGrip('status'), th('status'), box.third, { clientX: 410 })
    dragOverWithin(th('name'), th('name'), box.second, { clientX: 209 })
    fireEvent.drop(th('name'))
    expect(columnKeys()).toEqual([
      'date', 'status', 'name', 'solvedCases', 'favouriteSeason', 'address',
    ])
  })

  it('commits nothing when the drop lands where the marker never settled', () => {
    setup()

    fireEvent.dragStart(colGrip('name'), dataTransfer())
    // straight to a drop, with no dragover to choose a slot
    fireEvent.drop(th('address'))
    expect(columnKeys()).toEqual(DEFAULT_KEYS)
    expect(document.querySelectorAll('.dt-dragging')).toHaveLength(0)
  })

  it('a row drag clears the sort; a column drag does not', () => {
    setup()
    const sorted = () => screen.getByRole('button', { name: 'Sort by Name' }).closest('th')

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.dragStart(colGrip('date'), dataTransfer())
    aimAtColumn(th('status'), 'after')
    fireEvent.drop(th('status'))
    fireEvent.dragEnd(th('date'))
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    const [first, second] = rowNames()
    fireEvent.dragStart(rowGrip(first), dataTransfer())
    aimAtRow(tbodyOf(second), 'after')
    fireEvent.drop(tbodyOf(second).querySelector('td')!)
    fireEvent.dragEnd(tbodyOf(first).querySelector('tr')!)
    expect(sorted()).toHaveAttribute('aria-sort', 'none')
  })

  it('ignores a drag that starts on the draft row', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'New record' }))
    const draft = document.querySelector('tbody[data-id="__draft__"]') as HTMLElement
    fireEvent.dragStart(draft.querySelector('tr')!, dataTransfer())
    expect(document.querySelectorAll('.dt-dragging')).toHaveLength(0)
  })

  it('starts no drag from the body of a row or a header', () => {
    setup()
    const [first] = rowNames()

    fireEvent.dragStart(tbodyOf(first).querySelector('td[data-row]')!, dataTransfer())
    expect(document.querySelectorAll('.dt-dragging')).toHaveLength(0)

    fireEvent.dragStart(screen.getByRole('button', { name: 'Sort by Name' }), dataTransfer())
    expect(document.querySelectorAll('.dt-dragging')).toHaveLength(0)

    // and the cell body is not marked draggable in the first place
    expect(tbodyOf(first).querySelector('tr')).not.toHaveAttribute('draggable')
    expect(th('name')).not.toHaveAttribute('draggable')
  })

  it('drags the whole row as the drag image, not the grip glyph', () => {
    setup()
    const [first] = rowNames()
    const setDragImage = vi.fn()
    fireEvent.dragStart(rowGrip(first), {
      dataTransfer: { effectAllowed: '', setData: () => {}, setDragImage },
    })
    expect(setDragImage).toHaveBeenCalledWith(
      tbodyOf(first).querySelector('tr'),
      expect.any(Number),
      expect.any(Number),
    )
  })
})

/**
 * PORT ADDITION: dragging a column out of the header and into the filter dock.
 *
 * jsdom has no drag and drop — no pointer, no drag image, and no DataTransfer
 * at all — so the gesture is driven event by event against a stub that records
 * what the grip writes into it. What is under test here is the state
 * transition; the pointer half of it is verified by hand in a browser.
 */
describe('the dock drop', () => {
  const th = (key: string) => document.querySelector(`th[data-key="${key}"]`) as HTMLElement
  const colGrip = (key: string) => th(key).querySelector('.dt-grip') as HTMLElement

  /** Enough of a DataTransfer for the grip to write to and the dock to read. */
  const transfer = () => {
    const held: Record<string, string> = {}
    return {
      effectAllowed: '',
      dropEffect: '',
      types: [] as string[],
      setData(type: string, value: string) {
        held[type] = value
        this.types.push(type)
      },
      getData: (type: string) => held[type] ?? '',
    }
  }

  it('arms on dragstart and turns the dropped column into a chip', () => {
    setup()
    const dt = transfer()

    fireEvent.dragStart(colGrip('status'), { dataTransfer: dt })
    // the private MIME type, so a column drag is never mistaken for the text
    // the browser lets you drag out of a cell
    expect(dt.getData(COLUMN_DRAG_MIME)).toBe('status')
    // "copyMove": the header reorder is the move, the dock drop is the copy —
    // a dropEffect outside effectAllowed is reset to none and the drop refused
    expect(dt.effectAllowed).toBe('copyMove')
    expect(dock()).toHaveClass('dt-armed')

    fireEvent.dragEnter(dock(), { dataTransfer: dt })
    expect(dock()).toHaveClass('dt-over')

    fireEvent.drop(dock(), { dataTransfer: dt })
    fireEvent.dragEnd(colGrip('status'))

    expect(chip('Status')).toBeInTheDocument()
    expect(dock()).not.toHaveClass('dt-over')
    expect(dock()).not.toHaveClass('dt-armed')
    // additive, not a pivot shelf: the header keeps the column it handed over
    expect(columnKeys()).toEqual(DEFAULT_KEYS)
  })

  it('leaves the header order alone on the way up to the dock', () => {
    setup()
    const dt = transfer()

    fireEvent.dragStart(colGrip('name'), { dataTransfer: dt })
    // The trip out of the header crosses its neighbours. That used to move the
    // column one place along per crossing, and this handler had to put the
    // pre-drag order back before adding the chip; now the crossing moves the
    // drop marker and nothing else, so there is nothing to undo.
    aimAtColumn(th('status'), 'after')
    expect(columnKeys()).toEqual(DEFAULT_KEYS)

    fireEvent.drop(dock(), { dataTransfer: dt })
    fireEvent.dragEnd(th('name'))

    expect(columnKeys()).toEqual(DEFAULT_KEYS)
    expect(chip('Name')).toBeInTheDocument()
  })

  it('and leaves the sort alone with it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Date' }))
    const dt = transfer()

    fireEvent.dragStart(colGrip('name'), { dataTransfer: dt })
    aimAtColumn(th('status'), 'after')
    fireEvent.drop(dock(), { dataTransfer: dt })
    fireEvent.dragEnd(th('name'))

    expect(screen.getByRole('button', { name: 'Sort by Date' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  /**
   * The drop lands on the dock, not on the table, so the table's own drop
   * handler never runs and the marker would be left standing over the header.
   * It comes down on the way out instead.
   */
  it('takes the drop marker down when the pointer leaves the table', () => {
    setup()
    const dt = transfer()
    const marker = document.querySelector('.dt-drop-marker') as HTMLElement

    fireEvent.dragStart(colGrip('name'), { dataTransfer: dt })
    aimAtColumn(th('status'), 'after')
    expect(marker.style.display).toBe('block')

    const leaving = createEvent.dragLeave(th('status'))
    Object.defineProperty(leaving, 'relatedTarget', { value: dock() })
    fireEvent(th('status'), leaving)
    expect(marker.style.display).toBe('none')
  })

  /**
   * jsdom has no `DragEvent`, so testing-library falls back to plain `Event`
   * and the `relatedTarget` in an init is dropped on the floor (`dataTransfer`
   * is special-cased back on; `relatedTarget` is not). Build the event and hang
   * the property on it by hand instead.
   */
  const dragLeaveTowards = (target: Node | null) => {
    const event = createEvent.dragLeave(dock())
    Object.defineProperty(event, 'relatedTarget', { value: target })
    fireEvent(dock(), event)
  }

  it('holds the highlight while the pointer crosses the dock', () => {
    setup()
    const dt = transfer()
    fireEvent.dragStart(colGrip('status'), { dataTransfer: dt })
    fireEvent.dragEnter(dock(), { dataTransfer: dt })
    expect(dock()).toHaveClass('dt-over')

    // dragleave fires again for every child the pointer crosses, so only a
    // relatedTarget outside the section is a real exit. Asserted non-null
    // first: `contains(null)` is false, so a renamed child would quietly turn
    // this into the same check the next case already makes.
    const inner = dock().querySelector('.dt-dock-rail')
    expect(inner).not.toBeNull()
    dragLeaveTowards(inner)
    expect(dock()).toHaveClass('dt-over')

    dragLeaveTowards(document.body)
    expect(dock()).not.toHaveClass('dt-over')
  })

  it('unwinds the highlight from a drag that ends somewhere else entirely', () => {
    setup()
    const dt = transfer()
    fireEvent.dragStart(colGrip('status'), { dataTransfer: dt })
    fireEvent.dragEnter(dock(), { dataTransfer: dt })
    expect(dock()).toHaveClass('dt-over')

    // A drag dropped outside the dock sends it no dragleave at all, so the
    // highlight comes off the flag going null rather than off a pointer event.
    fireEvent.dragEnd(colGrip('status'))
    expect(dock()).not.toHaveClass('dt-over')
    expect(dock()).not.toHaveClass('dt-armed')
    expect(chips()).toHaveLength(0)
  })

  it('reads the key off the dataTransfer when the drag did not start here', () => {
    setup()
    const dt = transfer()
    dt.setData(COLUMN_DRAG_MIME, 'address')

    fireEvent.drop(dock(), { dataTransfer: dt })
    expect(chip('Address')).toBeInTheDocument()
  })

  it('refuses a payload that is not one of its columns', () => {
    setup()
    const dt = transfer()
    // getData hands back a bare string, so it is checked before it is trusted
    dt.setData(COLUMN_DRAG_MIME, 'phone')

    fireEvent.drop(dock(), { dataTransfer: dt })
    expect(chips()).toHaveLength(0)
  })

  it('a second drop of the same column changes nothing', () => {
    setup()
    const dt = transfer()
    fireEvent.dragStart(colGrip('status'), { dataTransfer: dt })
    fireEvent.drop(dock(), { dataTransfer: dt })
    fireEvent.dragEnd(colGrip('status'))

    const dt2 = transfer()
    fireEvent.dragStart(colGrip('status'), { dataTransfer: dt2 })
    fireEvent.drop(dock(), { dataTransfer: dt2 })
    fireEvent.dragEnd(colGrip('status'))

    // one chip per column: `between` covers what a second would, and a second
    // enum chip on one column would AND to the empty set
    expect(chips()).toHaveLength(1)
  })
})

describe('cell range', () => {
  const cell = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
  const ranged = () => Array.from(document.querySelectorAll('td.dt-range'))
  const text = (el: Element) => (el.textContent || '').trim()

  /** Press in one cell, sweep to another, let go. */
  const sweep = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.mouseDown(from)
    fireEvent.mouseOver(to)
    fireEvent.mouseUp(document)
  }

  /** Call AFTER setup(): userEvent.setup() installs a clipboard stub of its own. */
  const clipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('selects a rectangle by dragging across the cells', () => {
    setup()
    sweep(cell(0, 0), cell(2, 1))

    expect(ranged()).toHaveLength(6)
    expect(ranged().map(text)).toEqual([
      'Tunc Yanik', '19 August, 2026',
      'Ethan Noah', '04 March, 2026',
      'Amelia Hart', '10 March, 2026',
    ])
  })

  it('selects backwards just as well', () => {
    setup()
    sweep(cell(3, 4), cell(1, 2))
    expect(ranged()).toHaveLength(9)
    expect(cell(1, 2)).toHaveClass('dt-range-t', 'dt-range-l')
    expect(cell(3, 4)).toHaveClass('dt-range-b', 'dt-range-r')
  })

  it('marks only the outer edge of the rectangle', () => {
    setup()
    sweep(cell(0, 0), cell(2, 2))
    // the middle cell carries the fill and none of the four edges
    expect(cell(1, 1)).toHaveClass('dt-range')
    expect(cell(1, 1).className).not.toMatch(/dt-range-[trbl]/)
    expect(cell(0, 1)).toHaveClass('dt-range-t')
    expect(cell(2, 1)).toHaveClass('dt-range-b')
  })

  it('a plain click selects the one cell and leaves it as the active one', () => {
    setup()
    fireEvent.mouseDown(cell(1, 3))
    fireEvent.mouseUp(document)
    expect(ranged()).toHaveLength(1)
    expect(cell(1, 3)).toHaveClass('dt-range-active')
    expect(cell(1, 3)).toHaveFocus()
  })

  it('Shift+click extends from the anchor without moving it', () => {
    setup()
    fireEvent.mouseDown(cell(1, 1))
    fireEvent.mouseUp(document)
    fireEvent.mouseDown(cell(3, 3), { shiftKey: true })
    fireEvent.mouseUp(document)

    expect(ranged()).toHaveLength(9)
    // extending again from the same anchor shrinks it back
    fireEvent.mouseDown(cell(2, 2), { shiftKey: true })
    fireEvent.mouseUp(document)
    expect(ranged()).toHaveLength(4)
  })

  it('walks with the arrow keys and stretches with Shift', () => {
    setup()
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseUp(document)

    fireEvent.keyDown(cell(0, 0), { key: 'ArrowDown' })
    expect(ranged()).toHaveLength(1)
    expect(cell(1, 0)).toHaveClass('dt-range')
    expect(cell(1, 0)).toHaveFocus()

    fireEvent.keyDown(cell(1, 0), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(cell(1, 1), { key: 'ArrowDown', shiftKey: true })
    expect(ranged()).toHaveLength(4)
    expect(cell(2, 1)).toHaveFocus()
  })

  it('stops at the edges of the page', () => {
    setup()
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseUp(document)
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowUp' })
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowLeft' })
    expect(cell(0, 0)).toHaveClass('dt-range')
    expect(ranged()).toHaveLength(1)

    fireEvent.keyDown(cell(0, 0), { key: 'End' })
    expect(cell(0, 5)).toHaveClass('dt-range')
    fireEvent.keyDown(cell(0, 5), { key: 'ArrowRight' })
    expect(ranged()).toHaveLength(1)
    expect(cell(0, 5)).toHaveClass('dt-range')
  })

  it('Ctrl+A takes every cell on the page, Escape drops the lot', () => {
    setup({ rowsPerPage: 4 })
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseUp(document)

    fireEvent.keyDown(cell(0, 0), { key: 'a', ctrlKey: true })
    expect(ranged()).toHaveLength(24) // 4 rows x 6 columns

    fireEvent.keyDown(cell(0, 0), { key: 'Escape' })
    expect(ranged()).toHaveLength(0)
  })

  it('copies the rectangle as tab-separated rows', async () => {
    setup()
    const writeText = clipboard()
    sweep(cell(0, 0), cell(1, 1))
    fireEvent.keyDown(cell(0, 0), { key: 'c', ctrlKey: true })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe(
      'Tunc Yanik\t19 August, 2026\nEthan Noah\t04 March, 2026',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Copied 4 cells')
  })

  it('copies the columns in the order they are on screen', async () => {
    setup()
    const writeText = clipboard()
    // move Name to the right of Date, then take the first two columns
    fireEvent.keyDown(document.querySelector('th[data-key="name"] .dt-grip')!, {
      key: 'ArrowRight',
      altKey: true,
    })
    sweep(cell(0, 0), cell(0, 1))
    fireEvent.keyDown(cell(0, 0), { key: 'c', ctrlKey: true })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe('19 August, 2026\tTunc Yanik')
  })

  it('is dropped by anything that reshuffles the page', async () => {
    const { user } = setup()

    sweep(cell(0, 0), cell(1, 1))
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(ranged()).toHaveLength(0)

    sweep(cell(0, 0), cell(1, 1))
    await user.click(pageBtn(2))
    expect(ranged()).toHaveLength(0)

    sweep(cell(0, 0), cell(1, 1))
    await user.type(screen.getByLabelText('Search records'), 'a')
    expect(ranged()).toHaveLength(0)
  })

  it('survives a checkbox toggle and never touches the bulk count', async () => {
    const { user } = setup()
    sweep(cell(0, 0), cell(2, 1))
    expect(stat('Selected')).toBe('0')

    await user.click(screen.getByRole('button', { name: 'Select Amelia Hart' }))
    expect(stat('Selected')).toBe('1')
    expect(ranged()).toHaveLength(6)
  })

  it('leaves a control inside a cell its click', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[0])
    expect(screen.getAllByText('Owner', { selector: '.dt-pane-label' })).toHaveLength(1)
    expect(ranged()).toHaveLength(0)
  })

  it('but a sweep that starts on one still selects', () => {
    setup()
    const chevron = screen.getAllByRole('button', { name: 'Toggle details' })[0]
    fireEvent.mouseDown(chevron)
    expect(ranged()).toHaveLength(0) // undecided until the pointer leaves
    fireEvent.mouseOver(cell(2, 2))
    fireEvent.mouseUp(document)
    expect(ranged()).toHaveLength(9)
  })

  it('keeps its hands off an open editor', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: /^Edit record/ })[0])
    await user.click(byTitle('Edit Name'))
    const input = document.querySelector('.dt-cell-input') as HTMLInputElement

    fireEvent.mouseDown(input)
    expect(ranged()).toHaveLength(0)
    expect(input).toBeInTheDocument()
  })

  it('is off entirely with cellSelection={false}', () => {
    setup({ cellSelection: false })
    sweep(cell(0, 0), cell(2, 1))
    expect(ranged()).toHaveLength(0)
    expect(cell(0, 0)).not.toHaveAttribute('tabindex')
  })

  it('gives the grid exactly one tab stop', () => {
    setup()
    const stops = document.querySelectorAll('td[data-row][tabindex="0"]')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toBe(cell(0, 0))

    fireEvent.mouseDown(cell(2, 3))
    fireEvent.mouseUp(document)
    expect(document.querySelectorAll('td[data-row][tabindex="0"]')).toHaveLength(1)
    expect(cell(2, 3)).toHaveAttribute('tabindex', '0')
  })
})

/* ---- the whole column (DEV-20) ------------------------------------ *
 * PORT ADDITION. The rectangle above is page-shaped by construction; this is
 * the selection that is not — a triple click on a header label takes that
 * column across every page, and the pages the reader cannot see are the point
 * of it.
 * ------------------------------------------------------------------- */
describe('whole column', () => {
  const cell = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
  const ranged = () => Array.from(document.querySelectorAll<HTMLElement>('td.dt-range'))
  const head = (key: string) => document.querySelector(`th[data-key="${key}"]`) as HTMLElement
  const panel = () => document.querySelector('.dt-sum')
  const shown = () => panel()?.querySelector('.dt-sum-value')?.textContent
  const scope = () => panel()?.querySelector('.dt-sum-scope')?.textContent
  /** Solved cases is the fourth column. */
  const CASES = 3

  const clipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  /**
   * The gesture lands on the label, which is deliberately not a control: the
   * caret beside it is the sort button, and the two were split apart precisely
   * so three clicks here are not three sorts (T-11, DEV-20).
   */
  const label = (key: string) =>
    document.querySelector(`th[data-key="${key}"] .dt-th-label`) as HTMLElement
  const tripleClick = (user: User, key: string) => user.tripleClick(label(key))
  const caret = (key: string) =>
    document.querySelector(`th[data-key="${key}"] .dt-th-sort`) as HTMLElement

  it('takes the column a triple click lands on, and marks its header', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    // eight rows on the page, every one of them in that column and no other
    expect(ranged()).toHaveLength(8)
    expect(ranged().every((el) => el.dataset.col === String(CASES))).toBe(true)
    expect(head('solvedCases')).toHaveClass('dt-col-picked')
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(1)
  })

  it('does not touch the sort on its way to the third click', async () => {
    const { user } = setup()
    // the whole point of splitting the label off the caret: none of the three
    // clicks is a sort, so the column is still unsorted afterwards
    await tripleClick(user, 'name')
    expect(head('name')).not.toHaveClass('dt-is-sorted')
    expect(head('name')).toHaveAttribute('aria-sort', 'none')

    // and a sort the user set deliberately survives the gesture untouched,
    // on the taken column as much as on any other
    await user.click(screen.getByRole('button', { name: 'Sort by Date' }))
    await tripleClick(user, 'name')
    await tripleClick(user, 'date')
    expect(head('date')).toHaveAttribute('aria-sort', 'ascending')
    expect(head('date')).toHaveClass('dt-col-picked')
  })

  it('leaves the label out of the sort entirely', async () => {
    const { user } = setup()

    // one click, two clicks — the old hit area, and now neither sorts
    await user.click(label('name'))
    expect(head('name')).toHaveAttribute('aria-sort', 'none')
    await user.dblClick(label('name'))
    expect(head('name')).toHaveAttribute('aria-sort', 'none')

    // the caret is what sorts, and it still cycles asc -> desc -> unsorted
    await user.click(caret('name'))
    expect(head('name')).toHaveAttribute('aria-sort', 'ascending')
    await user.click(caret('name'))
    expect(head('name')).toHaveAttribute('aria-sort', 'descending')
    await user.click(caret('name'))
    expect(head('name')).toHaveAttribute('aria-sort', 'none')
  })

  it('does not take the column when the third click is on a control', async () => {
    const { user } = setup()

    // three clicks on the caret is three sorts and no selection: the caret is
    // the sort control, and a gesture cannot quietly ride on top of one
    await user.tripleClick(caret('name'))
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
    expect(head('name')).toHaveAttribute('aria-sort', 'none')

    // and the grip belongs to the drag
    await user.tripleClick(
      document.querySelector('th[data-key="name"] .dt-grip') as HTMLElement,
    )
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
  })

  it('survives the page turn, which is the whole point of it', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(ranged()).toHaveLength(8)
    expect(head('solvedCases')).toHaveClass('dt-col-picked')

    // the last page holds one record, and the column is still taken on it
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(ranged()).toHaveLength(1)
  })

  it('closes the selection border only where the selection ends', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    // page one: a top edge, and an open bottom that says it carries on
    expect(cell(0, CASES)).toHaveClass('dt-range-t')
    expect(cell(7, CASES)).not.toHaveClass('dt-range-b')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(cell(0, CASES)).not.toHaveClass('dt-range-t')
    expect(cell(7, CASES)).not.toHaveClass('dt-range-b')

    // the last page is where it really stops
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(cell(0, CASES)).toHaveClass('dt-range-b')
    // the sides are closed on every page — it is one column wide throughout
    expect(cell(0, CASES)).toHaveClass('dt-range-l', 'dt-range-r')
  })

  it('reads the flow block over every page, and says so', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    expect(shown()).toBe('1,481') // all 17, not the 661 on this page
    expect(scope()).toBe('all pages')
  })

  it('drops the badge when one page is all there is', async () => {
    const { user } = setup({ rowsPerPage: 20 })
    await tripleClick(user, 'solvedCases')

    expect(shown()).toBe('1,481')
    expect(scope()).toBeUndefined()
  })

  it('follows the filters rather than the records', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'new york')
    await tripleClick(user, 'solvedCases')

    // 132 My Street and 260 Bay Ridge, both New York: Ethan Noah, Priya
    // Anand, Naomi Castillo and Julien Moreau
    expect(shown()).toBe('464') // 42 + 96 + 261 + 65
  })

  it('copies every row of the column, not the eight on screen', async () => {
    const { user } = setup()
    const writeText = clipboard()
    await tripleClick(user, 'solvedCases')
    fireEvent.keyDown(cell(0, CASES), { key: 'c', ctrlKey: true })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0].split('\n')).toHaveLength(17)
    expect(writeText.mock.calls[0][0]).toMatch(/^128\n42\n7\n/)
    expect(screen.getByRole('status')).toHaveTextContent('Copied 17 cells')
  })

  it('announces the column, its count and its reading', async () => {
    const { user } = setup()
    await tripleClick(user, 'status')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Status column selected, 17 cells across 3 pages. Success rate 47.1%.',
    )
  })

  it('answers Ctrl+Space from the cell that holds focus', () => {
    setup()
    fireEvent.keyDown(cell(2, CASES), { key: ' ', ctrlKey: true })

    expect(ranged()).toHaveLength(8)
    expect(head('solvedCases')).toHaveClass('dt-col-picked')
    // the keyboard route stepped no sort, so it has none to put back
    expect(head('solvedCases')).toHaveAttribute('aria-sort', 'none')
  })

  it('answers Ctrl+Space on the header button too', () => {
    setup()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by Address' }), {
      key: ' ',
      ctrlKey: true,
    })
    expect(head('address')).toHaveClass('dt-col-picked')
  })

  it('is exclusive with the rectangle, in both directions', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    // a press in a cell starts a rectangle and the column goes
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseUp(document)
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
    expect(ranged()).toHaveLength(1)

    // and the other way round
    await tripleClick(user, 'solvedCases')
    expect(ranged()).toHaveLength(8)
    expect(ranged()[0].dataset.col).toBe(String(CASES))
  })

  it('is dropped by a changed record set, and not by a re-sort', async () => {
    const { user } = setup()

    await tripleClick(user, 'solvedCases')
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(head('solvedCases')).toHaveClass('dt-col-picked')

    await user.type(screen.getByLabelText('Search records'), 'hart')
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
  })

  it('gives way to Escape, last in the chain as the rectangle is', async () => {
    const { user } = setup()
    await tripleClick(user, 'solvedCases')

    fireEvent.keyDown(cell(0, 0), { key: 'Escape' })
    expect(ranged()).toHaveLength(0)
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
  })

  it('is off with the rest of the cell selection', async () => {
    const { user } = setup({ cellSelection: false })
    await tripleClick(user, 'solvedCases')

    expect(ranged()).toHaveLength(0)
    expect(document.querySelectorAll('th.dt-col-picked')).toHaveLength(0)
    // and the label says nothing about a gesture that is not there
    expect(label('solvedCases')).not.toHaveAttribute('title')
    // the caret keeps its own job either way
    expect(screen.getByRole('button', { name: 'Sort by Solved cases' })).toBeInTheDocument()
  })
})

/**
 * PORT ADDITION (DEV-22): the Export button writes the file itself.
 *
 * Archive is gone and the slot it left holds the export's own strip — a bar
 * that fills, and then the box that names what it built. The three selections
 * the table can hold all feed the same button, and which one it takes is the
 * narrowest one live: a whole column, else a rectangle, else the checkboxes.
 */
describe('CSV export', () => {
  const cell = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
  const label = (key: string) =>
    document.querySelector(`th[data-key="${key}"] .dt-th-label`) as HTMLElement

  const sweep = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.mouseDown(from)
    fireEvent.mouseOver(to)
    fireEvent.mouseUp(document)
  }

  const exportButton = () => screen.getByRole('button', { name: 'Export' })
  const bar = () => document.querySelector('.dt-export-bar')
  const nameBox = () =>
    screen.queryByLabelText('Name the exported CSV file') as HTMLInputElement | null

  /**
   * The bar takes 900ms of real time to fill, which is short enough to wait out
   * and a great deal less trouble than driving `userEvent` off fake timers.
   */
  const untilNamed = async () => {
    await waitFor(() => expect(nameBox()).not.toBeNull(), { timeout: 3000 })
    return nameBox() as HTMLInputElement
  }

  /** jsdom's Blob has no `text()`; FileReader is the route it does implement. */
  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })

  /**
   * jsdom implements neither `URL.createObjectURL` nor a navigating `click`, so
   * both are stood up here — and both are what the assertions read: the Blob
   * for the bytes, the anchor's `download` for the name.
   */
  const harness = () => {
    const blobs: Blob[] = []
    const names: string[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:dt-test'
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => {},
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download)
      })
    return {
      names,
      count: () => blobs.length,
      // the BOM is for Excel, not for the assertions
      text: async () =>
        (await readBlob(blobs[blobs.length - 1])).replace(/^\uFEFF/, ''),
      restore: () => click.mockRestore(),
    }
  }

  const HEADER = 'Name,Date,Status,Solved cases,Favourite season,Address'
  /**
   * Written out here rather than imported from csv.ts, so the expectations are
   * not the implementation restated. Every date in the demo set reads
   * "19 August, 2026" and so goes out quoted — which is the point of spelling
   * the rule out in a flow test at all.
   */
  const quoted = (value: string) => (value.includes(',') ? `"${value}"` : value)
  const asRow = (r: DataTableRecord) =>
    [r.name, r.date, r.status, r.solvedCases, r.favouriteSeason, r.address]
      .map(quoted)
      .join(',')

  it('opens the bar out of the pager, then turns it into a name box', async () => {
    const io = harness()
    const { user } = setup()
    const strip = document.querySelector('.dt-foot-export') as HTMLElement
    // shut, so Export is against the pager
    expect(strip).not.toHaveClass('dt-open')

    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())

    // the strip is what opens — the bar is its whole width, and the width is
    // the progress, so Export is walked left as it fills
    expect(strip).toHaveClass('dt-open')
    expect(bar()).not.toBeNull()
    expect(bar()!.parentElement).toBe(strip)
    expect(bar()).toHaveAttribute('role', 'progressbar')
    expect(Number(bar()!.getAttribute('aria-valuenow'))).toBeLessThan(100)

    const box = await untilNamed()
    // the bar became the box: one strip, one child, never both at once
    expect(bar()).toBeNull()
    expect(strip).toHaveClass('dt-open')
    expect(strip.children).toHaveLength(1)
    expect(box.value).toBe('data-table-1-record')
    expect(box).toHaveFocus()
    // and the suggestion is selected, so typing replaces it
    expect(box.selectionStart).toBe(0)
    expect(box.selectionEnd).toBe(box.value.length)
    expect(document.querySelector('.dt-export-ext')).toHaveTextContent('.csv')
    io.restore()
  })

  it('writes the checked rows, every column, under a header row', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    await untilNamed()
    await user.click(screen.getByRole('button', { name: 'Save data-table-1-record.csv' }))

    expect(io.names).toEqual(['data-table-1-record.csv'])
    expect(await io.text()).toBe([HEADER, asRow(createDemoRecords()[0])].join('\r\n'))
    // the strip is shut again — with motion off there is no slide to sit
    // through — so Export is back against the pager and pressable
    const strip = document.querySelector('.dt-foot-export') as HTMLElement
    expect(strip.children).toHaveLength(0)
    expect(strip).not.toHaveClass('dt-open', 'dt-closing')
    expect(exportButton()).toBeEnabled()
    io.restore()
  })

  it('slides the strip back out on the save rather than snapping it shut', async () => {
    const io = harness()
    const user = userEvent.setup()
    render(<DataTable motion="always" />)
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    await untilNamed()
    await user.keyboard('{Enter}')

    // the file is already written; what is left is the bar showing itself out,
    // carrying Export back to the pager with it
    const strip = document.querySelector('.dt-foot-export') as HTMLElement
    expect(io.names).toEqual(['data-table-1-record.csv'])
    expect(strip).toHaveClass('dt-closing')
    expect(strip).not.toHaveClass('dt-open')
    expect(strip.querySelector('.dt-export-bar')).not.toBeNull()
    // and it is not a state anything can be done to: no name box, no progress
    expect(nameBox()).toBeNull()
    expect(strip.querySelector('[role="progressbar"]')).toBeNull()

    await waitFor(() => expect(strip.children).toHaveLength(0))
    expect(strip).not.toHaveClass('dt-closing')
    expect(exportButton()).toBeEnabled()
    io.restore()
  })

  it('saves under the typed name, with exactly one .csv on it', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    const box = await untilNamed()

    await user.clear(box)
    await user.type(box, 'Q3 report.csv')
    // Enter is the whole gesture — no reaching for the tick
    await user.keyboard('{Enter}')
    expect(io.names).toEqual(['Q3 report.csv'])
    io.restore()
  })

  it('takes the selected cells over the checked rows when both are live', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    // name + date, over the first three rows
    sweep(cell(0, 0), cell(2, 1))

    await user.click(exportButton())
    const box = await untilNamed()
    expect(box.value).toBe('data-table-cells')

    await user.keyboard('{Enter}')
    const rows = createDemoRecords().slice(0, 3)
    expect(await io.text()).toBe(
      ['Name,Date', ...rows.map((r) => `${r.name},${quoted(r.date)}`)].join('\r\n'),
    )
    expect(io.names).toEqual(['data-table-cells.csv'])
    io.restore()
  })

  it('takes a whole column across every page, not just the eight on screen', async () => {
    const io = harness()
    const { user } = setup()
    await user.tripleClick(label('solvedCases'))

    await user.click(exportButton())
    const box = await untilNamed()
    expect(box.value).toBe('data-table-solved-cases')

    await user.keyboard('{Enter}')
    const all = createDemoRecords()
    expect(all).toHaveLength(17)
    expect(await io.text()).toBe(
      ['Solved cases', ...all.map((r) => r.solvedCases)].join('\r\n'),
    )
    io.restore()
  })

  it('exports what was selected at the press, not what is selected at the save', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    // the bar is still filling; tick another row under it
    await user.click(screen.getByRole('button', { name: 'Select Ethan Noah' }))

    await untilNamed()
    await user.keyboard('{Enter}')
    expect(await io.text()).toBe([HEADER, asRow(createDemoRecords()[0])].join('\r\n'))
    io.restore()
  })

  it('reports the export through onExport at the save, not at the press', async () => {
    const io = harness()
    const onExport = vi.fn()
    const { user } = setup({ onExport })
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    expect(onExport).not.toHaveBeenCalled()

    await untilNamed()
    await user.keyboard('{Enter}')
    expect(onExport).toHaveBeenCalledWith([expect.objectContaining({ name: 'Tunc Yanik' })])
    io.restore()
  })

  it('will not start a second export over the first', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    expect(exportButton()).toBeDisabled()
    await untilNamed()
    expect(exportButton()).toBeDisabled()
    io.restore()
  })

  it('offers a cancel beside the save, and writes nothing when it is pressed', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    await untilNamed()

    // save then discard, in the draft row's order
    const box = document.querySelector('.dt-export-name') as HTMLElement
    expect(
      Array.from(box.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Save data-table-1-record.csv', 'Cancel the export'])

    await user.click(screen.getByRole('button', { name: 'Cancel the export' }))
    expect(nameBox()).toBeNull()
    expect(io.count()).toBe(0)
    expect(document.querySelector('[role="status"]')).toHaveTextContent('Export cancelled.')
    // the selection it was about is untouched, so it can simply be pressed again
    expect(stat('Selected')).toBe('1')
    expect(exportButton()).toBeEnabled()
    io.restore()
  })

  it('drops the whole thing on Escape, without writing a file', async () => {
    const io = harness()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    const box = await untilNamed()

    await user.type(box, '{Escape}')
    expect(nameBox()).toBeNull()
    expect(io.count()).toBe(0)
    // Escape reached the export and stopped there — the row is still checked
    expect(stat('Selected')).toBe('1')
    expect(exportButton()).toBeEnabled()
    io.restore()
  })

  it('leaves the cell selection standing behind the name box', async () => {
    const io = harness()
    const { user } = setup()
    sweep(cell(0, 0), cell(1, 0))
    await user.click(exportButton())
    await untilNamed()
    // pressing Export is not a click in the grid, so the rectangle it is about
    // is still painted while the box asks for a name
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(2)
    io.restore()
  })

  it('says what it is doing at each step', async () => {
    const io = harness()
    const { user } = setup()
    const live = () => document.querySelector('[role="status"]')!.textContent
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(exportButton())
    expect(live()).toBe('Preparing 6 cells for export.')

    await untilNamed()
    // the box is mounted a commit before the effect that announces it
    await waitFor(() =>
      expect(live()).toBe('Export ready. Name the file and press Enter to save it.'),
    )

    await user.keyboard('{Enter}')
    expect(live()).toBe('Saved data-table-1-record.csv.')
    io.restore()
  })
})

/**
 * The block as it was before it could be asked anything but a total: Sum is
 * still what a rectangle of numbers reads as out of the box, so every rule
 * below is still the shipped default. The preferences that can move it, the
 * other twelve metrics and the block's own DOM are the sibling "flow block"
 * describe.
 */
describe('sum readout', () => {
  const cell = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
  const panel = () => document.querySelector('.dt-sum')
  const shown = () => panel()?.querySelector('.dt-sum-value')?.textContent
  /** Solved cases is the fourth column. */
  const CASES = 3

  const sweep = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.mouseDown(from)
    fireEvent.mouseOver(to)
    fireEvent.mouseUp(document)
  }

  /** The demo set with the case counts replaced, for the awkward values. */
  const withCases = (values: string[]): DataTableRecord[] =>
    createDemoRecords()
      .slice(0, values.length)
      .map((record, i) => ({ ...record, solvedCases: values[i] }))

  it('adds up a run of the Solved cases column', () => {
    setup()
    expect(panel()).toBeNull()

    sweep(cell(0, CASES), cell(2, CASES))
    expect(shown()).toBe('177') // 128 + 42 + 7
  })

  it('stays away when anything in the selection is not a number', () => {
    setup()
    sweep(cell(0, 0), cell(2, 1))
    expect(panel()).toBeNull()

    // one text column caught alongside the numbers is enough
    sweep(cell(0, 2), cell(2, CASES))
    expect(panel()).toBeNull()
  })

  it('does not call one cell a sum', () => {
    setup()
    fireEvent.mouseDown(cell(0, CASES))
    fireEvent.mouseUp(document)
    expect(panel()).toBeNull()

    fireEvent.keyDown(cell(0, CASES), { key: 'ArrowDown', shiftKey: true })
    expect(shown()).toBe('170') // 128 + 42
  })

  it('adds floats without dragging their noise onto the screen', () => {
    setup({ records: withCases(['0.1', '0.2', '1.25']) })
    sweep(cell(0, CASES), cell(1, CASES))
    expect(shown()).toMatch(/^0[.,]3$/)

    sweep(cell(0, CASES), cell(2, CASES))
    expect(shown()).toMatch(/^1[.,]55$/)
  })

  it('skips blanks the way a spreadsheet does', () => {
    setup({ records: withCases(['10', '', '20']) })
    sweep(cell(0, CASES), cell(2, CASES))
    expect(shown()).toBe('30')
  })

  it('needs two real numbers among the blanks', () => {
    setup({ records: withCases(['10', '', '']) })
    sweep(cell(0, CASES), cell(2, CASES))
    expect(panel()).toBeNull()
  })

  it('goes away when the selection does', () => {
    setup()
    sweep(cell(0, CASES), cell(2, CASES))
    expect(panel()).not.toBeNull()

    fireEvent.keyDown(cell(0, CASES), { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('reaches the live region too, since the panel is aria-hidden', () => {
    setup()
    expect(panel).toBeTruthy()
    fireEvent.mouseDown(cell(0, CASES))
    fireEvent.mouseUp(document)
    fireEvent.keyDown(cell(0, CASES), { key: 'ArrowDown', shiftKey: true })

    expect(document.querySelector('.dt-sum')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Sum 170')
  })

  it('sits in the toolbar, immediately before the cog that sets it', () => {
    setup()
    sweep(cell(0, CASES), cell(2, CASES))

    const block = panel() as HTMLElement
    expect(block.closest('.dt-toolbar')).not.toBeNull()
    expect(block.nextElementSibling).toHaveClass('dt-metric')
    // and it is after the spacer, so the buttons beside it never move
    expect(block.previousElementSibling).toHaveClass('dt-spacer')
  })

  it('is held on screen long enough to fade out', async () => {
    // jsdom runs no animations; what is under test is that the panel stays
    // mounted for the length of the fade and then goes on its own.
    render(<DataTable motion="always" />)
    sweep(cell(0, CASES), cell(2, CASES))
    expect(panel()).not.toHaveClass('dt-out')

    fireEvent.keyDown(cell(0, CASES), { key: 'Escape' })
    expect(shown()).toBe('177')
    expect(panel()).toHaveClass('dt-out')

    await waitFor(() => expect(panel()).toBeNull(), { timeout: 2000 })
  })

  it('a new total during that fade cancels it', () => {
    render(<DataTable motion="always" />)
    sweep(cell(0, CASES), cell(2, CASES))
    fireEvent.keyDown(cell(0, CASES), { key: 'Escape' })
    expect(panel()).toHaveClass('dt-out')

    sweep(cell(1, CASES), cell(2, CASES))
    expect(panel()).not.toHaveClass('dt-out')
    expect(shown()).toBe('49') // 42 + 7
  })

  it('goes without the fade when motion is off', () => {
    setup() // motion="never"
    sweep(cell(0, CASES), cell(2, CASES))
    fireEvent.keyDown(cell(0, CASES), { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('sorts the column as numbers, not as text', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Sort by Solved cases' }))
    expect(rowNames().slice(0, 4)).toEqual([
      'Clara Whitfield', // 3
      'Amelia Hart', // 7
      'Ruth Abebe', // 12
      'Sofia Lindqvist', // 18
    ])
  })

  it('leaves the lexicographic sort alone everywhere else', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Sort by Date' }))
    // April still sorts above March, because "02" sorts above "04" — the
    // prototype's wart, and untouched by the numeric comparator
    expect(rowNames()[0]).toBe('Priya Anand') // 02 April, 2026
  })
})

/**
 * PORT ADDITION: the same block, asked something other than "what do these add
 * up to".
 *
 * The toolbar's metric cog does not pick the metric. It holds a *set* of
 * preferences per *kind* of cell content — numbers, Status values, Favourite
 * season values — and the rectangle decides which set answers: sweep a column
 * of counts and the number metrics read them, sweep a column of statuses and
 * the status ones do, with nothing set in between. A rectangle can no longer be
 * the wrong kind for the metric on show, which is the dead end this shape of the
 * control removes.
 *
 * A set can hold as many metrics as the reader wants on screen, and the block
 * prints one reading per metric — so a run of counts can read Sum, Mean and
 * Highest at once. The one thing the panel refuses is emptying a set: the last
 * ticked option of a kind is `aria-disabled` and its press does nothing.
 *
 * The arithmetic is unit-tested in metrics.test.ts and is not re-derived here.
 * What these cover is the wiring: which preference a rectangle puts in force,
 * the state that survives a pick, the DOM the block renders, the selector's own
 * keyboard, and what the live region says.
 *
 * The class names are still the sum's (`dt-sum*`). They named the one thing the
 * block could say when it grew, and renaming them would buy nothing.
 */
describe('flow block', () => {
  const cell = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
  const ranged = () => Array.from(document.querySelectorAll('td.dt-range'))
  const text = (el: Element) => (el.textContent || '').trim()

  const panel = () => document.querySelector('.dt-sum')
  /** One reading — a tag, a figure, and a rate's count — per metric on show. */
  const items = () => Array.from(panel()?.querySelectorAll('.dt-sum-item') || [])
  const tag = () => panel()?.querySelector('.dt-sum-tag')?.textContent
  const shown = () => panel()?.querySelector('.dt-sum-value')?.textContent
  /** The muted "(5 of 8)". Only rates have one. */
  const note = () => panel()?.querySelector('.dt-sum-note')?.textContent
  /** Every reading in the strip, tag and figure, left to right. */
  const readings = () =>
    items().map((item) => [
      item.querySelector('.dt-sum-tag')?.textContent,
      item.querySelector('.dt-sum-value')?.textContent,
    ])

  /** The three columns these read: Status, Solved cases, Favourite season. */
  const STATUS = 2
  const CASES = 3
  const SEASON = 4

  const sweep = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.mouseDown(from)
    fireEvent.mouseOver(to)
    fireEvent.mouseUp(document)
  }

  /** The selector, by its accessible name — "Showing <the metric in force>". */
  const showButton = () => screen.getByRole('button', { name: /^Showing/ })
  /**
   * The metrics the selector says are in force, as it words them. Read off the
   * accessible name and not the button's words, because a cog has none
   * (DEV-18): the reading is the flow block's to print, and the button carries
   * it for a screen reader and in its tooltip. `shown()` above is the block's
   * own answer — the number — and these two are the two halves the pair is
   * there to keep in step.
   */
  const showing = () =>
    /^Showing (.+?)\./.exec(showButton().getAttribute('aria-label') || '')?.[1]
  /** Its panel. Reached by class: the dock's chip popups are dialogs too. */
  const pop = () => document.querySelector('.dt-metric-pop')
  /** A category row — the button that opens the metrics filed under it. */
  const category = (name: string) =>
    screen.getByRole('button', { name: new RegExp(`^${name}( —|$)`) })
  /**
   * A category row's own word. Its `textContent` also holds the caret glyph and,
   * on the row in force, the screen-reader note — both deliberate, and neither
   * the name of the kind.
   */
  const catName = (el: Element) => (el.querySelector('span')?.firstChild?.textContent || '').trim()
  /**
   * Which categories are showing their metrics. One at a time, or none. Scoped
   * to the panel: the cog itself is an `aria-expanded` button too, and it is
   * open whenever any of this is on screen.
   */
  const showingCategories = () =>
    Array.from(pop()?.querySelectorAll('[aria-expanded="true"]') || []).map(catName)

  /** One option row of the cog's panel, by its words. */
  const option = (name: string) => screen.getByRole('option', { name })

  /**
   * Get to one metric: open the panel, open the kind that holds it. Picking
   * deliberately leaves both open so a second metric can be set in the same
   * visit, so this opens only what is shut — and expanding a second kind
   * collapses the first, which is why the option is looked for after the
   * category is opened rather than before.
   */
  const reveal = async (user: User, metric: string) => {
    if (!pop()) await user.click(showButton())
    if (!screen.queryByRole('option', { name: metric })) {
      for (const name of ['Numbers', 'Status', 'Favourite season']) {
        await user.click(category(name))
        if (screen.queryByRole('option', { name: metric })) break
      }
    }
  }

  /** Tick or untick one metric — the press itself, exactly as a user makes it. */
  const pick = async (user: User, metric: string) => {
    await reveal(user, metric)
    await user.click(option(metric))
  }

  /**
   * Leave a kind reading exactly one metric: tick the one asked for if it is
   * not already on, then untick every other one in its section.
   *
   * Almost every test below is about *what a figure reads*, and says so most
   * plainly with one figure on screen. A bare `pick` cannot say it any more —
   * the options are a multi-select, so ticking Mean leaves Sum ticked beside it
   * and the block reading two things. This is the two or three presses that
   * would take, written once.
   */
  const only = async (user: User, metric: string) => {
    await reveal(user, metric)
    if (option(metric).getAttribute('aria-selected') !== 'true') {
      await user.click(option(metric))
    }
    const others = Array.from(
      option(metric).closest('ul')?.querySelectorAll('[aria-selected="true"]') || [],
    )
      .map((el) => (el.textContent || '').trim())
      .filter((name) => name !== metric)
    for (const name of others) await user.click(option(name))
  }

  /** The demo set with the case counts replaced, for the awkward values. */
  const withCases = (values: string[]): DataTableRecord[] =>
    createDemoRecords()
      .slice(0, values.length)
      .map((record, i) => ({ ...record, solvedCases: values[i] }))

  it('opens on Sum, which is all the block could say before the selector', () => {
    setup()
    expect(showing()).toBe('Sum')
    expect(panel()).toBeNull()

    sweep(cell(0, CASES), cell(2, CASES))
    expect(tag()).toBe('SUM')
    expect(shown()).toBe('177') // 128 + 42 + 7
    // no muted count: that belongs to the rates, which are shares of something
    expect(panel()!.querySelector('.dt-sum-note')).toBeNull()
  })

  /**
   * The strip scrolls rather than the block growing. Six metrics at once come to
   * more than the toolbar has to give, and the block used to answer that by
   * getting wider until the page itself scrolled.
   *
   * jsdom lays nothing out — every width it reports is 0 — so the measure is fed
   * the numbers a browser would have given it. What that leaves genuinely under
   * test is the part that is ours: what the component does with an overflowing
   * strip, not whether a browser can overflow one.
   */
  describe('the strip when it will not fit', () => {
    const strip = () => panel()?.querySelector('.dt-sum-strip') as HTMLElement

    const measured = (el: HTMLElement, scrollWidth: number, clientWidth: number, at = 0) => {
      for (const [name, value] of [
        ['scrollWidth', scrollWidth],
        ['clientWidth', clientWidth],
        ['scrollLeft', at],
      ] as const) {
        Object.defineProperty(el, name, { value, configurable: true, writable: true })
      }
    }

    it('is hidden and holds no tab stop while the whole strip is on screen', () => {
      setup()
      sweep(cell(0, CASES), cell(2, CASES))

      // Exactly the tree it has always had: the figures are the live region's
      // to say, and nothing here is reachable or worth reaching.
      expect(panel()).toHaveAttribute('aria-hidden', 'true')
      expect(panel()).not.toHaveAttribute('data-dt-flow-more')
      expect(strip()).not.toHaveAttribute('tabindex')
    })

    it('takes a name and a tab stop once there is an edge to reach', () => {
      setup()
      sweep(cell(0, CASES), cell(2, CASES))

      measured(strip(), 600, 200)
      fireEvent(window, new Event('resize'))

      // A hidden element must never hold a tab stop, so the slab comes back
      // into the tree to carry one…
      expect(panel()).not.toHaveAttribute('aria-hidden')
      expect(strip()).toHaveAttribute('tabindex', '0')
      expect(strip()).toHaveAccessibleName(
        'What the selection reads as — scroll for the rest',
      )
      // …and the readings stay out of it regardless. The name is what the tab
      // stop is for; the figures are still spoken by the live region.
      expect(strip().querySelector('.dt-sum-line')).toHaveAttribute('aria-hidden', 'true')
      expect(strip()).toHaveTextContent('177')
    })

    it('says which edge the rest of it is behind', () => {
      setup()
      sweep(cell(0, CASES), cell(2, CASES))

      measured(strip(), 600, 200)
      fireEvent(window, new Event('resize'))
      expect(panel()).toHaveAttribute('data-dt-flow-more', 'end')

      measured(strip(), 600, 200, 200)
      fireEvent.scroll(strip())
      expect(panel()).toHaveAttribute('data-dt-flow-more', 'both')

      measured(strip(), 600, 200, 400)
      fireEvent.scroll(strip())
      expect(panel()).toHaveAttribute('data-dt-flow-more', 'start')

      // Back to fitting — the tab stop goes with the edge that justified it.
      measured(strip(), 200, 200, 0)
      fireEvent(window, new Event('resize'))
      expect(panel()).not.toHaveAttribute('data-dt-flow-more')
      expect(strip()).not.toHaveAttribute('tabindex')
      expect(panel()).toHaveAttribute('aria-hidden', 'true')
    })

    it('measures with a pixel of slack, so a strip that fits exactly is not an edge', () => {
      setup()
      sweep(cell(0, CASES), cell(2, CASES))

      // Sub-pixel layout reports 599.6 as 600 against a 600 client width.
      measured(strip(), 600.6, 600)
      fireEvent(window, new Event('resize'))

      expect(panel()).not.toHaveAttribute('data-dt-flow-more')
    })
  })

  it('reads the same rectangle again when the number preferences move', async () => {
    const { user } = setup()
    sweep(cell(0, CASES), cell(2, CASES)) // 128, 42, 7

    await only(user, 'Product')
    expect(tag()).toBe('PRODUCT')
    expect(shown()).toMatch(/^37.632$/) // grouped in the reader's locale

    await only(user, 'Mean')
    expect(tag()).toBe('MEAN')
    expect(shown()).toBe('59')

    await only(user, 'Median')
    expect(shown()).toBe('42')

    await only(user, 'Highest')
    expect(shown()).toBe('128')

    await only(user, 'Lowest')
    expect(shown()).toBe('7')

    await only(user, 'Sum')
    expect(shown()).toBe('177')
  })

  it('gives a derived number more places than the cells carried', async () => {
    const { user } = setup({ records: withCases(['1', '2']) })
    sweep(cell(0, CASES), cell(1, CASES))
    expect(shown()).toBe('3') // the total of two integers is an integer

    await only(user, 'Mean')
    expect(shown()).toMatch(/^1[.,]5$/) // their mean is not
  })

  it('writes a product too big to read in exponent form', async () => {
    const { user } = setup({ records: withCases(['123456789', '987654321']) })
    sweep(cell(0, CASES), cell(1, CASES))

    await only(user, 'Product')
    // Eighteen digits is a wall, not a readout — and past 2^53 the trailing
    // ones are the float's rather than the data's.
    expect(shown()).toMatch(/^1.219E17$/)
  })

  it('follows the selection from one kind of cell to the next, with nothing set in between', async () => {
    const { user } = setup()
    await only(user, 'Mean')

    sweep(cell(0, CASES), cell(2, CASES)) // 128, 42, 7
    expect(tag()).toBe('MEAN')
    expect(shown()).toBe('59')
    expect(showing()).toBe('Mean')

    /*
     * The headline behaviour. The same drag one column to the left lands on
     * statuses, and the block answers with the *status* preference — which was
     * never chosen and never visited, while Mean is still what a rectangle of
     * numbers reads as. The selector holds preferences; it is not a mode the
     * selection has to be matched to.
     */
    sweep(cell(0, STATUS), cell(3, STATUS)) // Success, Success, In progress, Failed
    expect(tag()).toBe('SUCCESS RATE')
    expect(shown()).toMatch(/^50\s?%$/)
    expect(note()).toBe('(2 of 4)')
    expect(showing()).toBe('Success rate')

    sweep(cell(0, CASES), cell(2, CASES))
    expect(tag()).toBe('MEAN')
    expect(shown()).toBe('59')
  })

  it('keeps a preference per enum column, not one for enums', async () => {
    const { user } = setup()
    await only(user, 'Failed rate')
    // the same visit sets the second kind: a pick commits without closing
    expect(pop()).not.toBeNull()
    await only(user, 'Summer rate')

    sweep(cell(0, STATUS), cell(3, STATUS)) // Success, Success, In progress, Failed
    expect(tag()).toBe('FAILED RATE')
    expect(shown()).toMatch(/^25\s?%$/)
    expect(note()).toBe('(1 of 4)')

    sweep(cell(0, SEASON), cell(3, SEASON)) // Summer, Spring, Summer, Autumn
    expect(tag()).toBe('SUMMER RATE')
    expect(shown()).toMatch(/^50\s?%$/)
    // no count beside it: a season's share is a categorisation rather than a
    // figure the table is read for, and four of them on at once would each drag
    // a parenthetical along the strip
    expect(panel()!.querySelector('.dt-sum-note')).toBeNull()

    // "Success rate" would be meaningless over a rectangle of seasons, which is
    // why each enum column carries its own pick instead of sharing one
    sweep(cell(0, STATUS), cell(3, STATUS))
    expect(tag()).toBe('FAILED RATE')
  })

  it("prints a reading per metric the kind is set to, in the panel's order", async () => {
    const { user } = setup()
    sweep(cell(0, CASES), cell(2, CASES)) // 128, 42, 7
    expect(readings()).toEqual([['SUM', '177']])

    // switched on *beside* Sum rather than in place of it: the options are a
    // multi-select, which is the whole of what a set per kind buys
    await pick(user, 'Highest')
    expect(readings()).toEqual([
      ['SUM', '177'],
      ['HIGHEST', '128'],
    ])

    // and Mean lands between them, because the strip follows the panel's order
    // and not the order they were asked for — the block must not re-order
    // itself under the reader as they set preferences
    await pick(user, 'Mean')
    expect(readings()).toEqual([
      ['SUM', '177'],
      ['MEAN', '59'],
      ['HIGHEST', '128'],
    ])

    // the cog names all three, in the same order, for the pointer and the
    // screen reader that cannot see the strip
    expect(showing()).toBe('Sum, Mean, Highest')
    expect(showButton()).toHaveAttribute('title', 'Showing Sum, Mean, Highest')
  })

  it('takes one back off, and will not take the last one', async () => {
    const onMetricsChange = vi.fn()
    const { user } = setup({ onMetricsChange })
    sweep(cell(0, CASES), cell(2, CASES))

    await pick(user, 'Mean')
    await pick(user, 'Sum')
    expect(readings()).toEqual([['MEAN', '59']])
    expect(onMetricsChange).toHaveBeenCalledTimes(2)

    // Mean is holding the kind up now, so it is marked and its press does
    // nothing: a kind that read as nothing would look exactly like a rectangle
    // that is not one kind of thing, and the block already means that by
    // staying away
    expect(option('Mean')).toHaveAttribute('aria-disabled', 'true')
    expect(option('Mean')).toHaveAttribute('aria-selected', 'true')
    await user.click(option('Mean'))
    expect(readings()).toEqual([['MEAN', '59']])
    expect(onMetricsChange).toHaveBeenCalledTimes(2)

    // and it is only ever the last one that is held
    await pick(user, 'Sum')
    expect(option('Mean')).not.toHaveAttribute('aria-disabled')
  })

  it('reads one column of statuses as every rate Status is set to', async () => {
    const { user } = setup()
    await pick(user, 'Failed rate') // beside the Success rate already on
    sweep(cell(0, STATUS), cell(3, STATUS)) // Success, Success, In progress, Failed

    expect(items().map((item) => item.querySelector('.dt-sum-tag')?.textContent)).toEqual([
      'SUCCESS RATE',
      'FAILED RATE',
    ])
    // each share with its own working beside it, and neither of them is the
    // other's — the count is what the percentage was taken over
    expect(items().map((item) => item.querySelector('.dt-sum-note')?.textContent)).toEqual([
      '(2 of 4)',
      '(1 of 4)',
    ])
  })

  it('still only ever reads the kind in the rectangle, however much is set', async () => {
    const { user } = setup()
    await pick(user, 'Mean')
    await pick(user, 'Failed rate')

    // three metrics on across two kinds, and a rectangle answers with its own
    sweep(cell(0, CASES), cell(2, CASES))
    expect(readings()).toEqual([
      ['SUM', '177'],
      ['MEAN', '59'],
    ])

    sweep(cell(0, STATUS), cell(3, STATUS))
    expect(readings().map(([reading]) => reading)).toEqual([
      'SUCCESS RATE',
      'FAILED RATE',
    ])
  })

  it('speaks every reading in the one sentence', async () => {
    const { user } = setup()
    await pick(user, 'Mean')

    fireEvent.mouseDown(cell(0, CASES))
    fireEvent.mouseUp(document)
    fireEvent.keyDown(cell(0, CASES), { key: 'ArrowDown', shiftKey: true })

    // the block is aria-hidden, so this is the whole of what a screen reader
    // hears about it — comma-joined, in the sentence case the tags are not
    expect(screen.getByRole('status')).toHaveTextContent('Sum 170, Mean 85.')
  })

  it('says "all pages" once for the block, not once per reading', async () => {
    const { user } = setup() // 17 records over 3 pages
    await pick(user, 'Mean')

    fireEvent.keyDown(cell(0, CASES), { key: ' ', ctrlKey: true })
    expect(readings()).toHaveLength(2)
    // the scope qualifies the rectangle, which is the one thing every reading
    // in the strip has in common
    expect(panel()!.querySelectorAll('.dt-sum-scope')).toHaveLength(1)
  })

  it('seeds a whole list from the metrics prop', async () => {
    const onMetricsChange = vi.fn()
    setup({ metrics: { number: ['highest', 'mean'] }, onMetricsChange })
    sweep(cell(0, CASES), cell(2, CASES))

    // in the panel's order, not the order the host wrote them
    expect(readings()).toEqual([
      ['MEAN', '59'],
      ['HIGHEST', '128'],
    ])
    expect(showing()).toBe('Mean, Highest')
    // seeded, not driven: the host hears nothing until something is pressed
    expect(onMetricsChange).not.toHaveBeenCalled()
  })

  it('has nothing to say about text, dates, or a rectangle of two minds', () => {
    setup()
    sweep(cell(0, 0), cell(2, 0)) // a column of names, as it always was
    expect(panel()).toBeNull()

    sweep(cell(0, 1), cell(2, 1)) // dates parse as no number and no enum value
    expect(panel()).toBeNull()

    // half statuses and half counts is not a question with an answer — and the
    // kind is read off the cells, not off the columns they came from, which is
    // the rule the sum has always had
    sweep(cell(0, STATUS), cell(1, CASES))
    expect(panel()).toBeNull()
  })

  it('has nothing to say about two enum columns at once', () => {
    // Status and Favourite season are not neighbours in the default order, so
    // the host's own column order is what puts them side by side. The rule does
    // not care how they got there: a rectangle has to be one kind of thing.
    setup({ columns: ['status', 'favouriteSeason', 'name', 'date', 'solvedCases', 'address'] })
    sweep(cell(0, 0), cell(1, 1))
    expect(panel()).toBeNull()

    // and either of them alone still answers, under its own preference
    sweep(cell(0, 0), cell(3, 0))
    expect(tag()).toBe('SUCCESS RATE')
    sweep(cell(0, 1), cell(3, 1))
    expect(tag()).toBe('SPRING RATE')
  })

  it('needs two cells before it calls anything a rate', () => {
    setup()
    fireEvent.mouseDown(cell(0, STATUS))
    fireEvent.mouseUp(document)
    expect(panel()).toBeNull() // "100% of one cell" is no more a statistic than one cell is a sum

    fireEvent.keyDown(cell(0, STATUS), { key: 'ArrowDown', shiftKey: true })
    expect(tag()).toBe('SUCCESS RATE')
    expect(shown()).toMatch(/^100\s?%$/)
    expect(note()).toBe('(2 of 2)')
  })

  it('keeps the cell rectangle it is reporting on', async () => {
    const { user } = setup()
    sweep(cell(0, CASES), cell(2, CASES))
    expect(ranged().map(text)).toEqual(['128', '42', '7'])
    expect(shown()).toBe('177')

    await only(user, 'Mean')

    /*
     * Load-bearing, and the reason `toggleMetric` is in KEEPS_RANGE (state.ts):
     * every action outside that set nulls `state.range`, so without it the
     * press that asked the block a different question would take away the very
     * rectangle it was asking about, and the block would vanish mid-answer.
     * `only` is two presses here — Mean on, Sum off — so the rectangle has to
     * survive both. The panel is still open at this point, which is the other
     * half of it: the next pick has to have something to report on too.
     */
    expect(ranged().map(text)).toEqual(['128', '42', '7'])
    expect(cell(2, CASES)).toHaveClass('dt-range-active')
    expect(shown()).toBe('59')
  })

  it('names the metrics in force, and falls back to the numbers ones with nothing selected', async () => {
    const { user } = setup()
    expect(showing()).toBe('Sum')
    // a cog, so the name is the whole of what it says: what is in force, and
    // what the control is for. The tooltip is the sighted half of it — the one
    // reading the button used to print, kept for a pointer.
    expect(showButton()).toHaveTextContent('')
    expect(showButton().querySelector('svg')).not.toBeNull()
    expect(showButton()).toHaveAccessibleName(/^Showing Sum\. Set what each kind/)
    expect(showButton()).toHaveAttribute('title', 'Showing Sum')

    sweep(cell(0, STATUS), cell(3, STATUS))
    expect(showing()).toBe('Success rate')
    expect(showButton()).toHaveAccessibleName(/^Showing Success rate\./)
    expect(showButton()).toHaveAttribute('title', 'Showing Success rate')

    // with the rectangle gone nothing is in force, so it falls back to the
    // numbers preference rather than holding on to the last answer
    fireEvent.keyDown(cell(0, STATUS), { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(showing()).toBe('Sum')

    await only(user, 'Median')
    expect(showing()).toBe('Median')
  })

  it('speaks the metrics in force, not the word Sum', async () => {
    const { user } = setup()
    await only(user, 'Mean')

    fireEvent.mouseDown(cell(0, CASES))
    fireEvent.mouseUp(document)
    fireEvent.keyDown(cell(0, CASES), { key: 'ArrowDown', shiftKey: true })

    // the block is aria-hidden, so the live region is the whole of what a
    // screen reader hears — in sentence case, not the tag's upper case
    expect(panel()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Mean 85') // (128 + 42) / 2

    // and the same keys over the status column speak the status preference,
    // without the selector being opened again
    fireEvent.mouseDown(cell(0, STATUS))
    fireEvent.mouseUp(document)
    fireEvent.keyDown(cell(0, STATUS), { key: 'ArrowDown', shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent(/Success rate 100\s?%\./)
  })

  it('seeds from the metrics prop and reports the whole record back', async () => {
    const onMetricsChange = vi.fn()
    const { user } = setup({
      metrics: { number: 'median', status: 'rate:status:Failed' },
      onMetricsChange,
    })
    expect(showing()).toBe('Median')

    sweep(cell(0, STATUS), cell(3, STATUS))
    expect(tag()).toBe('FAILED RATE')

    await pick(user, 'Autumn rate')
    // the whole record, not the one category that moved: a host storing this
    // between visits gets back something it can hand straight to the prop, and
    // the two categories it did not name are in it at their defaults. Autumn
    // joins the Spring rate that was one of them rather than replacing it —
    // every list, because a bare key is the shorthand for a list of one.
    expect(onMetricsChange).toHaveBeenCalledTimes(1)
    expect(onMetricsChange).toHaveBeenCalledWith({
      number: ['median'],
      status: ['rate:status:Failed'],
      favouriteSeason: ['rate:favouriteSeason:Spring', 'rate:favouriteSeason:Autumn'],
    })

    // and the prop does not own it after that first read — the selector does
    expect(showing()).toBe('Failed rate')
  })

  it('drops a preference that names no metric, and one filed under the wrong kind', () => {
    setup({
      metrics: {
        // the rate keys are a template literal type, so a typo type-checks
        status: 'rate:status:Successful',
        // and this is a real metric on the wrong shelf — no rectangle of
        // seasons can answer "the mean of these". The cast is the lie the
        // guard is there to catch.
        favouriteSeason: 'mean' as RateMetricKey,
      },
    })
    // neither blanks the block: the default stands where the junk was
    expect(showing()).toBe('Sum')

    sweep(cell(0, STATUS), cell(3, STATUS))
    expect(tag()).toBe('SUCCESS RATE')

    sweep(cell(0, SEASON), cell(3, SEASON)) // Summer, Spring, Summer, Autumn
    expect(tag()).toBe('SPRING RATE')
    expect(shown()).toMatch(/^25\s?%$/)
  })

  it('stands where "Reset order" did, between the block and New record', () => {
    setup()
    const root = showButton().closest('.dt-metric') as HTMLElement
    expect(root).not.toBeNull()
    // and nowhere near `.dt-filter`: section 4c of the stylesheet sizes that
    // component inside a chip popup, and neither may reach the other
    expect(root.closest('.dt-filter')).toBeNull()
    expect(document.querySelectorAll('.dt-metric .dt-filter')).toHaveLength(0)

    // nothing selected, so the block is not mounted and the spacer is what it
    // follows; with a rectangle it is the block itself (see "flow block")
    expect(root.previousElementSibling).toHaveClass('dt-spacer')
    expect(root.nextElementSibling).toHaveClass('dt-btn-primary')
    // the button whose slot this is has gone with its action
    expect(screen.queryByRole('button', { name: 'Reset order' })).toBeNull()
  })

  it('opens on the kinds alone, and expands one at a time into its metrics', async () => {
    const { user } = setup()
    await user.click(showButton())

    expect(
      screen.getByRole('dialog', { name: 'What each kind of cell selection reads as' }),
    ).toBe(pop())

    // the three kinds, and nothing else: a metric is the answer to the second
    // question, and the panel has not asked the first one yet
    const heads = Array.from(document.querySelectorAll('.dt-metric-head'))
    expect(heads.map(catName)).toEqual(['Numbers', 'Status', 'Favourite season'])
    heads.forEach((head) => expect(head).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.queryAllByRole('listbox')).toHaveLength(0)
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    // opening one shows its metrics, and only its own — "Success rate" is not
    // an alternative to "Sum", it is the answer to a different question. Tick
    // as many as you like, which is the dock's enum values and this port's one
    // shape for that.
    await user.click(category('Numbers'))
    expect(showingCategories()).toEqual(['Numbers'])
    const numbers = screen.getByRole('listbox', { name: 'Numbers' })
    expect(numbers).toHaveAttribute('aria-multiselectable', 'true')
    expect(within(numbers).getAllByRole('option')).toHaveLength(6)
    expect(screen.getAllByRole('option', { selected: true }).map(text)).toEqual(['Sum'])

    // and a second kind takes the first one's place rather than joining it
    await user.click(category('Status'))
    expect(showingCategories()).toEqual(['Status'])
    expect(within(screen.getByRole('listbox', { name: 'Status' })).getAllByRole('option'))
      .toHaveLength(3)
    expect(screen.queryByRole('option', { name: 'Sum' })).toBeNull()

    // its own ticks per kind, not one set across the panel — each section says
    // so when it is the one showing
    expect(screen.getAllByRole('option', { selected: true }).map(text)).toEqual([
      'Success rate',
    ])
    await user.click(category('Favourite season'))
    expect(within(screen.getByRole('listbox', { name: 'Favourite season' })).getAllByRole('option'))
      .toHaveLength(4)
    expect(screen.getAllByRole('option', { selected: true }).map(text)).toEqual([
      'Spring rate',
    ])

    // pressing the open one shuts it, back to the three kinds
    await user.click(category('Favourite season'))
    expect(showingCategories()).toEqual([])
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    // one tab stop inside the open section, not one per option
    await user.click(category('Numbers'))
    expect(pop()!.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  })

  it('marks the section the selection is being read under, open or shut', async () => {
    const { user } = setup()
    sweep(cell(0, STATUS), cell(3, STATUS))
    await user.click(showButton())

    // the mark is on the category row, so it is there before anything is
    // expanded — which is the whole point of it now that the panel opens on
    // the kinds
    const marked = Array.from(document.querySelectorAll('.dt-metric-group.dt-metric-now'))
    expect(marked).toHaveLength(1)
    expect(catName(marked[0].querySelector('.dt-metric-head')!)).toBe('Status')

    // the accent edge is not the only way to know which one it is
    expect(category('Status')).toHaveAccessibleName('Status — in use for this selection')
    await user.click(category('Status'))
    expect(within(marked[0] as HTMLElement).getByRole('option', { name: 'Success rate' }))
      .toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: /^Status/ })).toHaveAccessibleName(
      'Status — in use for this selection',
    )

    // nothing selected, nothing in force, nothing marked
    await user.keyboard('{Escape}')
    fireEvent.keyDown(cell(0, STATUS), { key: 'Escape' })
    await user.click(showButton())
    expect(document.querySelectorAll('.dt-metric-now')).toHaveLength(0)
  })

  it('goes in and out of a section with the arrows, and across them with Tab', async () => {
    const { user } = setup()
    showButton().focus()

    // the cog's own Down opens the panel on the kind in force — Numbers, with
    // nothing selected — and stops there: the metrics are a level in
    await user.keyboard('{ArrowDown}')
    expect(category('Numbers')).toHaveFocus()
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    // one more Down is "go in", onto the section's first tick
    await user.keyboard('{ArrowDown}')
    expect(showingCategories()).toEqual(['Numbers'])
    expect(option('Sum')).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(option('Sum')).toHaveFocus() // and stops at the top of the section

    await user.keyboard('{End}')
    expect(option('Lowest')).toHaveFocus()

    // the arrows stay inside the section — each is its own list, so "Success
    // rate" is not the option after "Lowest"
    await user.keyboard('{ArrowDown}')
    expect(option('Lowest')).toHaveFocus()

    // Tab is what crosses, landing on the next kind rather than in it
    await user.tab()
    expect(category('Status')).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(option('Success rate')).toHaveFocus()
    // opening Status put Numbers away: one section at a time
    expect(showingCategories()).toEqual(['Status'])
    expect(screen.queryByRole('option', { name: 'Sum' })).toBeNull()

    // and moving does not commit: the ticks are still where they were
    expect(option('Success rate')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}{Enter}')
    // ticked *as well as*, not instead of — this is a multi-select, and Status
    // now reads two ways
    expect(option('In progress rate')).toHaveAttribute('aria-selected', 'true')
    expect(option('Success rate')).toHaveAttribute('aria-selected', 'true')
    // committing closes neither the panel nor the section, so the tick just
    // made is still on screen and the same visit can set another kind
    expect(pop()).not.toBeNull()
    expect(showingCategories()).toEqual(['Status'])
    expect(option('In progress rate')).toHaveFocus()

    // and the same key on the same option takes it back off
    await user.keyboard('{Enter}')
    expect(option('In progress rate')).toHaveAttribute('aria-selected', 'false')

    // Up from the top of a section is "back out": onto its category row, which
    // shuts it
    await user.keyboard('{ArrowUp}')
    expect(option('Success rate')).toHaveFocus()
    await user.tab({ shift: true })
    expect(category('Status')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(showingCategories()).toEqual([])
    expect(category('Status')).toHaveFocus()

    // the button still reads Sum: it names the metrics in force, and with
    // nothing selected those are the numbers preferences, not the tick just made
    expect(showing()).toBe('Sum')
  })

  it('closes on Escape and on a press outside, and hands the focus back', async () => {
    const { user } = setup()
    await user.click(showButton())
    await user.keyboard('{ArrowDown}{Escape}')

    expect(pop()).toBeNull()
    expect(showing()).toBe('Sum') // the arrow committed nothing
    expect(showButton()).toHaveFocus()

    // a press anywhere else closes it too, and leaves the focus where the
    // pointer went — FilterMenu's rule, and the dock's
    await user.click(showButton())
    expect(pop()).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(pop()).toBeNull()
  })

  /**
   * Focus can be on the button with the panel still standing: Shift+Tab out of
   * the first section goes there, and the panel deliberately stays open for
   * anywhere inside the control. Both keys the control answers have to answer
   * from there too, and the Escape is the one that matters — unhandled, it
   * reaches the table root's own Escape chain, which would clear the rectangle
   * the block is reading. That is the selection `toggleMetric` sits in
   * KEEPS_RANGE to protect, thrown away by a press that was meant to shut a
   * menu.
   */
  it('answers Escape from the button, and leaves the selection where it was', async () => {
    const { user } = setup()
    sweep(cell(0, CASES), cell(2, CASES))
    expect(shown()).toBe('177')

    await user.click(showButton())
    await user.tab({ shift: true })
    expect(showButton()).toHaveFocus()
    expect(pop()).not.toBeNull() // still open — focus is inside the control

    await user.keyboard('{Escape}')
    expect(pop()).toBeNull()
    expect(showButton()).toHaveFocus()
    // and it stopped here rather than carrying on up to the root
    expect(ranged()).toHaveLength(3)
    expect(shown()).toBe('177')
  })

  it('steps back into the panel from the button, where the sections were left', async () => {
    const { user } = setup()
    await user.click(showButton())

    await user.tab() // onto Status
    await user.keyboard('{ArrowDown}{ArrowDown}') // in, then below its tick
    expect(option('In progress rate')).toHaveFocus()

    await user.tab({ shift: true }) // back onto Status
    await user.tab({ shift: true }) // onto Numbers
    await user.tab({ shift: true }) // out to the cog, panel still standing
    expect(showButton()).toHaveFocus()
    expect(pop()).not.toBeNull()

    // an arrow from the cog means "back into the panel", not "open it": it has
    // to move focus, and it has to leave the panel standing where the keyboard
    // left it — the same section open, on the same option — rather than
    // collapsing back to the three kinds
    await user.keyboard('{ArrowDown}')
    expect(showingCategories()).toEqual(['Status'])
    expect(option('In progress rate')).toHaveFocus()
    // and none of that committed anything
    expect(option('Success rate')).toHaveAttribute('aria-selected', 'true')
    expect(option('In progress rate')).toHaveAttribute('aria-selected', 'false')
  })
})

describe('controlled records', () => {
  it('renders exactly what the host passes and never mutates it', async () => {
    const records: DataTableRecord[] = createDemoRecords().slice(0, 3)
    const snapshot = JSON.stringify(records)
    const onRecordsChange = vi.fn()

    const user = userEvent.setup()
    render(<DataTable motion="never" records={records} onRecordsChange={onRecordsChange} />)

    expect(rowNames()).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    // the host decides — the component keeps rendering the prop it was given
    expect(rowNames()).toHaveLength(3)
    expect(onRecordsChange).toHaveBeenCalledWith(expect.arrayContaining([]))
    expect(onRecordsChange.mock.calls[0][0]).toHaveLength(2)
    expect(JSON.stringify(records)).toBe(snapshot)
  })
})

describe('page clamping', () => {
  it('falls back to the last page when a delete empties the current one', async () => {
    const { user } = setup({ rowsPerPage: 8 })
    await user.click(pageBtn(3))
    expect(rowNames()).toHaveLength(1)
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(pageBtn(2)).toHaveAttribute('aria-current', 'page')
    expect(rowNames()).toHaveLength(8)
  })
})

describe('regressions', () => {
  it('stops counting a selected record the host has removed', async () => {
    const all = createDemoRecords()
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    const { rerender } = render(
      <DataTable motion="never" records={all} onSelectionChange={onSelectionChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(stat('Selected')).toBe('1')

    rerender(
      <DataTable
        motion="never"
        records={all.filter((r) => r.id !== 'REC-4813')}
        onSelectionChange={onSelectionChange}
      />,
    )
    expect(stat('Selected')).toBe('0')
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })

  it('closes an open status picker on a press outside it', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
    await user.click(byTitle('Edit Status'))
    expect(screen.getByRole('group', { name: 'Edit Status' })).toBeInTheDocument()

    await user.click(screen.getByRole('heading', { name: 'Data table' }))
    expect(screen.queryByRole('group', { name: 'Edit Status' })).not.toBeInTheDocument()
    // the row stays armed — only the editor closed
    expect(byTitle('Edit Status')).toBeInTheDocument()
  })

  it('closes it on another control too, and that control still acts', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
    await user.click(byTitle('Edit Status'))

    await user.click(screen.getByRole('button', { name: 'Select Amelia Hart' }))
    expect(screen.queryByRole('group', { name: 'Edit Status' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Amelia Hart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('leaves a text editor alone while the pointer is inside it', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
    await user.click(byTitle('Edit Name'))
    await user.click(screen.getByLabelText('Edit Name'))
    expect(screen.getByLabelText('Edit Name')).toBeInTheDocument()
  })

  it('never repeats an id when the host uses its own id scheme', async () => {
    const uuids = createDemoRecords()
      .slice(0, 2)
      .map((r, i) => ({ ...r, id: `f47ac10b-58cc-4372-a567-0e02b2c3d47${i}` }))
    const onRecordsChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <DataTable motion="never" defaultRecords={uuids} onRecordsChange={onRecordsChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'New record' }))
    await user.type(screen.getByLabelText('Name'), 'First{Enter}')
    await user.click(screen.getByRole('button', { name: 'New record' }))
    await user.type(screen.getByLabelText('Name'), 'Second{Enter}')
    rerender(
      <DataTable motion="never" defaultRecords={uuids} onRecordsChange={onRecordsChange} />,
    )

    const ids = rowNames().map(
      (name) =>
        screen
          .getByText(name, { selector: '.dt-name-text' })
          .closest('tbody')!
          .getAttribute('data-id') as string,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.startsWith('REC-'))).toEqual(['REC-4827', 'REC-4820'])
  })

  it('cleans up after a drag whose row is pushed off the page', () => {
    const onRecordsChange = vi.fn()
    setup({ onRecordsChange })
    const tbodyOf = (name: string) =>
      screen.getByText(name, { selector: '.dt-name-text' }).closest('tbody') as HTMLElement

    // descending puts a record from the back of the list at the top; reordering
    // clears the sort, so that record leaves the page on the drop
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    const [source] = rowNames()
    const last = rowNames()[7]

    const sourceGrip = tbodyOf(source).querySelector('.dt-row-grip') as HTMLElement
    fireEvent.dragStart(sourceGrip, { dataTransfer: { effectAllowed: '', setData: () => {} } })
    aimAtRow(tbodyOf(last), 'after')
    fireEvent.drop(tbodyOf(last).querySelector('td')!)
    expect(rowNames()).not.toContain(source)

    // the browser still fires dragend, but at the node React has detached; it
    // is delivered at the grip and bubbles to the row inside that subtree
    fireEvent.dragEnd(sourceGrip)

    const callsBefore = onRecordsChange.mock.calls.length
    const stillHere = rowNames()
    const stray = tbodyOf(stillHere[3])
    aimAtRow(stray, 'after')
    fireEvent.drop(stray.querySelector('td')!)
    expect(onRecordsChange.mock.calls).toHaveLength(callsBefore)
    expect(rowNames()).toEqual(stillHere)
  })

  it('measures the natural height when a pane is re-opened mid-collapse', async () => {
    // jsdom has no layout, so stand in for it: the grid is 300px tall at rest
    // and 50px while dt-expand is clamping its max-height. Measuring through a
    // running animation is exactly the mistake this guards against.
    const proto = HTMLElement.prototype
    const original = proto.getBoundingClientRect
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList?.contains('dt-detail-grid')) {
        const height = this.classList.contains('dt-entering') ? 50 : 300
        return { height, width: 900, top: 0, left: 0, right: 900, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      }
      return original.call(this)
    }

    try {
      const user = userEvent.setup()
      render(<DataTable motion="always" />)
      const toggle = screen.getAllByRole('button', { name: 'Toggle details' })[0]

      await user.click(toggle) // open
      await user.click(toggle) // collapse, before the enter has finished
      await user.click(toggle) // and straight back open

      const grid = document.querySelector('.dt-detail-grid') as HTMLElement
      expect(grid).toHaveClass('dt-entering')
      expect(grid.style.getPropertyValue('--dt-pane-h')).toBe('300px')
    } finally {
      proto.getBoundingClientRect = original
    }
  })

  it('does not replay a collapse on a row that left the page mid-animation', async () => {
    const user = userEvent.setup()
    render(<DataTable motion="always" />)
    const toggle = screen.getAllByRole('button', { name: 'Toggle details' })[0]

    await user.click(toggle)
    await waitFor(() => expect(document.querySelector('.dt-entering')).toBeNull(), {
      timeout: 2000,
    })

    await user.click(toggle)
    expect(document.querySelector('.dt-collapsing')).toBeInTheDocument()

    // Sorting is the one row-shuffling action that does NOT clear the transient
    // state, so it is what can strand a pane mid-collapse: ascending pushes
    // REC-4813 to page 2, descending brings it straight back.
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(rowNames()).not.toContain('Tunc Yanik')
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(rowNames()).toContain('Tunc Yanik')

    await waitFor(() => expect(document.querySelector('.dt-detail-grid')).toBeNull(), {
      timeout: 2000,
    })
  })
})

/**
 * jsdom has no layout, so every rect is zero and nothing that measures can be
 * observed. These stand in for the browser just enough to prove that the
 * animation machinery actually fires — and that it is skipped when motion is off.
 */
function mockLayout(fn: (el: HTMLElement) => Partial<DOMRect> | null) {
  const proto = HTMLElement.prototype
  const original = proto.getBoundingClientRect
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const rect = fn(this)
    if (!rect) return original.call(this)
    return {
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({}), ...rect,
    } as DOMRect
  }
  return () => {
    proto.getBoundingClientRect = original
  }
}

const rowsAt60px = (el: HTMLElement) => {
  if (el.tagName !== 'TBODY' || !el.dataset.id) return null
  const bodies = Array.from(document.querySelectorAll('tbody[data-id]'))
  return { top: bodies.indexOf(el) * 60, height: 60 }
}

describe('animation machinery', () => {
  it('inverts the moved rows with a transform when a reorder lands', async () => {
    const restore = mockLayout(rowsAt60px)
    try {
      const user = userEvent.setup()
      render(<DataTable motion="always" />)

      screen.getAllByRole('button', { name: /^Reorder (?!.*column)/ })[0].focus()
      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      // set synchronously in the layout effect and only cleared on transitionend,
      // which jsdom never fires — so it is the stable evidence that FLIP ran
      expect(document.querySelectorAll('.dt-flipping').length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('carries the whole column with its header when a column moves', async () => {
    const restore = mockLayout((el) => {
      if (el.tagName !== 'TH' || !el.dataset.key) return null
      const heads = Array.from(document.querySelectorAll('th[data-key]'))
      return { left: heads.indexOf(el) * 150, width: 150 }
    })
    try {
      const user = userEvent.setup()
      render(<DataTable motion="always" />)

      screen.getByRole('button', { name: /^Reorder Name column/ }).focus()
      await user.keyboard('{Alt>}{ArrowRight}{/Alt}')

      expect(document.querySelector('th[data-key="name"]')).toHaveClass('dt-flipping')
      // the cells beneath travel with it
      expect(document.querySelectorAll('td[data-key="name"].dt-flipping').length).toBe(8)
    } finally {
      restore()
    }
  })

  it('skips the FLIP entirely when motion is off', async () => {
    const restore = mockLayout(rowsAt60px)
    try {
      const user = userEvent.setup()
      render(<DataTable motion="never" />)

      screen.getAllByRole('button', { name: /^Reorder (?!.*column)/ })[0].focus()
      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      expect(document.querySelectorAll('.dt-flipping')).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('opens the detail pane at its measured height, not a fixed one', async () => {
    const restore = mockLayout((el) =>
      el.classList.contains('dt-detail-grid') ? { height: 212 } : null,
    )
    try {
      const user = userEvent.setup()
      render(<DataTable motion="always" />)
      await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[0])

      const grid = document.querySelector('.dt-detail-grid') as HTMLElement
      expect(grid).toHaveClass('dt-entering')
      expect(grid.style.getPropertyValue('--dt-pane-h')).toBe('212px')
    } finally {
      restore()
    }
  })
})

describe('markup contract', () => {
  it('scopes everything under .dt-root and marks the columns for the FLIP', () => {
    const { container } = setup()
    expect(container.firstElementChild).toHaveClass('dt-root')
    expect(document.querySelectorAll('td[data-key="name"]')).toHaveLength(8)
    expect(document.querySelector('tbody[data-id="REC-4813"]')).toBeInTheDocument()
  })

  it('spans the detail row across every column', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Toggle details' })[0])
    expect(document.querySelector('.dt-detail-cell')).toHaveAttribute('colspan', '9')
  })

  it('carries the motion preference on the root', () => {
    const { container } = render(<DataTable motion="always" />)
    expect(container.firstElementChild).toHaveAttribute('data-dt-motion', 'always')
  })
})

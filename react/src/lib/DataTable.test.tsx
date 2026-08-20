/**
 * Behaviour parity tests — the numbered ids refer to PARITY.md.
 *
 * Most tests run with motion="never" so the expand/collapse lifecycle resolves
 * synchronously; jsdom never fires `animationend`, and the animation's own
 * fallback timer is exercised separately.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable } from './DataTable'
import { createDemoRecords } from './demoData'
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

/** The status filter is a dropdown: open it, then take the option. */
const filterButton = () => screen.getByRole('button', { name: /^Status/ })

const pickFilter = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(filterButton())
  await user.click(screen.getByRole('option', { name }))
}

const rowsSlider = () => screen.getByLabelText('Rows per page') as HTMLInputElement

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
  it('filters across name, email, address and mobile, case-insensitively', async () => {
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

  it('resets to page 1 when the query changes', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-current', 'page')
    await user.type(screen.getByLabelText('Search records'), 'a')
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')
  })

  it('filters by status and combines with the query', async () => {
    const { user } = setup()
    await pickFilter(user, 'Failed')
    expect(rowNames()).toEqual(['Marcus Reed', 'Clara Whitfield', 'Julien Moreau'])
    await user.type(screen.getByLabelText('Search records'), 'clara')
    expect(rowNames()).toEqual(['Clara Whitfield'])
  })

  it('names the active filter on the button and marks its option selected', async () => {
    const { user } = setup()
    expect(filterButton()).toHaveTextContent('All')

    await pickFilter(user, 'Success')
    expect(filterButton()).toHaveTextContent('Success')

    await user.click(filterButton())
    expect(screen.getByRole('option', { name: 'Success' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: 'All' })).toHaveAttribute('aria-selected', 'false')
  })

  it('shows the empty state when nothing matches', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Search records'), 'zzzzz')
    expect(screen.getByText('No records match')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 0 entries')
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
    await user.click(screen.getByRole('button', { name: '2' }))
    expect(
      screen.getByRole('button', { name: 'Select all rows on this page' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(stat('Selected')).toBe('8')
  })

  it('keeps the selection across paging and filtering', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByRole('button', { name: 'Select Tunc Yanik' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(stat('Selected')).toBe('1')
  })

  it('enables Export and Archive only with a selection, and hands over the records', async () => {
    const onExport = vi.fn()
    const { user } = setup({ onExport })
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(onExport).toHaveBeenCalledWith([expect.objectContaining({ name: 'Tunc Yanik' })])
  })

  it('reports selection changes', async () => {
    const onSelectionChange = vi.fn()
    const { user } = setup({ onSelectionChange })
    expect(onSelectionChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Select Tunc Yanik' }))
    expect(onSelectionChange).toHaveBeenCalledWith(['REC-4813'])
  })
})

describe('status filter menu', () => {
  const options = () => screen.getAllByRole('option').map((el) => el.textContent)

  it('opens with every filter in it and closes on a pick', async () => {
    const { user } = setup()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(filterButton()).toHaveAttribute('aria-expanded', 'false')

    await user.click(filterButton())
    expect(filterButton()).toHaveAttribute('aria-expanded', 'true')
    expect(options()).toEqual(['All', 'Success', 'In progress', 'Failed'])

    await user.click(screen.getByRole('option', { name: 'In progress' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(filterButton()).toHaveTextContent('In progress')
    expect(filterButton()).toHaveFocus()
  })

  it('a second press on the button closes it again', async () => {
    const { user } = setup()
    await user.click(filterButton())
    await user.click(filterButton())
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens on ArrowDown with the current value focused, and walks the list', async () => {
    const { user } = setup()
    filterButton().focus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'All' })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: 'In progress' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByRole('option', { name: 'Failed' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(filterButton()).toHaveTextContent('Failed')
    expect(rowNames()).toEqual(['Marcus Reed', 'Clara Whitfield', 'Julien Moreau'])
  })

  it('stops at the ends of the list', async () => {
    const { user } = setup()
    await user.click(filterButton())
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('option', { name: 'All' })).toHaveFocus()
  })

  it('Escape closes it without picking, and gives the button back its focus', async () => {
    const { user } = setup()
    await user.click(filterButton())
    await user.keyboard('{ArrowDown}{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(filterButton()).toHaveTextContent('All')
    expect(filterButton()).toHaveFocus()
  })

  it('that Escape does not also unwind the table behind it', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'New record' }))
    await user.click(filterButton())
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.querySelector('tbody[data-id="__draft__"]')).toBeInTheDocument()
  })

  it('a press outside closes it', async () => {
    const { user } = setup()
    await user.click(filterButton())
    await user.click(screen.getByLabelText('Search records'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('rows per page', () => {
  it('resizes the page from the toolbar', async () => {
    setup()
    expect(rowNames()).toHaveLength(8)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–8 of 17 entries')

    fireEvent.change(rowsSlider(), { target: { value: '4' } })
    expect(rowNames()).toHaveLength(4)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–4 of 17 entries')
    expect(screen.getAllByRole('button', { name: /^[0-9]+$/ })).toHaveLength(5)
  })

  it('keeps the record at the top of the page in view', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '2' }))
    const first = rowNames()[0]

    fireEvent.change(rowsSlider(), { target: { value: '4' } })
    expect(rowNames()[0]).toBe(first)
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-current', 'page')
  })

  it('takes the prop as its opening value and reports every change', () => {
    const onRowsPerPageChange = vi.fn()
    setup({ rowsPerPage: 5, onRowsPerPageChange })
    expect(rowsSlider()).toHaveValue('5')
    expect(rowNames()).toHaveLength(5)

    fireEvent.change(rowsSlider(), { target: { value: '9' } })
    expect(onRowsPerPageChange).toHaveBeenCalledWith(9)
    expect(rowNames()).toHaveLength(9)
  })

  it('widens its bounds for a host that opens outside them', () => {
    setup({ rowsPerPage: 40 })
    expect(rowsSlider()).toHaveAttribute('max', '40')
    expect(rowsSlider()).toHaveAttribute('min', '4')
  })

  it('drops the cell range, which was measured against the old page', () => {
    setup()
    const cell = (row: number, col: number) =>
      document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
    fireEvent.mouseDown(cell(0, 0))
    fireEvent.mouseOver(cell(2, 1))
    fireEvent.mouseUp(document)
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(6)

    fireEvent.change(rowsSlider(), { target: { value: '4' } })
    expect(document.querySelectorAll('td.dt-range')).toHaveLength(0)
  })
})

describe('pagination', () => {
  it('clamps Prev and Next', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: '‹ Prev' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next ›' }))
    await user.click(screen.getByRole('button', { name: 'Next ›' }))
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 17–17 of 17 entries')
  })

  it('renders one numbered button per page', () => {
    setup()
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4' })).not.toBeInTheDocument()
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
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggles[0])
    expect(screen.queryByText('Record ID')).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: '2' }))
    expect(screen.queryByText('Record ID')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1' }))
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
    await user.click(byTitle('Edit Email ID'))
    const input = screen.getByLabelText('Edit Email ID')
    await user.clear(input)
    await user.type(input, 'new@example.com')
    await user.tab()
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
  })

  it('edits the status through the three-way picker and returns to picking', async () => {
    const { user } = setup()
    await armFirstRow(user)
    await user.click(byTitle('Edit Status'))
    const picker = screen.getByRole('group', { name: 'Edit status' })
    await user.click(within(picker).getByRole('button', { name: 'Failed' }))

    const row = screen.getByText('Tunc Yanik', { selector: '.dt-name-text' }).closest('tr')!
    expect(row.querySelector('.dt-pill')).toHaveTextContent('Failed')
    expect(row.querySelector('.dt-pill')).toHaveClass('dt-failed')
    expect(byTitle('Edit Status')).toBeInTheDocument()
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
    await user.click(byTitle('Set status'))
    await user.click(
      within(screen.getByRole('group', { name: 'Edit status' })).getByRole('button', {
        name: 'Success',
      }),
    )
    expect(byTitle('Set status')).toHaveTextContent('Success')
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

  it('moves a column with Alt+ArrowRight and Reset order puts it back', async () => {
    const { user } = setup()
    const keys = () =>
      Array.from(document.querySelectorAll('th[data-key]')).map((th) => th.getAttribute('data-key'))
    expect(keys()).toEqual(['name', 'date', 'status', 'mobile', 'email', 'address'])

    const grip = screen.getByRole('button', { name: /^Reorder Name column/ })
    grip.focus()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(keys()).toEqual(['date', 'name', 'status', 'mobile', 'email', 'address'])

    await user.click(screen.getByRole('button', { name: 'Reset order' }))
    expect(keys()).toEqual(['name', 'date', 'status', 'mobile', 'email', 'address'])
  })

  it('Reset order also clears the sort', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    await user.click(screen.getByRole('button', { name: 'Reset order' }))
    expect(
      screen.getByRole('button', { name: 'Sort by Name' }).closest('th'),
    ).toHaveAttribute('aria-sort', 'none')
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

  it('splices a row into the position it is dragged over, live', () => {
    setup()
    const [first, second, third] = rowNames()

    fireEvent.dragStart(rowGrip(first), dataTransfer())
    expect(tbodyOf(first)).toHaveClass('dt-dragging')

    fireEvent.dragEnter(tbodyOf(third).querySelector('td')!)
    expect(rowNames().slice(0, 3)).toEqual([second, third, first])

    fireEvent.dragEnd(tbodyOf(first).querySelector('tr')!)
    expect(tbodyOf(first)).not.toHaveClass('dt-dragging')
  })

  it('splices a column into the position it is dragged over', () => {
    setup()
    const keys = () =>
      Array.from(document.querySelectorAll('th[data-key]')).map((el) => el.getAttribute('data-key'))

    fireEvent.dragStart(colGrip('name'), dataTransfer())
    expect(th('name')).toHaveClass('dt-dragging')

    fireEvent.dragEnter(th('mobile'))
    expect(keys()).toEqual(['date', 'status', 'mobile', 'name', 'email', 'address'])

    fireEvent.dragEnd(th('name'))
    expect(th('name')).not.toHaveClass('dt-dragging')
  })

  it('a row drag clears the sort; a column drag does not', () => {
    setup()
    const sorted = () => screen.getByRole('button', { name: 'Sort by Name' }).closest('th')

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.dragStart(colGrip('date'), dataTransfer())
    fireEvent.dragEnter(th('status'))
    fireEvent.dragEnd(th('date'))
    expect(sorted()).toHaveAttribute('aria-sort', 'ascending')

    const [first, second] = rowNames()
    fireEvent.dragStart(rowGrip(first), dataTransfer())
    fireEvent.dragEnter(tbodyOf(second).querySelector('td')!)
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
    await user.click(screen.getByRole('button', { name: '2' }))
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
    await user.click(screen.getByRole('button', { name: '3' }))
    expect(rowNames()).toHaveLength(1)
    await user.click(screen.getAllByRole('button', { name: 'Delete record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByRole('group', { name: 'Edit status' })).toBeInTheDocument()

    await user.click(screen.getByRole('heading', { name: 'Data table' }))
    expect(screen.queryByRole('group', { name: 'Edit status' })).not.toBeInTheDocument()
    // the row stays armed — only the editor closed
    expect(byTitle('Edit Status')).toBeInTheDocument()
  })

  it('closes it on another control too, and that control still acts', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Edit record' })[0])
    await user.click(byTitle('Edit Status'))

    await user.click(screen.getByRole('button', { name: 'Select Amelia Hart' }))
    expect(screen.queryByRole('group', { name: 'Edit status' })).not.toBeInTheDocument()
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
    // clears the sort, so that record leaves the page mid-drag
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    const [source] = rowNames()
    const last = rowNames()[7]

    const sourceGrip = tbodyOf(source).querySelector('.dt-row-grip') as HTMLElement
    fireEvent.dragStart(sourceGrip, { dataTransfer: { effectAllowed: '', setData: () => {} } })
    fireEvent.dragEnter(tbodyOf(last).querySelector('td')!)
    expect(rowNames()).not.toContain(source)

    // the browser still fires dragend, but at the node React has detached; it
    // is delivered at the grip and bubbles to the row inside that subtree
    fireEvent.dragEnd(sourceGrip)

    const callsBefore = onRecordsChange.mock.calls.length
    const stillHere = rowNames()
    fireEvent.dragEnter(tbodyOf(stillHere[3]).querySelector('td')!)
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

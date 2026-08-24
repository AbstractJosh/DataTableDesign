/**
 * Turkish language support.
 *
 * The point every test here circles is the one rule the feature rests on: the
 * switch changes the *words* and nothing else. Sorting, filtering, the metric
 * keys, the records handed back to a host and the bytes in an export are all
 * built from canonical English values, and a language that moved any of them
 * would fork the data model per locale. So most of what follows is not "does
 * this string translate" — it is "does this string translate *without* taking
 * anything else with it".
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable } from './DataTable'
import { slug } from './csv'
import { describeCondition, type FilterCondition } from './filters'
import { EN, TR, formatDate, readCell, readEnum } from './i18n'
import { metricGroups, metricLabel, metricNames } from './metrics'
import type { DataTableRecord } from './types'

function setup(props: Partial<React.ComponentProps<typeof DataTable>> = {}) {
  const user = userEvent.setup()
  const utils = render(<DataTable motion="never" {...props} />)
  return { user, ...utils }
}

/** The two segments of the switch, by the language each one names. */
const english = () => screen.getByRole('radio', { name: /English/ })
const turkish = () => screen.getByRole('radio', { name: /Türkçe/ })

const root = () => document.querySelector('.dt-root') as HTMLElement

/** An armed row's cell buttons carry a title, not a name of their own. */
const byTitle = (title: string) =>
  document.querySelector(`[title="${title}"]`) as HTMLElement

describe('the switch itself', () => {
  it('sits beside the title, and opens on English', () => {
    setup()

    const head = document.querySelector('.dt-title-row') as HTMLElement
    expect(within(head).getByRole('heading', { level: 1 })).toHaveTextContent('Data table')
    // In the same row as the title, not somewhere else on the page.
    expect(within(head).getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument()

    expect(english()).toHaveAttribute('aria-checked', 'true')
    expect(turkish()).toHaveAttribute('aria-checked', 'false')
  })

  it('names each language in itself, and the one not in force by the press', () => {
    setup()

    // The segment in force says what it is; the other says what it does. A
    // reader who cannot read the current language is the one reaching for this.
    expect(english()).toHaveAccessibleName('English')
    expect(turkish()).toHaveAccessibleName('Switch to Türkçe')
    // …and each carries its own `lang`, so a screen reader does not read
    // "Türkçe" with English phonemes.
    expect(turkish()).toHaveAttribute('lang', 'tr')
  })

  it('prints a flag and nothing else, without letting it near the name', () => {
    setup()

    // Nothing readable is left in the segment — the codes EN / TR are gone.
    expect(english().textContent).toBe('')
    expect(turkish().textContent).toBe('')

    // The right flag on the right segment: the field colour is the tell, and
    // getting these the wrong way round is the mistake this guards.
    expect(english().querySelector('rect')).toHaveAttribute('fill', '#012169')
    expect(turkish().querySelector('rect')).toHaveAttribute('fill', '#e30a17')

    // …and the mark is hidden, so the name is still the aria-label alone
    // rather than the aria-label with a flag read out in front of it.
    expect(english().querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(english()).toHaveAccessibleName('English')
  })

  it('is measured against every language, so it does not slide when one wins', async () => {
    const { user } = setup()

    const ghosts = () => [
      ...(document.querySelector('.dt-title-ghost')?.children ?? []),
    ].map((say) => say.textContent)

    // The line reserves the widest title in any language rather than measuring
    // the one showing — the title is a word the switch changes, and without
    // this the switch slid out from under the press that moved it.
    expect(document.querySelector('.dt-title-ghost')).toHaveAttribute('aria-hidden', 'true')
    expect(ghosts()).toEqual(['Data table', 'Veri Tablosu'])

    // The heading still answers to one language at a time. The ghosts are its
    // siblings for exactly this reason: hidden keeps them out of the name, not
    // out of `textContent`.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data table')
    expect(screen.getByRole('heading', { name: 'Data table' })).toBeInTheDocument()

    await user.click(turkish())

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Veri Tablosu')
    // …and what is reserved did not move with it.
    expect(ghosts()).toEqual(['Data table', 'Veri Tablosu'])
  })

  it('reserves nothing when nothing can move', () => {
    const { unmount } = setup({ showLanguageSwitch: false })
    // No switch, so nothing sits after the title to be pushed along by it.
    expect(document.querySelector('.dt-title-ghost')).not.toBeInTheDocument()
    unmount()

    // A host that named the title has one string for every language.
    setup({ title: 'Cases' })
    expect(document.querySelector('.dt-title-ghost')).not.toBeInTheDocument()
  })

  it('is one tab stop, and the arrows move inside it', async () => {
    const { user } = setup()

    // Roving tabindex: only the language in force is reachable by Tab.
    expect(english()).toHaveAttribute('tabindex', '0')
    expect(turkish()).toHaveAttribute('tabindex', '-1')

    english().focus()
    await user.keyboard('{ArrowRight}')

    expect(turkish()).toHaveAttribute('aria-checked', 'true')
    expect(turkish()).toHaveFocus()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Veri Tablosu')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Data table')
    expect(english()).toHaveFocus()
  })

  it('goes away on showLanguageSwitch={false}, and the header stays', () => {
    setup({ showLanguageSwitch: false })

    expect(screen.queryByRole('radiogroup', { name: 'Language' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('opens in Turkish on defaultLocale, and stamps the root', () => {
    setup({ defaultLocale: 'tr' })

    expect(root()).toHaveAttribute('lang', 'tr')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Veri Tablosu')
  })
})

describe('controlled and uncontrolled', () => {
  it('owns the language when none is passed', async () => {
    const onLocaleChange = vi.fn()
    const { user } = setup({ onLocaleChange })

    await user.click(turkish())

    expect(onLocaleChange).toHaveBeenCalledWith('tr')
    expect(root()).toHaveAttribute('lang', 'tr')
  })

  it('moves nothing on its own when the host owns it', async () => {
    const onLocaleChange = vi.fn()
    const { user } = setup({ locale: 'en', onLocaleChange })

    await user.click(turkish())

    // Reported, not acted on — the host has to send the next value back.
    expect(onLocaleChange).toHaveBeenCalledWith('tr')
    expect(root()).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Data table')
  })

  it('says out loud that the language changed', async () => {
    const { user } = setup()

    await user.click(turkish())

    // Nothing else announces it: every label on screen has just changed and a
    // screen reader user gets no repaint to notice.
    expect(screen.getByRole('status')).toHaveTextContent('Dil Türkçe olarak ayarlandı.')
  })
})

describe('what the language changes', () => {
  it('translates the chrome from the head to the pager', async () => {
    const { user } = setup()
    await user.click(turkish())

    // Header, stats, toolbar.
    expect(screen.getByText('Toplam')).toBeInTheDocument()
    expect(screen.getByText('Eşleşen')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ad, e-posta veya adres ara')).toBeInTheDocument()
    // Column headings and the action column.
    expect(screen.getByText('Çözülen vaka')).toBeInTheDocument()
    expect(screen.getByText('İşlem')).toBeInTheDocument()
    // The dock's head, the footer count, and the pager.
    expect(screen.getByText('Filtre ekle')).toBeInTheDocument()
    expect(screen.getByText(/kayıttan/)).toHaveTextContent('17 kayıttan 1–8 gösteriliyor')
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sayfalama' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 sayfadan 1.' })).toBeInTheDocument()
  })

  it('translates the accessible names as well as the visible words', async () => {
    const { user } = setup()
    await user.click(turkish())

    expect(screen.getByRole('button', { name: 'Yeni kayıt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sütunu sırala: Ad' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Bu sayfadaki tüm satırları seç' }),
    ).toBeInTheDocument()
  })

  it('translates the detail pane', async () => {
    const { user } = setup()
    await user.click(turkish())
    await user.click(screen.getAllByRole('button', { name: 'Ayrıntıları aç/kapat' })[0])

    expect(screen.getByText('Kayıt no')).toBeInTheDocument()
    expect(screen.getByText('Son işlem')).toBeInTheDocument()
    expect(screen.getByText('Not')).toBeInTheDocument()
  })

  it('reads a status pill in the language and keeps its colour class', async () => {
    const { user } = setup()
    await user.click(turkish())

    const pill = screen.getAllByText('Başarılı')[0]
    // The word is the locale's; the class is the canonical value's, or the
    // green pill would go grey the moment the language changed.
    expect(pill).toHaveClass('dt-success')
  })

  it('reads a date in the language without restating it', async () => {
    const { user } = setup()

    const before = screen.getAllByText(/August, 20\d\d/)[0].textContent
    await user.click(turkish())

    expect(screen.getAllByText(/Ağustos, 20\d\d/)[0].textContent).toBe(
      before?.replace('August', 'Ağustos'),
    )
  })
})

describe('what the language must not change', () => {
  it('leaves the records canonical', async () => {
    const onRecordsChange = vi.fn()
    const { user } = setup({ onRecordsChange })

    await user.click(turkish())
    // Delete a row to make the component hand its list back.
    await user.click(screen.getAllByRole('button', { name: 'Kaydı sil' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Silmeyi onayla' })[0])

    const next: DataTableRecord[] = onRecordsChange.mock.calls[0][0]
    // Statuses, seasons and dates go back the way they came in, whatever the
    // table is currently reading them as.
    expect(next.every((r) => ['Success', 'In progress', 'Failed'].includes(r.status))).toBe(true)
    expect(next.some((r) => /August|January|March/.test(r.date))).toBe(true)
  })

  it('commits the canonical value when a status is picked in Turkish', async () => {
    const onRecordsChange = vi.fn()
    const { user } = setup({ onRecordsChange })
    await user.click(turkish())

    // Arm the row, pick the status cell, then choose the Turkish word.
    await user.click(screen.getAllByRole('button', { name: 'Kaydı düzenle' })[0])
    await user.click(byTitle('Düzenle: Durum'))
    await user.click(
      within(screen.getByRole('group', { name: 'Düzenle: Durum' })).getByRole('button', {
        name: 'Başarısız',
      }),
    )

    const next: DataTableRecord[] = onRecordsChange.mock.calls.at(-1)![0]
    expect(next[0].status).toBe('Failed')
  })

  it('keeps a filter chip matching on the canonical value', async () => {
    const { user } = setup()
    await user.click(turkish())

    // Exactly, not by pattern: the column grips' names mention the dock's
    // "Filtre ekle" button too, so a regex here matches seven things.
    await user.click(screen.getByRole('button', { name: 'Filtre ekle' }))
    await user.click(screen.getByRole('option', { name: 'Durum' }))
    // A freshly added chip opens itself, so there is nothing to press first.
    const pop = screen.getByRole('dialog', { name: 'Filtre: Durum' })
    await user.click(within(pop).getByRole('option', { name: 'Başarılı' }))

    // The chip prints the Turkish word…
    expect(document.querySelector('.dt-chip-value')).toHaveTextContent('Başarılı')
    // …and the rows it left are the ones whose canonical status is Success.
    const pills = document.querySelectorAll('tbody .dt-pill')
    expect(pills.length).toBeGreaterThan(0)
    pills.forEach((pill) => expect(pill).toHaveClass('dt-success'))
  })

  it('keeps the sort where it was through a change of language', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    const before = Array.from(document.querySelectorAll('.dt-name-text')).map(
      (el) => el.textContent,
    )

    await user.click(turkish())

    const after = Array.from(document.querySelectorAll('.dt-name-text')).map(
      (el) => el.textContent,
    )
    expect(after).toEqual(before)
    expect(screen.getByRole('button', { name: 'Sütunu sırala: Ad' })).toBeInTheDocument()
  })

  it('stamps a new record with an English date whatever the language', async () => {
    const onRecordsChange = vi.fn()
    const { user } = setup({ onRecordsChange })
    await user.click(turkish())

    await user.click(screen.getByRole('button', { name: 'Yeni kayıt' }))
    await user.type(screen.getByLabelText('Ad'), 'Ayşe Yılmaz')
    await user.click(screen.getByRole('button', { name: 'Kaydı kaydet' }))

    const next: DataTableRecord[] = onRecordsChange.mock.calls.at(-1)![0]
    // The stored month is English, because `filters.ts` parses it and
    // `compareCells` sorts it as text. Turkish goes on at render.
    expect(next[0].date).toMatch(
      /^\d{2} (January|February|March|April|May|June|July|August|September|October|November|December), \d{4}$/,
    )
    // The free-text detail fields, which nothing parses, do follow the language.
    expect(next[0].owner).toBe('Atanmadı')
  })
})

describe('the pure helpers', () => {
  it('reads an enum value in a language and passes an unknown one through', () => {
    expect(readEnum(TR, 'status', 'In progress')).toBe('Devam ediyor')
    expect(readEnum(TR, 'favouriteSeason', 'Spring')).toBe('İlkbahar')
    // A host's own status is still the record's value; blanking it would be
    // worse than leaving it in the language it arrived in.
    expect(readEnum(TR, 'status', 'Escalated')).toBe('Escalated')
    // A column with no vocabulary is untouched.
    expect(readEnum(TR, 'name', 'Success')).toBe('Success')
  })

  it('swaps a month it knows and leaves every other date alone', () => {
    expect(formatDate(TR, '19 August, 2026')).toBe('19 Ağustos, 2026')
    expect(formatDate(EN, '19 August, 2026')).toBe('19 August, 2026')
    // A host feeding ISO dates, or its own format, sees them unchanged.
    expect(formatDate(TR, '2026-08-19')).toBe('2026-08-19')
    expect(formatDate(TR, '19 Ağustos, 2026')).toBe('19 Ağustos, 2026')
  })

  it('routes a cell through the right vocabulary', () => {
    expect(readCell(TR, 'date', '19 August, 2026')).toBe('19 Ağustos, 2026')
    expect(readCell(TR, 'status', 'Failed')).toBe('Başarısız')
    expect(readCell(TR, 'address', '19 August Street')).toBe('19 August Street')
  })

  it('defaults every locale-aware helper to English', () => {
    expect(metricLabel('sum')).toBe('Sum')
    expect(metricNames(['sum', 'mean'])).toBe('Sum, Mean')
    expect(metricGroups()[0].label).toBe('Numbers')

    const condition: FilterCondition = {
      id: 'c1',
      key: 'name',
      op: 'contains',
      values: [],
      value: 'Ada',
      value2: '',
    }
    expect(describeCondition(condition)).toBe('contains Ada')
  })

  it('reads a metric and a condition in Turkish', () => {
    expect(metricLabel('sum', TR)).toBe('Toplam')
    // The option is the canonical value, read into the language *before* the
    // word "oranı" goes on — the other order prints "Success oranı".
    expect(metricLabel('rate:status:Success', TR)).toBe('Başarılı oranı')
    expect(metricGroups(TR)[0].label).toBe('Sayılar')

    const between: FilterCondition = {
      id: 'c2',
      key: 'solvedCases',
      op: 'between',
      values: [],
      value: '10',
      value2: '20',
    }
    // Turkish ends the clause with a postposition, so the operator word cannot
    // simply be swapped in front of the operands.
    expect(describeCondition(between, TR)).toBe('10 ile 20 arasında')

    const enumOn: FilterCondition = {
      id: 'c3',
      key: 'status',
      op: 'isAnyOf',
      values: ['Success', 'Failed'],
      value: '',
      value2: '',
    }
    expect(describeCondition(enumOn, TR)).toBe('Başarılı, Başarısız')
    expect(describeCondition({ ...enumOn, values: [] }, TR)).toBe('Hepsi')
  })

  it('folds Turkish letters into an export file name instead of dropping them', () => {
    // `Çözülen vaka` went to `z-len-vaka` when everything outside a-z0-9 was
    // simply a separator.
    expect(slug('Çözülen vaka')).toBe('cozulen-vaka')
    expect(slug('İşlem Günlüğü')).toBe('islem-gunlugu')
    expect(slug('Veri Tablosu')).toBe('veri-tablosu')
    expect(slug('Data table')).toBe('data-table')
  })

  it('names every string in both languages', () => {
    // The two dictionaries are one `Strings` type, so a key added to English
    // fails to compile until Turkish names it. This catches the other half: a
    // Turkish entry left as its English placeholder.
    const same = (Object.keys(EN) as Array<keyof typeof EN>).filter(
      (key) => typeof EN[key] === 'string' && EN[key] === TR[key],
    )
    // `Plan` is genuinely the same word in both; nothing else should be.
    expect(same).toEqual(['panePlan'])
  })
})

/**
 * PORT ADDITION: the language switch, beside the title.
 *
 * A two-segment flat switch rather than a dropdown, for the same reason the
 * prototype spent a segmented control on the status filter: with two options
 * there is nothing to reveal, and a popup would hide half the answer behind a
 * press. Both languages are on screen, and the one in force is the filled one.
 *
 * `role="radiogroup"` with a **roving tab stop**, not two plain toggle buttons.
 * Two buttons would be two tab stops in a header that currently has none, to
 * express one choice — and the port already spends two stops per column further
 * down. So: Tab reaches the group once, landing on the language in force, and
 * the arrows (plus Home / End) move between them. That is the same keyboard
 * contract `FilterMenu` and the dock's lists answer, one level simpler because
 * this list is never closed.
 *
 * Arrows commit here, unlike the metric cog's, and the difference is deliberate:
 * a radio group's convention *is* select-on-arrow, and there are only two stops,
 * so there is no passing-through to be caught out by — Right from English is
 * Turkish, which is the only other thing the control can mean.
 *
 * The segments print flags rather than the codes `EN` / `TR`, and it is worth
 * being straight about what that costs: a flag is a country, not a language —
 * the Union Flag is standing in for one spoken in dozens of them — and a reader
 * who does not recognise the mark now has nothing to read. What does not change
 * is the control's *name*. `aria-label` still carries "English" / "Switch to
 * Türkçe", `title` still surfaces the language on hover, and `LOCALE_SHORT` is
 * still exported for a host that wants the codes back. The flags are
 * `aria-hidden`, so the accessibility tree is byte-for-byte what it was.
 */
import { useRef, type KeyboardEvent, type ReactElement } from 'react'

import { FlagGB, FlagTR } from './flags'
import { LOCALES, LOCALE_NAMES, type Locale, type Strings } from './i18n'

/**
 * The mark each segment prints. A `Record<Locale, …>` on purpose: a third
 * language cannot be added to `LOCALES` without the compiler asking what it
 * looks like.
 */
const FLAGS: Record<Locale, ReactElement> = {
  en: <FlagGB className="dt-lang-flag" />,
  tr: <FlagTR className="dt-lang-flag" />,
}

export interface LanguageSwitchProps {
  value: Locale
  /** The dictionary in force — the group's own name comes from it. */
  strings: Strings
  onPick: (next: Locale) => void
}

export function LanguageSwitch({ value, strings, onPick }: LanguageSwitchProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (to: number) => {
    const at = Math.max(0, Math.min(LOCALES.length - 1, to))
    const next = LOCALES[at]
    // Focus first, then commit. The other order re-renders the group under the
    // pointer before the element being focused exists in its new state, which
    // on a locale change is a full re-render of the table.
    refs.current[at]?.focus()
    if (next !== value) onPick(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        move(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        move(index - 1)
        break
      case 'Home':
        event.preventDefault()
        move(0)
        break
      case 'End':
        event.preventDefault()
        move(LOCALES.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div className="dt-lang" role="radiogroup" aria-label={strings.language}>
      {LOCALES.map((locale, index) => {
        const on = locale === value
        return (
          <button
            key={locale}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            /* The segment in force names itself; the other one names the press.
               "English" alone on the segment you are about to hit says what it
               is rather than what it does, and this control's whole job is the
               doing. `lang` on each button is not decoration either — without
               it a screen reader reads "Türkçe" with English phonemes. */
            lang={locale}
            aria-label={on ? LOCALE_NAMES[locale] : strings.switchTo(LOCALE_NAMES[locale])}
            title={LOCALE_NAMES[locale]}
            tabIndex={on ? 0 : -1}
            className={on ? 'dt-lang-seg dt-on' : 'dt-lang-seg'}
            onClick={() => onPick(locale)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {FLAGS[locale]}
          </button>
        )
      })}
    </div>
  )
}

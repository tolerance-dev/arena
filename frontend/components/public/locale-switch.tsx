'use client'

import { Segmented } from '@/components/ui/segmented'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n'
import { useSetLocale, useT } from '@/lib/i18n-client'

// EN / RU toggle. The choice is saved in a cookie; without one the browser's language decides.
export function LocaleSwitch({ className }: { className?: string }) {
  const t = useT()
  const setLocale = useSetLocale()
  return (
    <Segmented<Locale> label={t('Язык', 'Language')} value={t.locale} onChange={setLocale} className={className}
      options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), title: LOCALE_NAMES[l], lang: l }))} />
  )
}

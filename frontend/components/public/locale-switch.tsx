'use client'

import { Segmented } from '@/components/ui/segmented'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/core'
import { useLocale, useSetLocale, useT } from '@/lib/i18n/client'
import { navMessages } from '@/lib/i18n/messages/nav'

// EN / RU toggle. The choice is saved in a cookie; without one the browser's language decides.
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale()
  const setLocale = useSetLocale()
  const t = useT(navMessages)
  return (
    <Segmented<Locale> label={t('language')} value={locale} onChange={setLocale} className={className}
      options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), title: LOCALE_NAMES[l], lang: l }))} />
  )
}

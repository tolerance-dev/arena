'use client'

import { LOCALES, LOCALE_NAMES } from '@/lib/i18n/core'
import { useLocale, useSetLocale, useT } from '@/lib/i18n/client'
import { navMessages } from '@/lib/i18n/messages/nav'
import { cn } from '@/lib/utils'

// EN / RU toggle. The choice is saved in a cookie; without one the browser's language decides.
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale()
  const setLocale = useSetLocale()
  const t = useT(navMessages)
  return (
    <div role="group" aria-label={t('language')} className={cn('flex h-8 items-center gap-0.5 text-xs font-semibold', className)}>
      {LOCALES.map((l) => (
        <button key={l} type="button" lang={l} title={LOCALE_NAMES[l]} aria-pressed={l === locale}
          onClick={() => l !== locale && setLocale(l)}
          className={cn('h-7 rounded-sm px-1.5 transition-colors',
            l === locale ? 'text-foreground underline decoration-2 underline-offset-[6px] decoration-primary' : 'text-muted-foreground hover:text-foreground')}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_LOCALE, LOCALE_COOKIE, makeT, type Locale, type T } from './i18n'

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

// Set once in the root layout from the cookie / Accept-Language the server saw.
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useT(): T {
  const locale = useContext(LocaleContext)
  return useMemo(() => makeT(locale), [locale])
}

// Saves the choice for a year and re-renders server components in the new language.
export function useSetLocale() {
  const router = useRouter()
  return useCallback((locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])
}

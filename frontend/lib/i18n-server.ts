import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, makeT, pickLocale, type Locale, type T } from './i18n'

// The reader's language on the server: the saved cookie, else Accept-Language, else English.
export async function getLocale(): Promise<Locale> {
  const [c, h] = await Promise.all([cookies(), headers()])
  return pickLocale(c.get(LOCALE_COOKIE)?.value, h.get('accept-language'))
}

export async function getT(): Promise<T> {
  return makeT(await getLocale())
}

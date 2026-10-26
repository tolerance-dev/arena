// The site in two languages. No message tables: every string is written inline in both languages,
// Russian first:
//
//   const t = useT()           // client component
//   const t = await getT()     // server component / generateMetadata
//   t('Голосовать', 'Vote')
//   t.plural(n, ['{n} день', '{n} дня', '{n} дней'], ['{n} day', '{n} days'])
//   t.text(task.title)         // a {en, ru} string from the API

export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'lang'
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' }

export interface Text { en: string; ru: string }

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

// The saved choice wins; otherwise the first of our languages in Accept-Language (by preference order); otherwise
// English.
export function pickLocale(saved?: string | null, acceptLanguage?: string | null): Locale {
  if (isLocale(saved)) return saved
  const prefs = (acceptLanguage ?? '').split(',').map((part, i) => {
    const [tag, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    return { lang: tag.split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i }
  }).sort((a, b) => b.q - a.q || a.i - b.i)
  return prefs.find((p) => p.q > 0 && isLocale(p.lang))?.lang as Locale | undefined ?? DEFAULT_LOCALE
}

// BCP 47 tag for Intl formatting. en-GB keeps day-month order and a 24h clock.
export function intlLocale(locale: Locale) {
  return locale === 'ru' ? 'ru-RU' : 'en-GB'
}

// Russian plural forms: ruPlural(5, ['{n} день', '{n} дня', '{n} дней']) → "5 дней".
function ruPlural(n: number, [one, few, many]: [string, string, string]) {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100
  return !Number.isInteger(n) ? few : d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many
}

export type T = {
  (ru: string, en: string): string
  locale: Locale
  // {n} in the chosen form is replaced with n.
  plural: (n: number, ru: [one: string, few: string, many: string], en: [one: string, other: string]) => string
  text: (x: Text | null | undefined) => string
  // 1234567 → "1 234 567" / "1,234,567".
  num: (n: number) => string
  date: (iso: string | number | Date, opts?: Intl.DateTimeFormatOptions) => string
}

export function makeT(locale: Locale): T {
  const t = ((ru: string, en: string) => (locale === 'ru' ? ru : en)) as T
  t.locale = locale
  t.plural = (n, ru, en) => {
    const form = locale === 'ru' ? ruPlural(n, ru) : n === 1 ? en[0] : en[1]
    return form.replace(/\{n\}/g, String(n))
  }
  t.text = (x) => (x ? (locale === 'ru' ? x.ru : x.en) || x.en || x.ru : '')
  t.num = (n) => n.toLocaleString(intlLocale(locale))
  t.date = (iso, opts) => new Date(iso).toLocaleString(intlLocale(locale), opts)
  return t
}

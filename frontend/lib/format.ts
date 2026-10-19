import type { Locale } from '@/lib/i18n/core'

// 754 → "12:34", 4000 → "1:06:40".
export function duration(sec: number | null | undefined) {
  if (sec == null) return '—'
  const s = Math.max(0, Math.round(sec))
  const p = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

// 1234567 → "1.23M", 45600 → "45.6k".
export function compact(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return String(n)
}

export function grouped(n: number, locale: Locale = 'en') {
  return n.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB')
}

// Budget-counted tokens: fresh input + cache writes + output.
export function usedTokens(t: { in: number; out: number; cache_write: number }) {
  return t.in + t.cache_write + t.out
}

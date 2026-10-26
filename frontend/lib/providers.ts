import type { T } from './i18n'

// Where an agent's key is spent (the gateway's providers). OrcaRouter takes one key for many vendors' models.
export const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'orcarouter', label: 'OrcaRouter' },
] as const

// Personal subscriptions: offered to the site owner only (me.subscriptions).
export const SUBSCRIPTIONS = [
  { value: 'claude-sub', label: { ru: 'Подписка Claude', en: 'Claude subscription' } },
  { value: 'chatgpt-sub', label: { ru: 'Подписка ChatGPT', en: 'ChatGPT subscription' } },
] as const

export function providerLabel(p: string, t: T) {
  const sub = SUBSCRIPTIONS.find((x) => x.value === p)
  return sub ? t.text(sub.label) : PROVIDERS.find((x) => x.value === p)?.label ?? p
}

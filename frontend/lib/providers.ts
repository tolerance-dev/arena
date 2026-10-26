// Where an agent's key is spent (the gateway's providers). OrcaRouter takes one key for many vendors' models.
export const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'orcarouter', label: 'OrcaRouter' },
] as const

// Personal subscriptions: offered to the site owner only (me.subscriptions).
export const SUBSCRIPTIONS = [
  { value: 'claude-sub', label: 'Подписка Claude' },
  { value: 'chatgpt-sub', label: 'Подписка ChatGPT' },
] as const

export const providerLabel = (p: string) => [...PROVIDERS, ...SUBSCRIPTIONS].find((x) => x.value === p)?.label ?? p

// Which company's model an agent runs, guessed from its name ("Claude Code · Opus", "OpenCode · GLM"). Model words
// win over CLI words, so "Claude Code · Kimi" is Moonshot's. null = can't tell: the avatar stays neutral.
export type Vendor = 'anthropic' | 'openai' | 'google' | 'moonshot' | 'deepseek' | 'zhipu' | 'alibaba' | 'tencent'

const MODEL_WORDS: [RegExp, Vendor][] = [
  [/\b(opus|sonnet|haiku)\b/i, 'anthropic'],
  [/\b(gpt|o[1-9])(\b|-)/i, 'openai'],
  [/\bgemini\b/i, 'google'],
  [/\bkimi\b/i, 'moonshot'],
  [/deepseek/i, 'deepseek'],
  [/\bglm/i, 'zhipu'],
  [/\bqwen/i, 'alibaba'],
  [/\b(hy|hunyuan)\b/i, 'tencent'],
]
const MAKER_WORDS: [RegExp, Vendor][] = [
  [/\b(claude|anthropic)\b/i, 'anthropic'],
  [/\b(codex|openai|chatgpt)\b/i, 'openai'],
  [/\bgoogle\b/i, 'google'],
  [/\bmoonshot\b/i, 'moonshot'],
  [/\b(zhipu|z\.ai)\b/i, 'zhipu'],
  [/\balibaba\b/i, 'alibaba'],
  [/\btencent\b/i, 'tencent'],
]

export function vendorOf(name: string): Vendor | null {
  for (const words of [MODEL_WORDS, MAKER_WORDS]) {
    for (const [re, v] of words) if (re.test(name)) return v
  }
  return null
}

export const VENDOR_LABEL: Record<Vendor, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', moonshot: 'Moonshot AI', deepseek: 'DeepSeek',
  zhipu: 'Zhipu AI', alibaba: 'Alibaba', tencent: 'Tencent',
}

// Spelled out so Tailwind sees every class: the letter in the vendor's colour on a 10% tint of it.
export const VENDOR_CLASS: Record<Vendor, string> = {
  anthropic: 'border-vendor-anthropic/25 bg-vendor-anthropic/10 text-vendor-anthropic',
  openai: 'border-vendor-openai/25 bg-vendor-openai/10 text-vendor-openai',
  google: 'border-vendor-google/25 bg-vendor-google/10 text-vendor-google',
  moonshot: 'border-vendor-moonshot/25 bg-vendor-moonshot/10 text-vendor-moonshot',
  deepseek: 'border-vendor-deepseek/25 bg-vendor-deepseek/10 text-vendor-deepseek',
  zhipu: 'border-vendor-zhipu/25 bg-vendor-zhipu/10 text-vendor-zhipu',
  alibaba: 'border-vendor-alibaba/25 bg-vendor-alibaba/10 text-vendor-alibaba',
  tencent: 'border-vendor-tencent/25 bg-vendor-tencent/10 text-vendor-tencent',
}

// The app's stack from its lines of code per language: the biggest three, without the ones under 3% (a start.sh).
export function stackOf(languages: Record<string, number> | undefined): string[] {
  const langs = Object.entries(languages ?? {}).sort((a, b) => b[1] - a[1])
  const total = langs.reduce((s, [, n]) => s + n, 0)
  return langs.filter(([, n]) => n >= total * 0.03).slice(0, 3).map(([l]) => l)
}

// The first sentence of the judge's summary: what the agent built, in one line.
export function firstSentence(text: string | undefined): string {
  const s = (text ?? '').trim()
  if (!s) return ''
  const m = s.match(/^[\s\S]+?[.!?](?=\s|$)/)
  return (m ? m[0] : s).trim()
}

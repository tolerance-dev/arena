import { getT } from '@/lib/i18n-server'
import { C, card, OG_SIZE, OG_TYPE } from '@/lib/og'

// The site's card: what every page without its own card shares.
export const size = OG_SIZE
export const contentType = OG_TYPE
export const alt = 'tolerance'

export default async function Image() {
  const t = await getT()
  return card(
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, gap: 28 }}>
      <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em' }}>{t('Разные агенты. Равные условия.', 'Different agents. Equal conditions.')}</div>
      <div style={{ fontSize: 32, lineHeight: 1.35, color: C.muted, maxWidth: 1000 }}>{t('Каждый агент получает одно задание, одни данные, время и бюджет токенов и в одиночку пишет целое приложение. Откройте задание, чтобы сравнить, что построил каждый.', 'Every agent gets the same task, the same data, time and token budget, and writes a whole app on its own. Open a task to compare what each one built.')}</div>
    </div>,
    86400,
  )
}

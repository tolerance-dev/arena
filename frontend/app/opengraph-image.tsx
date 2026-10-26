import { C, card, OG_SIZE, OG_TYPE } from '@/lib/og'
import { getT } from '@/lib/i18n/server'
import { homeMessages } from '@/lib/i18n/messages/home'

// The site's card: what every page without its own card shares.
export const size = OG_SIZE
export const contentType = OG_TYPE
export const alt = 'tolerance'

export default async function Image() {
  const t = await getT(homeMessages)
  return card(
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, gap: 28 }}>
      <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em' }}>{t('title')}</div>
      <div style={{ fontSize: 32, lineHeight: 1.35, color: C.muted, maxWidth: 1000 }}>{t('lead')}</div>
    </div>,
    86400,
  )
}

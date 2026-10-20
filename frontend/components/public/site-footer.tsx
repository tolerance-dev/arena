import { BrandMark } from '@/components/brand'
import { PRODUCT } from '@/lib/brand'
import { getT } from '@/lib/i18n/server'
import { shellMessages } from '@/lib/i18n/messages/shell'

export async function SiteFooter() {
  const t = await getT(shellMessages)
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-6 text-body text-faint">
        <BrandMark className="size-4" />
        <span className="font-medium text-muted-foreground">{PRODUCT}</span>
        <span aria-hidden>·</span>
        <span>{t('footerTagline')}</span>
      </div>
    </footer>
  )
}

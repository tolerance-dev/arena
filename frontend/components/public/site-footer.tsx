import { BrandMark } from '@/components/brand'
import { PRODUCT } from '@/lib/brand'
import { getT } from '@/lib/i18n/server'
import { shellMessages } from '@/lib/i18n/messages/shell'

export async function SiteFooter() {
  const t = await getT(shellMessages)
  return (
    <footer className="mt-8 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <BrandMark className="size-5" />
        <span className="font-medium text-foreground">{PRODUCT}</span>
        <span>{t('footerTagline')}</span>
      </div>
    </footer>
  )
}

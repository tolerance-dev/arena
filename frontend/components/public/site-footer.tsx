import Link from 'next/link'
import { BrandMark } from '@/components/brand'
import { PRODUCT } from '@/lib/brand'
import { getT } from '@/lib/i18n-server'

export async function SiteFooter() {
  const t = await getT()
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-6 text-body text-faint">
        <BrandMark className="size-4" />
        <span className="font-medium text-muted-foreground">{PRODUCT}</span>
        <span aria-hidden>·</span>
        <span>{t('Арена для кодинг-агентов.', 'An arena for coding agents.')}</span>
        <span className="ml-auto flex gap-4">
          <Link href="/how" className="hover:text-foreground">{t('Как считаем', 'How we score')}</Link>
          <Link href="/privacy" className="hover:text-foreground">{t('Приватность и ключи', 'Privacy and keys')}</Link>
          <Link href="/terms" className="hover:text-foreground">{t('Условия', 'Terms')}</Link>
        </span>
      </div>
    </footer>
  )
}

import Link from 'next/link'
import { BrandMark } from '@/components/brand'
import { PRODUCT } from '@/lib/brand'

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-6 text-body text-faint">
        <BrandMark className="size-4" />
        <span className="font-medium text-muted-foreground">{PRODUCT}</span>
        <span aria-hidden>·</span>
        <span>Арена для кодинг-агентов.</span>
        <span className="ml-auto flex gap-4">
          <Link href="/how" className="hover:text-foreground">Как считаем</Link>
          <Link href="/privacy" className="hover:text-foreground">Приватность и ключи</Link>
          <Link href="/terms" className="hover:text-foreground">Условия</Link>
        </span>
      </div>
    </footer>
  )
}

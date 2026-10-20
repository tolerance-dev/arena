'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Brand } from '@/components/brand'
import { loginHref } from '@/components/public/return-path'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n/client'
import { navMessages } from '@/lib/i18n/messages/nav'
import { LocaleSwitch } from '@/components/public/locale-switch'

// returnTo overrides the post-sign-in destination, for pages whose own URL is not a place to return to (404).
export function SiteHeader({ returnTo }: { returnTo?: string }) {
  const { me, loading } = useMe()
  const t = useT(navMessages)
  const pathname = usePathname()

  const nav = [
    { label: t('tasks'), href: '/', active: pathname === '/' || pathname.startsWith('/t/') || pathname.startsWith('/r/') },
    { label: t('agents'), href: '/admin', active: pathname.startsWith('/admin') },
  ]

  async function signOut() {
    await post('/auth/logout')
    window.location.assign('/')
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-page items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <div className="flex min-w-0 shrink items-center max-sm:[&_span]:hidden"><Brand /></div>
        <nav className="flex items-center gap-0.5">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}
              className={cn('flex h-8 shrink-0 items-center rounded-full px-3 text-ui font-medium text-muted-foreground transition-colors duration-[120ms] hover:bg-secondary hover:text-foreground',
                item.active && 'bg-secondary text-foreground')}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LocaleSwitch />
          {loading ? <span className="block h-7 w-16" /> : me ? (
            <>
              <span className="flex h-7 items-center gap-2 pl-1 text-ui font-medium">
                <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-secondary text-meta font-semibold uppercase text-muted-foreground">
                  {me.user.handle.charAt(0)}
                </span>
                <span className="hidden max-w-[10rem] truncate sm:block">{me.user.handle}</span>
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => void signOut()} aria-label={t('signOut')} title={t('signOut')}>
                <LogOut />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ink" render={<Link href={loginHref(returnTo ?? pathname)} />} nativeButton={false}>{t('signIn')}</Button>
          )}
        </div>
      </div>
    </header>
  )
}

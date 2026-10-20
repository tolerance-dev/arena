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
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-stretch gap-6 px-4 sm:px-6">
        <div className="flex min-w-0 shrink items-center max-[400px]:[&_span]:hidden"><Brand /></div>
        <nav className="flex items-stretch gap-5">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}
              className={cn('-mb-px flex shrink-0 items-center border-b-2 border-transparent text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                item.active && 'border-primary text-foreground')}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <LocaleSwitch />
          {loading ? null : me ? (
            <>
              <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{me.user.handle}</span>
              <button onClick={() => void signOut()} aria-label={t('signOut')} title={t('signOut')}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Button size="sm" render={<Link href={loginHref(returnTo ?? pathname)} />} nativeButton={false}>{t('signIn')}</Button>
          )}
        </div>
      </div>
    </header>
  )
}

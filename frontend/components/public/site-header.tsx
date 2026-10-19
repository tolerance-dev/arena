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

  const nav = [{ label: t('tasks'), href: '/', active: pathname === '/' || pathname.startsWith('/t/') || pathname.startsWith('/r/') }]
  if (me?.can_admin) nav.push({ label: t('admin'), href: '/admin', active: pathname.startsWith('/admin') })

  async function signOut() {
    await post('/auth/logout')
    window.location.assign('/')
  }

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <div className="min-w-0 shrink overflow-hidden max-[400px]:[&_span]:hidden"><Brand /></div>
        <nav className="ml-1 flex items-center gap-1">
          {nav.map((item) => (
            <Link key={item.href} href={item.href}
              className={cn('shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground',
                item.active && 'bg-muted text-foreground')}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LocaleSwitch />
          {loading ? null : me ? (
            <>
              <span className="hidden h-9 items-center rounded-full border border-border bg-card px-3 text-sm font-bold sm:flex">
                <span className="max-w-[8rem] truncate">{me.user.handle}</span>
              </span>
              <button onClick={() => void signOut()} aria-label={t('signOut')} title={t('signOut')}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Button render={<Link href={loginHref(returnTo ?? pathname)} />} nativeButton={false}>{t('signIn')}</Button>
          )}
        </div>
      </div>
    </header>
  )
}

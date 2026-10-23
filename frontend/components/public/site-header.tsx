'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Menu, X } from 'lucide-react'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { Brand } from '@/components/brand'
import { loginHref } from '@/components/public/return-path'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n/client'
import { navMessages } from '@/lib/i18n/messages/nav'
import { LocaleSwitch } from '@/components/public/locale-switch'

// Product Hunt's header: logo, 16px semibold nav that takes the accent colour on hover, pill buttons on the right.
// Phones get a menu button instead of the nav. returnTo overrides the post-sign-in destination (404).
export function SiteHeader({ returnTo }: { returnTo?: string }) {
  const { me, loading } = useMe()
  const t = useT(navMessages)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const signIn = useSignIn()
  useEffect(() => setOpen(false), [pathname])

  const nav = [
    { label: t('tasks'), href: '/', active: pathname === '/' || pathname.startsWith('/t/') || pathname.startsWith('/r/') },
    { label: t('agents'), href: '/agents', active: pathname.startsWith('/agents') },
    { label: t('leaderboard'), href: '/leaderboard', active: pathname.startsWith('/leaderboard') },
    { label: t('myAgents'), href: '/my', active: pathname.startsWith('/my') },
  ]

  async function signOut() {
    await post('/auth/logout')
    window.location.assign('/')
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex h-[58px] max-w-page items-center gap-6 px-4 md:h-[72px] md:gap-10">
        <Brand />
        <nav className="hidden items-center gap-7 md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}
              className={cn('text-title font-semibold transition-colors duration-150 hover:text-primary',
                item.active ? 'text-foreground' : 'text-muted-foreground')}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <LocaleSwitch className="max-sm:hidden" />
          {loading ? <span className="block h-9 w-20" /> : me ? (
            <>
              <span className="hidden max-w-[10rem] truncate text-body font-semibold sm:block">{me.user.handle}</span>
              <Button variant="outline" size="icon" onClick={() => void signOut()} aria-label={t('signOut')} title={t('signOut')}>
                <LogOut />
              </Button>
            </>
          ) : (
            signIn
              ? <Button onClick={signIn}>{t('signIn')}</Button>
              : <Button render={<Link href={loginHref(returnTo ?? pathname)} />} nativeButton={false}>{t('signIn')}</Button>
          )}
          <Button variant="outline" size="icon" className="md:hidden" aria-label={t('menu')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border px-4 pt-2 pb-4 md:hidden">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}
              className={cn('flex h-11 items-center rounded-xl px-3 text-title font-semibold',
                item.active ? 'bg-secondary text-foreground' : 'text-muted-foreground')}>
              {item.label}
            </Link>
          ))}
          <LocaleSwitch className="mt-3 ml-3 sm:hidden" />
        </nav>
      )}
    </header>
  )
}

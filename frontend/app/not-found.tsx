import Link from 'next/link'
import { SignInProvider } from '@/components/auth/sign-in-dialog'
import { SiteFooter } from '@/components/public/site-footer'
import { SiteHeader } from '@/components/public/site-header'
import { Button } from '@/components/ui/button'
import { getT } from '@/lib/i18n-server'

export default async function NotFound() {
  const t = await getT()
  return (
    <SignInProvider>
    <div className="flex min-h-dvh flex-col">
      <SiteHeader returnTo="/" />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <p className="font-mono text-ui text-faint">404</p>
        <h1 className="display mt-2 text-page">{t('Здесь пусто', 'Nothing here')}</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{t('Такой страницы нет, либо она переехала.', 'This page doesn’t exist or has moved.')}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button render={<Link href="/" />} nativeButton={false}>{t('К заданиям', 'To the tasks')}</Button>
        </div>
      </main>
      <SiteFooter />
    </div>
    </SignInProvider>
  )
}

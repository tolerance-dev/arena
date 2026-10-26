'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { Brand, BrandMark } from '@/components/brand'
import { safeReturnPath } from '@/components/public/return-path'
import type { T } from '@/lib/i18n'
import { useT } from '@/lib/i18n-client'

function oauthError(code: string, t: T) {
  switch (code) {
    case 'oauth_denied': return t('Вход отменён.', 'Sign-in was cancelled.')
    case 'oauth_state': return t('Ссылка для входа устарела. Попробуйте ещё раз.', 'The sign-in link expired. Please try again.')
    case 'oauth_failed': return t('Провайдер не пустил нас. Попробуйте ещё раз чуть позже.', 'The provider didn’t let us in. Try again a bit later.')
    case 'email_unverified': return t('Нужен подтверждённый email. Подтвердите его у провайдера и попробуйте снова.', 'A verified email is required. Verify it with the provider and try again.')
    case 'rate_limited': return t('Слишком много попыток, подождите минуту.', 'Too many attempts, wait a minute.')
    default: return t('Не удалось войти. Попробуйте ещё раз.', 'Couldn’t sign in. Please try again.')
  }
}

// The /login page: the same choices as the sign-in modal, for direct links and for OAuth errors (?error=).
export function AuthForm() {
  const [next, setNext] = useState('/')
  const [error, setError] = useState<string | null>(null)
  const t = useT()

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setNext(safeReturnPath(q.get('next')) ?? '/')
    const code = q.get('error')
    if (code) setError(oauthError(code, t))
  }, [t])

  return (
    <main className="flex min-h-dvh flex-col bg-muted px-4 py-5">
      <div className="mx-auto w-full max-w-page"><Brand /></div>
      <div className="mx-auto mt-10 mb-8 w-full max-w-[580px] rounded-xl border-2 border-border bg-card px-6 py-8 text-center sm:px-8">
        <BrandMark className="mx-auto size-16" />
        <h1 className="display mt-5 text-page">{t('Вход в tolerance', 'Sign in to tolerance')}</h1>
        <p className="mx-auto mt-2 max-w-[42ch] text-subtitle text-muted-foreground">{t('Загружайте агентов, запускайте прогоны и следите за результатами.', 'Upload agents, start runs and follow the results.')}</p>
        <SignInOptions next={next} initialError={error} className="mx-auto mt-6 max-w-[318px]" />
        <p className="mt-6 text-meta text-faint">{t('Аккаунт нужен только для входа.', 'The account is only used to sign in.')}</p>
      </div>
      <p className="text-center text-body text-muted-foreground"><Link className="underline-offset-4 hover:text-foreground hover:underline" href={next}>{t('Просто смотрите? Заходите без аккаунта', 'Just looking? Come in without an account')}</Link></p>
    </main>
  )
}

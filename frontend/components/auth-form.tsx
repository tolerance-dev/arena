'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { Brand, BrandMark } from '@/components/brand'
import { safeReturnPath } from '@/components/public/return-path'

const ERRORS: Record<string, string> = {
  oauth_denied: 'Вход отменён.',
  oauth_state: 'Ссылка для входа устарела. Попробуйте ещё раз.',
  oauth_failed: 'Провайдер не пустил нас. Попробуйте ещё раз чуть позже.',
  email_unverified: 'Нужен подтверждённый email. Подтвердите его у провайдера и попробуйте снова.',
  rate_limited: 'Слишком много попыток, подождите минуту.',
}

// The /login page: the same choices as the sign-in modal, for direct links and for OAuth errors (?error=).
export function AuthForm() {
  const [next, setNext] = useState('/')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setNext(safeReturnPath(q.get('next')) ?? '/')
    const code = q.get('error')
    if (code) setError(ERRORS[code] ?? 'Не удалось войти. Попробуйте ещё раз.')
  }, [])

  return (
    <main className="flex min-h-dvh flex-col bg-muted px-4 py-5">
      <div className="mx-auto w-full max-w-page"><Brand /></div>
      <div className="mx-auto mt-10 mb-8 w-full max-w-[580px] rounded-xl border-2 border-border bg-card px-6 py-8 text-center sm:px-8">
        <BrandMark className="mx-auto size-16" />
        <h1 className="display mt-5 text-page">Вход в tolerance</h1>
        <p className="mx-auto mt-2 max-w-[42ch] text-subtitle text-muted-foreground">Загружайте агентов, запускайте прогоны и следите за результатами.</p>
        <SignInOptions next={next} initialError={error} className="mx-auto mt-6 max-w-[318px]" />
        <p className="mt-6 text-meta text-faint">Аккаунт нужен только для входа.</p>
      </div>
      <p className="text-center text-body text-muted-foreground"><Link className="underline-offset-4 hover:text-foreground hover:underline" href={next}>Просто смотрите? Заходите без аккаунта</Link></p>
    </main>
  )
}

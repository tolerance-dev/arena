'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { Brand, BrandMark } from '@/components/brand'
import { safeReturnPath } from '@/components/public/return-path'
import { useT } from '@/lib/i18n/client'
import { authMessages } from '@/lib/i18n/messages/auth'

const ERROR_CODES = ['oauth_denied', 'oauth_state', 'oauth_failed', 'email_unverified', 'rate_limited'] as const

// The /login page: the same choices as the sign-in modal, for direct links and for OAuth errors (?error=).
export function AuthForm() {
  const t = useT(authMessages)
  const [next, setNext] = useState('/')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setNext(safeReturnPath(q.get('next')) ?? '/')
    const code = q.get('error')
    if (code) setError((ERROR_CODES as readonly string[]).includes(code) ? t(`err.${code}` as 'err.oauth_denied') : t('err.generic'))
  }, [t])

  return (
    <main className="flex min-h-dvh flex-col bg-muted px-4 py-5">
      <div className="mx-auto w-full max-w-page"><Brand /></div>
      <div className="mx-auto mt-10 mb-8 w-full max-w-[580px] rounded-xl border-2 border-border bg-card px-6 py-8 text-center sm:px-8">
        <BrandMark className="mx-auto size-16" />
        <h1 className="display mt-5 text-page">{t('modalTitle')}</h1>
        <p className="mx-auto mt-2 max-w-[42ch] text-subtitle text-muted-foreground">{t('modalLead')}</p>
        <SignInOptions next={next} initialError={error} className="mx-auto mt-6 max-w-[318px]" />
        <p className="mt-6 text-meta text-faint">{t('modalNote')}</p>
      </div>
      <p className="text-center text-body text-muted-foreground"><Link className="underline-offset-4 hover:text-foreground hover:underline" href={next}>{t('browse')}</Link></p>
    </main>
  )
}

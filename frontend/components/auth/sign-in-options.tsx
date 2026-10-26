'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useT } from '@/lib/i18n-client'
import type { AuthProviders } from '@/lib/types'
import { cn } from '@/lib/utils'

// The sign-in choices, shared by the sign-in modal and the /login page: the OAuth providers this server has (GitHub,
// Google), and on a local stack the dev sign-in by email. `next` is where sign-in returns to.
export function SignInOptions({ next, initialError, className }: {
  next: string
  initialError?: string | null
  className?: string
}) {
  const [options, setOptions] = useState<AuthProviders | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const t = useT()

  useEffect(() => { setError(initialError ?? null) }, [initialError])
  useEffect(() => {
    api<AuthProviders>('/auth/providers')
      .then(setOptions)
      .catch(() => {
        setOptions({ providers: [] })
        setFailed(true)
        setError(t('Сервер недоступен. Попробуйте ещё раз чуть позже.', 'The server is unavailable. Try again a bit later.'))
      })
  }, [t])

  const nothing = options && options.providers.length === 0 && !failed
  return (
    <div className={cn('w-full', className)}>
      <div className={cn('flex flex-col gap-2', !options && 'min-h-[104px]')}>
        {options?.providers.map((p) => (
          <Button key={p} variant="outline" size="lg" className="h-12 w-full"
            render={<a href={`/api/v1/auth/${p}/start?next=${encodeURIComponent(next)}`} />} nativeButton={false}>
            <ProviderIcon id={p} />
            {p === 'github' ? t('Войти через GitHub', 'Sign in with GitHub') : p === 'google' ? t('Войти через Google', 'Sign in with Google') : p}
          </Button>
        ))}
        {nothing && !options?.dev_login && <p className="text-center text-body text-muted-foreground">{t('Вход на этом сервере ещё не настроен.', 'Sign-in isn’t set up on this server yet.')}</p>}
      </div>
      {options?.dev_login && <DevSignIn next={next} onError={setError} />}
      {error && <p role="alert" className="mt-3 rounded-xl bg-destructive/5 px-3 py-2 text-body text-destructive">{error}</p>}
    </div>
  )
}

// Local stacks only (ARENA_DEV_LOGIN): any email, no password. The owner's email signs in as admin.
function DevSignIn({ next, onError }: { next: string; onError: (e: string | null) => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const t = useT()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    onError(null)
    try {
      await post('/auth/dev', { email })
      window.location.assign(next)
    } catch (err) {
      onError(errorText(err, t))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 flex gap-2 border-t border-dashed border-border-strong pt-4">
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email для локального входа', 'email for local sign-in')}
        aria-label={t('Email для локального входа', 'Email for local sign-in')} className="h-10 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-body" />
      <Button type="submit" variant="outline" disabled={busy}>{t('Войти', 'Sign in')}</Button>
    </form>
  )
}

function ProviderIcon({ id }: { id: 'github' | 'google' }) {
  if (id === 'github') {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className="size-5" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-5">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 013.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

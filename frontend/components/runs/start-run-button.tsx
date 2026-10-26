'use client'

import Link from 'next/link'
import { Play } from 'lucide-react'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n-client'
import { useMe } from '@/lib/use-me'

// "Run your agent" for everyone: signed out, it signs in first and comes back to /my with the task preselected.
export function StartRunButton({ task }: { task: string }) {
  const t = useT()
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const href = `/my?task=${encodeURIComponent(task)}`
  if (me || !signIn) return <Button size="lg" render={<Link href={href} />} nativeButton={false}><Play /> {t('Запустить своего агента', 'Run your agent')}</Button>
  return <Button size="lg" disabled={loading} onClick={() => signIn(href)}><Play /> {t('Запустить своего агента', 'Run your agent')}</Button>
}

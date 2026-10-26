'use client'

import Link from 'next/link'
import { Play } from 'lucide-react'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { Button } from '@/components/ui/button'
import { useMe } from '@/lib/use-me'

// Keep the chosen task through OAuth and continue straight to the launch form.
export function StartRunButton({ task, size = 'lg', className }: {
  task?: string
  size?: 'default' | 'sm' | 'lg'
  className?: string
}) {
  const { me, loading } = useMe()
  const signIn = useSignIn()

  const href = task ? `/my?task=${encodeURIComponent(task)}` : '/my'
  if (me || !signIn) {
    return <Button size={size} className={className} render={<Link href={href} />} nativeButton={false}><Play />Запустить агента</Button>
  }
  return <Button size={size} className={className} disabled={loading} onClick={() => signIn(href)}><Play />Запустить агента</Button>
}

'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { BrandMark } from '@/components/brand'
import { safeReturnPath } from '@/components/public/return-path'
import { SignInOptions } from './sign-in-options'

const SignInContext = createContext<((next?: string) => void) | null>(null)

// useSignIn opens the sign-in modal; null outside SignInProvider (callers then link to /login instead).
export function useSignIn() {
  return useContext(SignInContext)
}

// Sign-in as a modal over the current page, like Product Hunt's: a dark backdrop, a white round close button in the
// corner, a 580px panel 64px from the top. OAuth comes back to the same page.
export function SignInProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('/')
  const pathname = usePathname()

  const show = useCallback((destination?: string) => {
    setNext(safeReturnPath(destination) ?? safeReturnPath(window.location.pathname + window.location.search + window.location.hash) ?? '/')
    setOpen(true)
  }, [])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  useEffect(() => setOpen(false), [pathname])

  return (
    <SignInContext.Provider value={show}>
      {children}
      <dialog ref={ref} aria-labelledby="sign-in-title" onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 backdrop:bg-black/70 open:flex open:flex-col open:items-center">
        <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть"
          className="fixed top-4 left-4 z-10 flex size-9 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-neutral-200 sm:top-6 sm:left-6">
          <X className="size-5" />
        </button>
        {open && (
          <div className="mx-4 mt-16 mb-8 w-[580px] max-w-[calc(100vw-32px)] shrink-0 rounded-xl bg-card px-6 py-8 text-center shadow-[0_1px_2px_rgba(16,24,40,0.05)] sm:px-8">
            <BrandMark className="mx-auto size-16" />
            <h2 id="sign-in-title" className="display mt-5 text-page">Вход в tolerance</h2>
            <p className="mx-auto mt-2 max-w-[42ch] text-subtitle text-muted-foreground">Сохраняйте агентов и следите за их прогонами.</p>
            <SignInOptions next={next} className="mx-auto mt-6 max-w-[318px]" />
            <p className="mt-6 text-meta text-faint">После входа выберите агента. Для запуска понадобится ваш API-ключ модели.</p>
          </div>
        )}
      </dialog>
    </SignInContext.Provider>
  )
}

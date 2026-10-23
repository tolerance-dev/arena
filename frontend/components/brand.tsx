import { useId } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PRODUCT } from '@/lib/brand'

// The mark is a cat whose nose and mouth are the t of tolerance. Same drawing
// as app/icon.svg; same colours in both themes.
export function BrandMark({ className }: { className?: string }) {
  // useId's format varies between React versions; keep only characters safe in url(#…).
  const fur = 'mark' + useId().replace(/[^a-zA-Z0-9]/g, '') + '-fur'
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <defs>
        <linearGradient id={fur} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mark-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-to)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" style={{ fill: 'var(--mark-bg)' }} />
      <path d="M6 24V7.4c0-1 1.2-1.5 1.9-.8L12.5 11h7l4.6-4.4c.7-.7 1.9-.2 1.9.8V24a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill={`url(#${fur})`} />
      <circle cx="11.5" cy="16" r="1.7" style={{ fill: 'var(--mark-bg)' }} />
      <circle cx="20.5" cy="16" r="1.7" style={{ fill: 'var(--mark-bg)' }} />
      <path d="M12.75 19.75h6.5M16 17.5v5q0 2 2 2h.75" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 rounded-sm outline-offset-4', className)}>
      <BrandMark />
      <span className="text-[17px] font-semibold tracking-[-0.015em]">{PRODUCT}</span>
    </Link>
  )
}

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PRODUCT } from '@/lib/brand'

// The mark is a terminal prompt that has already been answered: the agent
// ran, the check came back.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-6 shrink-0', className)}>
      <rect width="32" height="32" rx="7" className="fill-ink" />
      <path d="M8.5 11l5 5-5 5" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink-foreground" />
      <path d="M16.5 17.5l2.6 2.6 5.4-6.1" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-mark-check" />
    </svg>
  )
}

export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 rounded-sm outline-offset-4', className)}>
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-[-0.015em]">{PRODUCT}</span>
    </Link>
  )
}

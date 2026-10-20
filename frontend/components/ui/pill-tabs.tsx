'use client'

import { cn } from '@/lib/utils'

// Product Hunt's page tabs: 40px pills, the active one on grey, counts in small grey pills.
export function PillTabs<T extends string>({ value, options, onChange, className }: {
  value: T
  options: { value: T; label: React.ReactNode; count?: number }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cn('flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-title transition-colors duration-150',
            o.value === value ? 'bg-border text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
          {o.label}
          {o.count != null && <span className="rounded-full bg-muted px-2 text-body font-semibold text-faint tnum">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

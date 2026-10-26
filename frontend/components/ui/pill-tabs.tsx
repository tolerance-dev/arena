'use client'

import { useId, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

// Product Hunt's page tabs: 40px pills, the active one on grey, counts in small grey pills.
export function PillTabs<T extends string>({ value, options, onChange, className, id, panelId, label }: {
  value: T
  options: { value: T; label: React.ReactNode; count?: number }[]
  onChange: (v: T) => void
  className?: string
  id?: string
  panelId?: string
  label?: string
}) {
  const generatedId = useId()
  const tabsId = id ?? generatedId
  function move(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (e.key) {
      case 'ArrowRight': next = (index + 1) % options.length; break
      case 'ArrowLeft': next = (index - 1 + options.length) % options.length; break
      case 'Home': next = 0; break
      case 'End': next = options.length - 1; break
      default: return
    }
    e.preventDefault()
    const buttons = e.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next]?.focus()
    onChange(options[next].value)
  }
  return (
    <div role="tablist" aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {options.map((o, index) => (
        <button key={o.value} id={`${tabsId}-${o.value}`} type="button" role="tab" aria-selected={o.value === value} aria-controls={panelId}
          tabIndex={o.value === value ? 0 : -1} onKeyDown={(e) => move(e, index)} onClick={() => onChange(o.value)}
          className={cn('flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-body transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4 sm:text-title',
            o.value === value ? 'bg-border text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
          {o.label}
          {o.count != null && <span className="rounded-full bg-muted px-2 text-body font-semibold text-faint tnum">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

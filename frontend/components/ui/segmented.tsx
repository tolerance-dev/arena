'use client'

import { cn } from '@/lib/utils'

// Linear's segmented control: a grey track, the chosen segment raised on white.
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T
  options: { value: T; label: React.ReactNode; title?: string; lang?: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex h-7 items-center rounded-md bg-secondary p-0.5 text-meta font-medium', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} lang={o.lang}
          onClick={() => o.value !== value && onChange(o.value)}
          className={cn('h-6 rounded-[5px] px-2 transition-colors duration-[120ms]',
            o.value === value ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Underlined tabs for switching views inside a page.
export function Tabs<T extends string>({ value, options, onChange, className }: {
  value: T
  options: { value: T; label: React.ReactNode }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-5 border-b border-border', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cn('-mb-px border-b-2 pb-2 text-ui font-medium transition-colors duration-[120ms]',
            o.value === value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

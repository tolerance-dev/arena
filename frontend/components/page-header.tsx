import { cn } from '@/lib/utils'

// Page title block: 28px at most (24 on phones), lead in 15px, actions on the right.
export function PageHeader({ kicker, title, children, actions, className }: {
  kicker?: React.ReactNode
  title: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {kicker && <div className="mb-2 text-ui text-muted-foreground">{kicker}</div>}
        <h1 className="display text-[24px] leading-[30px] break-words sm:text-page">{title}</h1>
        {children && <div className="mt-2 max-w-[68ch] text-lead text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

// Section heading as on Product Hunt: 16px semibold, an optional count, a quiet hint or link on the right.
export function SectionTitle({ children, count, aside, className, id }: {
  children: React.ReactNode
  count?: React.ReactNode
  aside?: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1', className)}>
      <h2 id={id} className="heading text-title">
        {children}
        {count != null && <span className="ml-2 font-normal text-faint tnum">{count}</span>}
      </h2>
      {aside && <div className="text-ui text-faint">{aside}</div>}
    </div>
  )
}

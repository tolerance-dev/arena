import { cn } from '@/lib/utils'

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
        {kicker && <div className="mb-3 text-sm text-muted-foreground">{kicker}</div>}
        <h1 className="display text-[2rem] break-words sm:text-[2.5rem]">{title}</h1>
        {children && <div className="mt-3 max-w-[62ch] leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children, aside, className, id }: { children: React.ReactNode; aside?: React.ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1', className)}>
      <h2 id={id} className="heading text-[1.2rem]">{children}</h2>
      {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
    </div>
  )
}

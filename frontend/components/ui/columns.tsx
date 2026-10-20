import { cn } from '@/lib/utils'

// Product Hunt's page frame: a 900px main column and a 280px aside, 32px apart. Below 1280px the aside moves under
// the main column, as on producthunt.com at 1024px.
export function Columns({ main, aside, className }: { main: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  if (!aside) return <div className={cn('min-w-0 xl:max-w-[900px]', className)}>{main}</div>
  return (
    <div className={cn('grid gap-10 xl:grid-cols-[minmax(0,900px)_280px] xl:justify-between xl:gap-8', className)}>
      <div className="min-w-0">{main}</div>
      <aside className="min-w-0 space-y-8 xl:sticky xl:top-24 xl:self-start">{aside}</aside>
    </div>
  )
}

// One block of the aside: a 16px semibold heading and its content (Product Hunt's "Company info", "Similar products").
export function AsideBlock({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold">{title}</h2>
        {action && <div className="text-ui text-faint">{action}</div>}
      </div>
      {children}
    </section>
  )
}

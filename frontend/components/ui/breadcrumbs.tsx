import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Product Hunt's breadcrumbs: muted links with chevrons, the current page last and unlinked.
export function Breadcrumbs({ items, className }: { items: { label: React.ReactNode; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumbs" className={cn('flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-ui text-muted-foreground', className)}>
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint" />}
          {item.href ? (
            <Link href={item.href} className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground">{item.label}</Link>
          ) : (
            <span aria-current="page" className="inline-flex min-w-0 items-center gap-1.5 text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

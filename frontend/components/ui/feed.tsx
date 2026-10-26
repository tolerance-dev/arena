import Link from 'next/link'
import { cn } from '@/lib/utils'

// Product Hunt's feed: rows without borders that fill grey on hover (radius 12). The row's link covers it all.
export function Feed({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('-mx-3 sm:-mx-4', className)}>{children}</ul>
}

export function FeedRow({ href, thumb, title, subtitle, meta, counters, rank }: {
  href: string
  thumb: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode[]
  counters?: React.ReactNode
  rank?: number
}) {
  return (
    <li className="group relative flex items-start gap-4 rounded-xl px-3 py-4 transition-colors duration-300 ease-out hover:bg-secondary sm:px-4">
      {thumb}
      <div className="min-w-0 flex-1">
        <Link href={href} className="block text-title font-semibold transition-colors after:absolute after:inset-0 after:rounded-xl group-hover:text-primary">
          {rank != null && <span className="tnum">{rank}. </span>}{title}
        </Link>
        {subtitle && <p className="mt-0.5 line-clamp-2 text-title font-normal text-muted-foreground">{subtitle}</p>}
        {meta && meta.length > 0 && <Meta items={meta} className="mt-1" />}
      </div>
      {counters && <div className="relative flex shrink-0 gap-3">{counters}</div>}
    </li>
  )
}

// A "·"-separated line of small facts. Every item carries its dot on the left; the dot of an item that starts a line
// falls outside the clipped box, so a wrapped line never begins with "·".
export function Meta({ items, className }: { items: React.ReactNode[]; className?: string }) {
  return (
    <div className={cn('overflow-hidden', className)}>
      <ul className="-ml-4 flex flex-wrap items-center gap-y-0.5 text-body leading-6 text-muted-foreground">
        {items.filter(Boolean).map((x, i) => (
          <li key={i} className="relative min-w-0 pl-4 before:absolute before:left-0 before:w-4 before:text-center before:text-faint before:content-['·']">{x}</li>
        ))}
      </ul>
    </div>
  )
}

// Product Hunt's 52×52 counter: icon over a number in a 2px-outlined square. Ours count real things (submissions,
// best score); there are no upvotes (voting is pairwise, on /vote).
export function Counter({ icon, value, label, className }: { icon: React.ReactNode; value: React.ReactNode; label: string; className?: string }) {
  return (
    <div title={label} className={cn('flex size-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-border bg-card text-title leading-5 tnum transition-colors duration-300 group-hover:border-border-strong [&_svg]:size-4 [&_svg]:text-muted-foreground', className)}>
      {icon}
      <span>{value}</span>
      <span className="sr-only">{label}</span>
    </div>
  )
}

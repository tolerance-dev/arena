import { cn } from '@/lib/utils'

// One look for "nothing here yet": dashed frame, muted text, optional action.
export function EmptyState({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-body text-muted-foreground', className)}>
      <p className="max-w-[48ch]">{children}</p>
      {action}
    </div>
  )
}

// Loading placeholder with the size of what it stands for.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-muted', className)} />
}

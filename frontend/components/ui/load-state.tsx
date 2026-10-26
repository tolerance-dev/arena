'use client'

import { errorText } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { Poll } from '@/lib/use-poll'
import { Button } from './button'
import { EmptyState } from './empty-state'

// One look for a polled page's failures. `what` is the thing in the accusative: «прогон», «задание».

function Retry({ poll }: { poll: Poll<unknown> }) {
  return <Button variant="outline" size="sm" disabled={poll.refreshing} onClick={poll.reload}>Попробовать ещё раз</Button>
}

// The first load failed: an error with a retry instead of an endless skeleton.
export function LoadError({ poll, what }: { poll: Poll<unknown>; what: string }) {
  return <EmptyState action={<Retry poll={poll} />}>{`Не удалось загрузить ${what}. ${errorText(poll.error)}`}</EmptyState>
}

// A later load failed: the page keeps the last data and says it may be stale. Nothing when the last load worked.
export function StaleNote({ poll, what, className }: { poll: Poll<unknown>; what: string; className?: string }) {
  if (!poll.error || !poll.data) return null
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-body', className)}>
      <span>{`Не удалось обновить ${what}, данные могут быть устаревшими. ${errorText(poll.error)}`}</span>
      <Retry poll={poll} />
    </div>
  )
}

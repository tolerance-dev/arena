'use client'

import { errorText } from '@/lib/errors'
import { useT } from '@/lib/i18n-client'
import { cn } from '@/lib/utils'
import type { Poll } from '@/lib/use-poll'
import { Button } from './button'
import { EmptyState } from './empty-state'

// One look for a polled page's failures. `what` names the thing, in the reader's language (Russian accusative):
// t('прогон', 'run').

function Retry({ poll }: { poll: Poll<unknown> }) {
  const t = useT()
  return <Button variant="outline" size="sm" disabled={poll.refreshing} onClick={poll.reload}>{t('Попробовать ещё раз', 'Try again')}</Button>
}

// The first load failed: an error with a retry instead of an endless skeleton.
export function LoadError({ poll, what }: { poll: Poll<unknown>; what: string }) {
  const t = useT()
  return <EmptyState action={<Retry poll={poll} />}>{`${t(`Не удалось загрузить ${what}.`, `Couldn’t load the ${what}.`)} ${errorText(poll.error, t)}`}</EmptyState>
}

// A later load failed: the page keeps the last data and says it may be stale. Nothing when the last load worked.
export function StaleNote({ poll, what, className }: { poll: Poll<unknown>; what: string; className?: string }) {
  const t = useT()
  if (!poll.error || !poll.data) return null
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-body', className)}>
      <span>{`${t(`Не удалось обновить ${what}, данные могут быть устаревшими.`, `Couldn’t refresh the ${what}, the data may be out of date.`)} ${errorText(poll.error, t)}`}</span>
      <Retry poll={poll} />
    </div>
  )
}

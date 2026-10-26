'use client'

import Link from 'next/link'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-state'
import { useT } from '@/lib/i18n-client'
import type { Run } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, isActive, StatusPill, taskTitle } from './bits'
import { LiveBuild } from './live-build'

// Two agents building on one page, left and right: each side is the run page's live view of its own run.
export function WatchView({ ids }: { ids: string[] }) {
  const t = useT()
  if (ids.length === 0) return <EmptyState>{t('Укажите прогоны: /watch?runs=<id>,<id>', 'Name the runs: /watch?runs=<id>,<id>')}</EmptyState>
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {ids.map((id) => <Side key={id} id={id} />)}
    </div>
  )
}

function Side({ id }: { id: string }) {
  const t = useT()
  const poll = usePoll<Run>(`/runs/${encodeURIComponent(id)}`, 2_000, isActive)
  const run = poll.data
  if (!run) return poll.error ? <LoadError poll={poll} what={t('прогон', 'run')} /> : <Skeleton className="h-[48rem]" />
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center gap-3">
        <AgentAvatar name={run.agent.name} />
        <div className="min-w-0 flex-1">
          <Link href={`/r/${run.id}`} className="block truncate text-title font-semibold hover:text-primary">{run.agent.name}</Link>
          <div className="truncate text-ui text-muted-foreground">{taskTitle(run, t)}</div>
        </div>
        <StatusPill run={run} />
      </header>
      {run.status === 'queued'
        ? <EmptyState>{t('Прогон ждёт в очереди.', 'The run is waiting in the queue.')}</EmptyState>
        : <LiveBuild run={run} mode={run.status === 'agent' ? 'live' : 'code'} compact />}
    </div>
  )
}

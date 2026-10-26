'use client'

import { AsideBlock, Columns } from '@/components/ui/columns'
import { Skeleton } from '@/components/ui/empty-state'
import type { TaskSummary } from '@/lib/types'
import { usePoll } from './bits'
import { rankAgents, StandingsTable } from './standings'

// Every agent against every challenge, ranked by the average best score.
export function LeaderboardView() {
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  return (
    <Columns
      main={
        <section aria-labelledby="board-title">
          <h1 id="board-title" className="display text-[20px] leading-[30px] sm:text-page">Лидерборд</h1>
          <p className="mt-1 max-w-[70ch] text-title text-muted-foreground">Лучшая оценка каждого агента в каждом задании, по среднему</p>
          <div className="mt-6">
            {tasks.data ? <StandingsTable tasks={tasks.data.items} rows={rankAgents(tasks.data.items)} /> : <Skeleton className="h-64" />}
          </div>
        </section>
      }
      aside={
        <AsideBlock title="Как считается место">
          <p className="text-body text-muted-foreground">Лучшая оценка агента по каждой задаче усредняется по всем задачам; задача, которую он не решал, считается за 0.</p>
        </AsideBlock>
      }
    />
  )
}

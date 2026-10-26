'use client'

import Link from 'next/link'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { Skeleton } from '@/components/ui/empty-state'
import type { Agent, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar } from './bits'
import { rankAgents, StandingsTable } from './standings'

// Every agent against every challenge, ranked by the average best score; agents with no score yet follow as links.
export function LeaderboardView() {
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const agents = usePoll<{ items: Agent[] }>('/agents', 30_000)
  const rows = tasks.data ? rankAgents(tasks.data.items) : null
  const ranked = new Set(rows?.map((r) => r.id))
  const unranked = rows && agents.data ? agents.data.items.filter((a) => !ranked.has(a.id)) : []
  return (
    <Columns
      main={
        <section aria-labelledby="board-title">
          <h1 id="board-title" className="display text-[20px] leading-[30px] sm:text-page">Лидерборд</h1>
          <p className="mt-1 max-w-[70ch] text-title text-muted-foreground">Лучшая оценка каждого агента в каждом задании, по среднему</p>
          <div className="mt-6">
            {tasks.data && rows ? <StandingsTable tasks={tasks.data.items} rows={rows} /> : <Skeleton className="h-64" />}
          </div>
          {unranked.length > 0 && (
            <div className="mt-8">
              <h2 className="text-title font-semibold">Ещё без оценки</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {unranked.map((a) => (
                  <li key={a.id}>
                    <Link href={`/agents/${a.id}`} className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-body font-medium transition-colors hover:border-border-strong hover:text-primary">
                      <AgentAvatar name={a.name} size="xs" />{a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      }
      aside={
        <AsideBlock title="Как считается место">
          <p className="text-body text-muted-foreground">Лучшая оценка агента по каждой задаче усредняется по всем задачам; задача, которую он не решал, считается за 0. <Link href="/how" className="font-medium text-primary hover:underline">Как считаем</Link></p>
        </AsideBlock>
      }
    />
  )
}

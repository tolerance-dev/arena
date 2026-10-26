'use client'

import { plural } from '@/lib/format'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Feed, Meta } from '@/components/ui/feed'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { providerLabel } from '@/lib/providers'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, Score } from './bits'
import { RunRow } from './run-row'
import { rankAgents } from './standings'


// One agent: who it is, what it built (every run as a showcase card) and its standing in the aside.
export function AgentView({ id }: { id: string }) {
  const agent = usePoll<Agent>(`/agents/${encodeURIComponent(id)}`, 30_000)
  const runs = usePoll<{ items: Run[] }>(`/runs?agent=${encodeURIComponent(id)}&limit=100`, 15_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  if (agent.error?.status === 404) return <EmptyState>Такого агента нет.</EmptyState>
  const a = agent.data
  if (!a) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>

  const list = runs.data?.items
  const ranked = tasks.data ? rankAgents(tasks.data.items) : null
  const mine = ranked?.find((r) => r.id === id)
  const finished = list?.filter((r) => r.status === 'done') ?? []
  const completed = new Set(finished.filter((r) => r.score != null).map((r) => r.task)).size
  const started = finished.length ? Math.round((100 * finished.filter((r) => r.app_started).length) / finished.length) : null

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Лидерборд', href: '/leaderboard' }, { label: a.name }]} />
      <Columns className="mt-6"
        main={
          <>
            <header className="flex items-start gap-4">
              <AgentAvatar name={a.name} size="lg" />
              <div className="min-w-0">
                <h1 className="display text-page break-words">{a.name}</h1>
                {a.description && <p className="text-subtitle text-muted-foreground">{a.description}</p>}
                <Meta className="mt-1" items={[providerLabel(a.provider), `от ${a.owner}`, plural(a.runs, '{n} прогон', '{n} прогона', '{n} прогонов')]} />
              </div>
            </header>
            <section className="mt-10" aria-labelledby="work-title">
              <h2 id="work-title" className="text-section font-semibold">Что построил</h2>
              {list ? (
                list.length ? (
                  <Feed className="mt-2">{list.map((r) => <RunRow key={r.id} run={r} show="task" />)}</Feed>
                ) : <EmptyState className="mt-4">Прогонов пока нет.</EmptyState>
              ) : <Skeleton className="mt-4 h-72" />}
            </section>
          </>
        }
        aside={
          <AsideBlock title="Позиция">
            <dl className="space-y-3">
              <Stat label="Место" value={mine ? `#${mine.rank}` : '—'} sub={ranked && mine ? `из ${ranked.length}` : undefined} />
              <Stat label="Средняя оценка" value={mine ? <Score score={mine.average} /> : '—'} />
              <Stat label="Лучшая оценка" value={<Score score={a.best_score} />} />
              <Stat label="Задач решено" value={tasks.data ? `${completed}/${tasks.data.items.length}` : '—'} />
              <Stat label="Приложение запустилось" value={started != null ? `${started}%` : '—'} />
              <Stat label="Прогонов" value={a.runs} />
            </dl>
          </AsideBlock>
        }
      />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body text-muted-foreground">{label}{sub && <span className="ml-1.5 text-faint">· {sub}</span>}</dt>
      <dd className="text-title font-semibold tnum">{value}</dd>
    </div>
  )
}

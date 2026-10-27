'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n-client'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Feed, Meta } from '@/components/ui/feed'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { providerLabel } from '@/lib/providers'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, Score, SpreadNote } from './bits'
import { RunRow } from './run-row'
import { rankAgents, scoredTasks } from './standings'


// One agent: who it is, what it built (every run as a showcase card) and its standing in the aside.
export function AgentView({ id }: { id: string }) {
  const t = useT()
  const agent = usePoll<Agent>(`/agents/${encodeURIComponent(id)}`, 30_000)
  const runs = usePoll<{ items: Run[] }>(`/runs?agent=${encodeURIComponent(id)}&limit=100`, 15_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  if (agent.error?.status === 404) return <EmptyState>{t('Такого агента нет.', 'There’s no such agent.')}</EmptyState>
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
      <Breadcrumbs items={[{ label: t('Лидерборд', 'Leaderboard'), href: '/leaderboard' }, { label: a.name }]} />
      <Columns className="mt-6"
        main={
          <>
            <header className="flex items-start gap-4">
              <AgentAvatar name={a.name} size="lg" />
              <div className="min-w-0">
                <h1 className="display text-page break-words">{a.name}</h1>
                {a.description && <p className="text-subtitle text-muted-foreground">{a.description}</p>}
                <Meta className="mt-1" items={[providerLabel(a.provider, t), t(`от ${a.owner}`, `by ${a.owner}`), t.plural(a.runs, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])]} />
              </div>
            </header>
            <section className="mt-10" aria-labelledby="work-title">
              <h2 id="work-title" className="text-section font-semibold">{t('Что построил', 'What it built')}</h2>
              {list ? (
                list.length ? (
                  <Feed className="mt-2">{list.map((r) => <RunRow key={r.id} run={r} show="task" />)}</Feed>
                ) : <EmptyState className="mt-4">{t('Прогонов пока нет.', 'No runs yet.')}</EmptyState>
              ) : <Skeleton className="mt-4 h-72" />}
            </section>
          </>
        }
        aside={
          <AsideBlock title={t('Позиция', 'Standing')}>
            <dl className="space-y-3">
              <Stat label={t('Место', 'Place')} value={mine ? `#${mine.rank}` : '—'} sub={ranked && mine ? t(`из ${ranked.length}`, `of ${ranked.length}`) : undefined} />
              <Stat label={t('Средняя оценка', 'Average score')} value={mine ? <Score score={mine.average} /> : '—'} />
              <Stat label={t('Задач решено', 'Tasks solved')} value={tasks.data ? `${completed}/${tasks.data.items.length}` : '—'} />
              <Stat label={t('Приложение запустилось', 'App started')} value={started != null ? `${started}%` : '—'} />
              <Stat label={t('Прогонов', 'Runs')} value={a.runs} />
            </dl>
            {mine && tasks.data && (
              <dl className="mt-4 space-y-3 border-t border-border pt-4">
                {scoredTasks(tasks.data.items).map((x) => {
                  const run = mine.cells[x.slug]
                  return (
                    <div key={x.slug} className="flex items-baseline justify-between gap-3">
                      <dt className="min-w-0 truncate text-body text-muted-foreground">{t.text(x.title)}</dt>
                      <dd className="text-right text-title font-semibold tnum">
                        {run ? <Link href={`/r/${run.id}`} className="hover:underline"><Score score={run.score} /></Link> : <Score score={null} />}
                        {run && <SpreadNote run={run} />}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}
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

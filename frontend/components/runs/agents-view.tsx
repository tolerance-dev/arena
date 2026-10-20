'use client'

import Link from 'next/link'
import { Play, Trophy } from 'lucide-react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Counter, Feed, FeedRow, Meta } from '@/components/ui/feed'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { AgentAvatar, Ago, RunShot, Score, scoreTone, taskTitle, usePoll, type RT } from './bits'
import { rankAgents, useBoards } from './standings'

const provider = (p: string) => (p === 'openai' ? 'OpenAI' : 'Anthropic')

// Every agent as a Product Hunt feed row; the counters are its runs and best score.
export function AgentsView() {
  const t = useT(runsMessages)
  const agents = usePoll<{ items: Agent[] }>('/agents', 30_000)
  const items = agents.data?.items
  return (
    <Columns
      main={
        <section aria-labelledby="agents-title">
          <h1 id="agents-title" className="display text-[20px] leading-[30px] sm:text-page">{t('agentsTitle')}</h1>
          <p className="mt-1 max-w-[70ch] text-title text-muted-foreground">{t('agentsLead')}</p>
          {items ? (
            items.length ? (
              <Feed className="mt-4">
                {[...items].sort((a, b) => (b.best_score ?? -1) - (a.best_score ?? -1) || b.runs - a.runs).map((a) => (
                  <FeedRow key={a.id} href={`/agents/${a.id}`} thumb={<AgentAvatar name={a.name} />} title={a.name}
                    subtitle={a.description || undefined}
                    meta={[provider(a.provider), t('by', { owner: a.owner })]}
                    counters={<>
                      <Counter icon={<Play />} value={a.runs} label={t('counterRuns')} className="max-sm:hidden" />
                      <Counter icon={<Trophy />} value={a.best_score ?? '—'} label={t('factBest')}
                        className={a.best_score != null ? scoreTone(a.best_score) : 'text-faint'} />
                    </>} />
                ))}
              </Feed>
            ) : <EmptyState className="mt-6">{t('noAgentsYet')}</EmptyState>
          ) : <Skeleton className="mt-6 h-80" />}
        </section>
      }
    />
  )
}

// One agent: who it is, what it built (every run as a showcase card) and its standing in the aside.
export function AgentView({ id }: { id: string }) {
  const t = useT(runsMessages)
  const agent = usePoll<Agent>(`/agents/${encodeURIComponent(id)}`, 30_000)
  const runs = usePoll<{ items: Run[] }>(`/runs?agent=${encodeURIComponent(id)}&limit=100`, 15_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const boards = useBoards(tasks.data?.items)
  if (agent.error?.status === 404) return <EmptyState>{t('agentMissing')}</EmptyState>
  const a = agent.data
  if (!a) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>

  const list = runs.data?.items
  const ranked = tasks.data && boards ? rankAgents(tasks.data.items, boards) : null
  const mine = ranked?.find((r) => r.id === id)
  const finished = list?.filter((r) => r.status === 'done') ?? []
  const completed = new Set(finished.filter((r) => r.score != null).map((r) => r.task)).size
  const started = finished.length ? Math.round((100 * finished.filter((r) => r.app_started).length) / finished.length) : null

  return (
    <div>
      <Breadcrumbs items={[{ label: t('agentsTitle'), href: '/agents' }, { label: a.name }]} />
      <Columns className="mt-6"
        main={
          <>
            <header className="flex items-start gap-4">
              <AgentAvatar name={a.name} size="lg" />
              <div className="min-w-0">
                <h1 className="display text-page break-words">{a.name}</h1>
                {a.description && <p className="text-subtitle text-muted-foreground">{a.description}</p>}
                <Meta className="mt-1" items={[provider(a.provider), t('by', { owner: a.owner }), t.plural('runs', a.runs)]} />
              </div>
            </header>
            <section className="mt-10" aria-labelledby="work-title">
              <h2 id="work-title" className="text-section font-semibold">{t('agentWorkTitle')}</h2>
              {list ? (
                list.length ? (
                  <ul className="mt-4 grid gap-6 sm:grid-cols-2">
                    {list.map((r) => <li key={r.id}><WorkCard run={r} t={t} /></li>)}
                  </ul>
                ) : <EmptyState className="mt-4">{t('noRuns')}</EmptyState>
              ) : <Skeleton className="mt-4 h-72" />}
            </section>
          </>
        }
        aside={
          <AsideBlock title={t('agentStatsTitle')}>
            <dl className="space-y-3">
              <Stat label={t('statRank')} value={mine ? `#${mine.rank}` : '—'} sub={ranked && mine ? `${ranked.length} ${t('agentsTitle').toLowerCase()}` : undefined} />
              <Stat label={t('statAverage')} value={mine ? <Score score={mine.average} /> : '—'} />
              <Stat label={t('factBest')} value={<Score score={a.best_score} />} />
              <Stat label={t('statCompleted')} value={tasks.data ? `${completed}/${tasks.data.items.length}` : '—'} />
              <Stat label={t('statSuccess')} value={started != null ? `${started}%` : '—'} />
              <Stat label={t('factRuns')} value={a.runs} />
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

function WorkCard({ run, t }: { run: Run; t: RT }) {
  return (
    <article>
      <Link href={`/r/${run.id}`} className="block overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 hover:border-border-strong">
        <RunShot run={run} className="aspect-[16/10] w-full" />
      </Link>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/r/${run.id}`} className="block truncate text-title font-semibold transition-colors hover:text-primary">{taskTitle(run.task, t.locale)}</Link>
          <div className="text-body text-muted-foreground"><Ago iso={run.created_at} /></div>
        </div>
        <Score score={run.status === 'done' ? run.score : null} className="text-section" />
      </div>
    </article>
  )
}

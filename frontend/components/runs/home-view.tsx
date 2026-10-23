'use client'

import Link from 'next/link'
import { Box, ChevronRight, Clock, ListChecks } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Feed, Meta } from '@/components/ui/feed'
import { Button } from '@/components/ui/button'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { homeMessages } from '@/lib/i18n/messages/home'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary } from '@/lib/types'
import { AgentAvatar, RunShot, Score, TaskTile, usePoll, type RT } from './bits'
import { RunRow } from './run-row'
import { rankAgents } from './standings'

type HT = ReturnType<typeof useT<typeof homeMessages.en>>

// The front page in the site's one frame: the tasks as cards with their best solution, the latest runs as a feed,
// and in the aside the conditions every agent works under and the top three agents.
export function HomeView() {
  const t = useT(homeMessages)
  const rt = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const items = tasks.data?.items

  return (
    <Columns
      main={
        <div className="space-y-10">
          <section aria-labelledby="home-title">
            <h1 id="home-title" className="display text-page sm:text-[32px] sm:leading-10">{t('title')}</h1>
            <p className="mt-1 max-w-[62ch] text-title text-muted-foreground">{t('lead')}</p>
          </section>

          <section aria-labelledby="tasks-title" aria-busy={!items && !tasks.error}>
            <SectionTitle id="tasks-title" count={items?.length}>{t('tasksTitle')}</SectionTitle>
            {items ? (
              items.length ? (
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((task) => <li key={task.slug}><TaskCard task={task} t={t} rt={rt} /></li>)}
                </ul>
              ) : <EmptyState>{t('noTasks')}</EmptyState>
            ) : tasks.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void tasks.reload()}>{t('retry')}</Button>}>{t('taskLoadError')}</EmptyState>
            ) : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>}
          </section>

          <section aria-labelledby="results-title">
            <SectionTitle id="results-title" aside={recent.data?.items.length ? <Link href="/leaderboard" className="transition-colors hover:text-primary">{rt('viewLeaderboard')}</Link> : undefined}>
              {t('resultsTitle')}
            </SectionTitle>
            {recent.data ? (
              recent.data.items.length
                ? <Feed>{recent.data.items.map((run) => <RunRow key={run.id} run={run} t={rt} />)}</Feed>
                : <EmptyState>{t('noResults')}</EmptyState>
            ) : recent.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void recent.reload()}>{t('retry')}</Button>}>{t('resultsLoadError')}</EmptyState>
            ) : <Skeleton className="h-64" />}
          </section>
        </div>
      }
      aside={<>
        <Conditions tasks={items} t={t} />
        <TopAgents tasks={items} t={t} rt={rt} />
      </>}
    />
  )
}

// A task with its best solution so far; it opens on the comparison of every agent's best run.
function TaskCard({ task, t, rt }: { task: TaskSummary; t: HT; rt: RT }) {
  const title = t.locale === 'ru' ? task.title.ru : task.title.en
  const best = task.best
  return (
    <Link href={`/t/${encodeURIComponent(task.slug)}`} className="group block">
      <div className="overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 group-hover:border-border-strong">
        {best?.has_shot ? <RunShot run={best} className="aspect-[16/10] w-full" /> : (
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-muted px-4 text-center text-ui text-faint">
            <TaskTile slug={task.slug} size="sm" className="bg-card" />
            {t('noSolutions')}
          </div>
        )}
      </div>
      <h3 className="mt-3 text-title font-semibold transition-colors group-hover:text-primary">{title}</h3>
      <p className="line-clamp-2 text-body text-muted-foreground">{t.locale === 'ru' ? task.tagline.ru : task.tagline.en}</p>
      <Meta className="mt-1" items={[rt.plural('agents', task.agents), rt.plural('runs', task.runs)]} />
      {best && (
        <div className="mt-2 flex items-center gap-2 text-body">
          <AgentAvatar name={best.agent.name} size="xs" />
          <span className="min-w-0 flex-1 truncate"><span className="text-faint">{t('leader')} </span>{best.agent.name}</span>
          <Score score={best.score} />
        </div>
      )}
    </Link>
  )
}

// What every agent works under, with the real limits from the task list.
function Conditions({ tasks, t }: { tasks: TaskSummary[] | undefined; t: HT }) {
  const first = tasks?.[0]
  const same = !!first && tasks!.every((x) => x.time_limit_s === first.time_limit_s && x.token_budget === first.token_budget)
  return (
    <AsideBlock title={t('conditions')}>
      <ul className="space-y-3 text-body">
        <Fact icon={<Box />} title={t('sandboxTitle')}>{t('sandboxText')}</Fact>
        <Fact icon={<Clock />} title={t('limitsTitle')}>
          {!tasks ? <Skeleton className="mt-1 h-4 w-40" /> : same
            ? t('limitsSame', { min: Math.round(first!.time_limit_s / 60), tokens: compact(first!.token_budget) })
            : t('limitsPerTask')}
        </Fact>
        <Fact icon={<ListChecks />} title={t('scoringTitle')}>{t('scoringText')}</Fact>
      </ul>
    </AsideBlock>
  )
}

function Fact({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}

// The leaderboard's first three: the average of each agent's best score over all tasks.
function TopAgents({ tasks, t, rt }: { tasks: TaskSummary[] | undefined; t: HT; rt: RT }) {
  const top = tasks ? rankAgents(tasks).slice(0, 3) : null
  return (
    <AsideBlock title={rt('topAgentsTitle')} action={top?.length ? <Link href="/leaderboard" className="inline-flex items-center gap-0.5 transition-colors hover:text-primary">{t('all')}<ChevronRight className="size-3.5" /></Link> : undefined}>
      {!top ? <Skeleton className="h-36" /> : top.length ? (
        <ol className="-mx-2">
          {top.map((a) => (
            <li key={a.id}>
              <Link href={`/agents/${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary">
                <span className="w-4 text-right text-body text-faint tnum">{a.rank}</span>
                <AgentAvatar name={a.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{a.name}</span>
                  <span className="block truncate text-meta text-muted-foreground">{a.owner}</span>
                </span>
                <Score score={a.average} className="text-title" />
              </Link>
            </li>
          ))}
        </ol>
      ) : <p className="text-body text-muted-foreground">{rt('noTopAgents')}</p>}
    </AsideBlock>
  )
}

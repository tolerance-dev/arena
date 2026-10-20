'use client'

import Link from 'next/link'
import { Play, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Counter, Feed, FeedRow } from '@/components/ui/feed'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary } from '@/lib/types'
import { AgentAvatar, Ago, Score, scoreTone, StatusPill, TaskTile, taskTitle, usePoll, type RT } from './bits'
import { rankAgents, useBoards } from './standings'

// The home page is Product Hunt's front page: a feed of challenges, then the latest runs; the aside has the top
// agents and how a run works.
export function HomeView() {
  const t = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const items = tasks.data?.items
  const boards = useBoards(items)
  const top = items && boards ? rankAgents(items, boards).slice(0, 5) : null

  return (
    <Columns
      main={
        <div className="space-y-12">
          <section aria-labelledby="challenges-title">
            <h1 id="challenges-title" className="display text-[20px] leading-[30px] sm:text-page">{t('challengesTitle')}</h1>
            <p className="mt-1 max-w-[70ch] text-title text-muted-foreground">{t('challengesLead')}</p>
            {items ? (
              items.length ? (
                <Feed className="mt-4">
                  {items.map((task, i) => <TaskRow key={task.slug} task={task} rank={i + 1} t={t} />)}
                </Feed>
              ) : <EmptyState className="mt-6">{t('noRuns')}</EmptyState>
            ) : <Skeleton className="mt-6 h-80" />}
          </section>

          <section aria-labelledby="recent-title">
            <h2 id="recent-title" className="display text-[20px] leading-[30px] sm:text-page">{t('recentTitle')}</h2>
            {recent.data ? (
              recent.data.items.length ? (
                <Feed className="mt-4">
                  {recent.data.items.map((r) => <RunRow key={r.id} run={r} t={t} />)}
                </Feed>
              ) : <EmptyState className="mt-6">{t('noRuns')}</EmptyState>
            ) : <Skeleton className="mt-6 h-80" />}
          </section>
        </div>
      }
      aside={
        <>
          <AsideBlock title={t('topAgentsTitle')}>
            {top ? (
              top.length ? (
                <ol className="space-y-1">
                  {top.map((row) => (
                    <li key={row.id}>
                      <Link href={`/agents/${row.id}`} className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-300 hover:bg-secondary">
                        <span className="w-4 text-body text-faint tnum">{row.rank}</span>
                        <AgentAvatar name={row.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-title font-semibold transition-colors group-hover:text-primary">{row.name}</span>
                          <span className="block truncate text-body text-muted-foreground">{row.owner}</span>
                        </span>
                        <Score score={row.average} className="text-title" />
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-body text-muted-foreground">{t('noTopAgents')}</p>
            ) : <Skeleton className="h-48" />}
            <Button variant="outline" size="lg" className="mt-4 w-full" render={<Link href="/leaderboard" />} nativeButton={false}>{t('viewLeaderboard')}</Button>
          </AsideBlock>
          <AsideBlock title={t('howTitle')}>
            <ol className="space-y-4">
              {(['how1', 'how2', 'how3'] as const).map((k, i) => (
                <li key={k} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-ui font-semibold text-muted-foreground tnum">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-title font-semibold">{t(k)}</div>
                    <p className="mt-0.5 text-body text-muted-foreground">{t(`${k}Text` as 'how1Text')}</p>
                  </div>
                </li>
              ))}
            </ol>
          </AsideBlock>
        </>
      }
    />
  )
}

// One challenge in the feed: its mark, name, tagline, limits; runs and the best score in the counters.
function TaskRow({ task, rank, t }: { task: TaskSummary; rank: number; t: RT }) {
  const best = task.best?.score ?? null
  return (
    <FeedRow href={`/t/${task.slug}`} rank={rank} thumb={<TaskTile slug={task.slug} />}
      title={t.locale === 'ru' ? task.title.ru : task.title.en}
      subtitle={t.locale === 'ru' ? task.tagline.ru : task.tagline.en}
      meta={[
        t('minutes', { n: Math.round(task.time_limit_s / 60) }),
        `${compact(task.token_budget)} ${t('metricTokens').toLowerCase()}`,
        t.plural('agents', task.agents),
      ]}
      counters={<>
        <Counter icon={<Play />} value={task.runs} label={t('counterRuns')} className="max-sm:hidden" />
        <Counter icon={<Trophy />} value={best ?? '—'} label={t('factBest')} className={best != null ? scoreTone(best) : 'text-faint'} />
      </>}
    />
  )
}

// One run in the feed, two lines: the agent, then the challenge and its state; the score in the counter.
function RunRow({ run, t }: { run: Run; t: RT }) {
  const done = run.status === 'done'
  return (
    <FeedRow href={`/r/${run.id}`} thumb={<AgentAvatar name={run.agent.name} />}
      title={run.agent.name}
      meta={[
        taskTitle(run.task, t.locale),
        done ? t('by', { owner: run.agent.owner }) : <StatusPill key="s" run={run} />,
        run.checks.length ? `${run.checks.filter((c) => c.passed).length}/${run.checks.length} ${t('colChecks').toLowerCase()}` : null,
        <Ago key="a" iso={run.created_at} />,
      ].filter(Boolean)}
      counters={<Counter icon={<Trophy />} value={done && run.score != null ? run.score : '—'} label={t('score')}
        className={done && run.score != null ? scoreTone(run.score) : 'text-faint'} />}
    />
  )
}

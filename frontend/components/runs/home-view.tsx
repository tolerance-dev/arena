'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { api } from '@/lib/api'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary, TaskView } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CheckStrip, RunTable, Score, TaskTile, usePoll, type RT } from './bits'
import { TaskGlyph } from './task-glyph'

export function HomeView() {
  const t = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const boards = useBoards(tasks.data?.items)
  const items = tasks.data?.items

  const steps = [
    { title: t('how1'), text: t('how1Text') },
    { title: t('how2'), text: t('how2Text') },
    { title: t('how3'), text: t('how3Text') },
  ]

  return (
    <div className="space-y-12">
      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-14">
        <PageHeader title={t('homeTitle')}>{t('homeLead')}</PageHeader>
        <ol aria-label={t('howTitle')} className="space-y-3 lg:pt-1.5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-meta font-medium text-muted-foreground tnum">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-ui font-medium">{s.title}</div>
                <p className="mt-0.5 text-meta leading-[18px] text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="standings-title">
        <SectionTitle id="standings-title" aside={t('standingsHint')}>{t('standingsTitle')}</SectionTitle>
        {items && boards ? <Standings tasks={items} boards={boards} t={t} /> : <Skeleton className="h-40" />}
      </section>

      <section aria-labelledby="tasks-title">
        <SectionTitle id="tasks-title" count={items?.length}>{t('tasksTitle')}</SectionTitle>
        {items ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {items.map((task) => <TaskRow key={task.slug} task={task} t={t} />)}
          </ul>
        ) : <Skeleton className="h-72" />}
      </section>

      <section aria-labelledby="recent-title">
        <SectionTitle id="recent-title">{t('recentTitle')}</SectionTitle>
        {recent.data ? <RunTable runs={recent.data.items} showTask /> : <Skeleton className="h-40" />}
      </section>
    </div>
  )
}

// Each task's leaderboard (the best run per agent), refreshed with the task list.
function useBoards(tasks: TaskSummary[] | undefined) {
  const slugs = tasks?.map((x) => x.slug).join(',') ?? ''
  const [boards, setBoards] = useState<Record<string, Run[]> | null>(null)
  useEffect(() => {
    if (!slugs) return
    let live = true
    const load = async () => {
      const pairs = await Promise.all(slugs.split(',').map((s) =>
        api<TaskView>(`/tasks/${encodeURIComponent(s)}`).then((v) => [s, v.leaderboard] as const).catch(() => [s, [] as Run[]] as const)))
      if (live) setBoards(Object.fromEntries(pairs))
    }
    void load()
    const id = setInterval(() => void load(), 15_000)
    return () => { live = false; clearInterval(id) }
  }, [slugs])
  return boards
}

// One task as a catalogue row: tile, name, tagline, the limits, and its best result on the right.
function TaskRow({ task, t }: { task: TaskSummary; t: RT }) {
  const title = t.locale === 'ru' ? task.title.ru : task.title.en
  const best = task.best
  return (
    <li className="relative flex gap-4 px-4 py-4 transition-colors duration-[120ms] hover:bg-muted sm:px-5">
      <TaskTile slug={task.slug} />
      <div className="min-w-0 flex-1">
        <Link href={`/t/${task.slug}`} className="text-title font-semibold after:absolute after:inset-0">{title}</Link>
        <p className="mt-0.5 line-clamp-2 text-body text-muted-foreground">{t.locale === 'ru' ? task.tagline.ru : task.tagline.en}</p>
        <ul className="mt-2 flex flex-wrap items-center gap-y-1 text-meta text-faint [&>li:not(:first-child)]:before:mx-2 [&>li:not(:first-child)]:before:content-['·']">
          <li><span className="max-sm:hidden">{t('factTime')} </span><span className="text-muted-foreground tnum">{t('minutes', { n: Math.round(task.time_limit_s / 60) })}</span></li>
          <li><span className="max-sm:hidden">{t('factBudget')} </span><span className="text-muted-foreground tnum">{compact(task.token_budget)}</span></li>
          <li className="max-sm:hidden">{t.plural('runs', task.runs)}</li>
          <li className="sm:hidden">{t('factBest')} <Score score={best?.score ?? null} /></li>
        </ul>
      </div>
      <div className="flex shrink-0 items-start gap-4 max-sm:hidden">
        <div className="text-right">
          <div className="text-meta text-faint">{t('factBest')}</div>
          <div className="mt-0.5 text-section leading-7"><Score score={best?.score ?? null} /></div>
          {best && <div className="max-w-[9rem] truncate text-meta text-faint">{best.agent.name}</div>}
        </div>
        {best?.has_shot && (
          // The best run's page, as the checker saw it right after start.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/v1/runs/${best.id}/shot.jpg`} alt={t('bestShotAlt', { agent: best.agent.name })} loading="lazy"
            className="hidden aspect-[16/10] w-28 rounded-md border border-border bg-muted object-cover object-top md:block" />
        )}
      </div>
    </li>
  )
}

type Row = { id: string; name: string; owner: string; provider: string; cells: Record<string, Run>; average: number }

// Agents down, tasks across: every agent's best run on every task, ranked by the average (a missing task counts as 0).
function Standings({ tasks, boards, t }: { tasks: TaskSummary[]; boards: Record<string, Run[]>; t: RT }) {
  const rows = new Map<string, Row>()
  for (const task of tasks) {
    for (const r of boards[task.slug] ?? []) {
      if (r.score == null) continue
      const row = rows.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, owner: r.agent.owner, provider: r.agent.provider, cells: {}, average: 0 }
      row.cells[task.slug] = r
      rows.set(r.agent.id, row)
    }
  }
  const ranked = [...rows.values()]
    .map((row) => ({ ...row, average: Math.round(tasks.reduce((s, x) => s + (row.cells[x.slug]?.score ?? 0), 0) / Math.max(1, tasks.length)) }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name))

  if (ranked.length === 0) return <EmptyState>{t('noStandings')}</EmptyState>
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[640px] text-body">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-meta text-faint">
            <th className="h-9 w-10 pl-4 font-medium">#</th>
            <th className="h-9 px-3 font-medium">{t('colAgent')}</th>
            {tasks.map((x) => (
              <th key={x.slug} className="h-9 px-3 font-medium">
                <Link href={`/t/${x.slug}`} className="inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-foreground">
                  <TaskGlyph slug={x.slug} className="size-3.5" />{t.locale === 'ru' ? x.title.ru : x.title.en}
                </Link>
              </th>
            ))}
            <th className="h-9 px-4 text-right font-medium">{t('colAverage')}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, i) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="py-2.5 pl-4 text-faint tnum">{i + 1}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium whitespace-nowrap">{row.name}</div>
                <div className="mt-0.5 text-meta text-faint">{row.owner}</div>
              </td>
              {tasks.map((x) => {
                const r = row.cells[x.slug]
                return (
                  <td key={x.slug} className={cn('relative px-3 py-2.5', r && 'transition-colors duration-[120ms] hover:bg-muted')}>
                    {r ? (
                      <Link href={`/r/${r.id}`} className="flex items-center gap-2.5 after:absolute after:inset-0" aria-label={`${row.name}, ${x.title.en}: ${r.score}`}>
                        <Score score={r.score} className="w-7 text-lead" />
                        <CheckStrip checks={r.checks} size="xs" />
                      </Link>
                    ) : <span className="text-faint">—</span>}
                  </td>
                )
              })}
              <td className="px-4 py-2.5 text-right"><Score score={row.average} className="text-title" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

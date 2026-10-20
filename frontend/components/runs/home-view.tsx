'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SectionTitle } from '@/components/page-header'
import { api } from '@/lib/api'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary, TaskView } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CheckStrip, RunTable, Score, usePoll, type RT } from './bits'
import { TaskGlyph } from './task-glyph'

export function HomeView() {
  const t = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const boards = useBoards(tasks.data?.items)

  const steps = [
    { title: t('how1'), text: t('how1Text') },
    { title: t('how2'), text: t('how2Text') },
    { title: t('how3'), text: t('how3Text') },
  ]

  return (
    <div className="space-y-14">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h1 className="display max-w-[16ch] text-[2.4rem] sm:text-[3.25rem]">{t('homeTitle')}</h1>
          <p className="mt-5 max-w-[58ch] text-[1.05rem] leading-relaxed text-muted-foreground">{t('homeLead')}</p>
        </div>
        <ol aria-label={t('howTitle')} className="self-end border-l border-border-strong">
          {steps.map((s, i) => (
            <li key={s.title} className="group relative py-2 pl-6 first:pt-0 last:pb-0">
              <span className="absolute top-3.5 -left-[4.5px] size-2 rounded-full bg-foreground group-first:top-1.5" />
              <div className="text-sm"><span className="mr-2 text-muted-foreground tnum">{i + 1}</span><span className="font-semibold">{s.title}</span></div>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="standings-title">
        <SectionTitle id="standings-title" aside={t('standingsHint')}>{t('standingsTitle')}</SectionTitle>
        {tasks.data && boards ? <Standings tasks={tasks.data.items} boards={boards} t={t} /> : <div className="h-40 animate-pulse rounded-lg bg-muted" />}
      </section>

      <section aria-labelledby="tasks-title">
        <SectionTitle id="tasks-title">{t('tasksTitle')}</SectionTitle>
        <div className="grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-3">
          {(tasks.data?.items ?? []).map((task) => <TaskColumn key={task.slug} task={task} t={t} />)}
          {!tasks.data && [0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse bg-muted" />)}
        </div>
      </section>

      <section aria-labelledby="recent-title">
        <SectionTitle id="recent-title">{t('recentTitle')}</SectionTitle>
        {recent.data ? <RunTable runs={recent.data.items} showTask /> : <div className="h-40 animate-pulse rounded-lg bg-muted" />}
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

  if (ranked.length === 0) {
    return <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noStandings')}</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-10 py-2.5 pl-4 font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">{t('colAgent')}</th>
            {tasks.map((x) => (
              <th key={x.slug} className="border-l border-border px-3 py-2.5 font-medium">
                <Link href={`/t/${x.slug}`} className="inline-flex items-center gap-2 hover:text-foreground">
                  <TaskGlyph slug={x.slug} className="size-4" />{t.locale === 'ru' ? x.title.ru : x.title.en}
                </Link>
              </th>
            ))}
            <th className="border-l border-border px-4 py-2.5 text-right font-medium">{t('colAverage')}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, i) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="py-3 pl-4 text-muted-foreground tnum">{i + 1}</td>
              <td className="px-3 py-3">
                <div className="font-medium whitespace-nowrap">{row.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{row.owner}</div>
              </td>
              {tasks.map((x) => {
                const r = row.cells[x.slug]
                return (
                  <td key={x.slug} className="relative border-l border-border px-3 py-3 hover:bg-muted/60">
                    {r ? (
                      <Link href={`/r/${r.id}`} className="flex items-center gap-3 after:absolute after:inset-0" aria-label={`${row.name}, ${x.title.en}: ${r.score}`}>
                        <Score score={r.score} className="w-8 text-base" />
                        <CheckStrip checks={r.checks} />
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                )
              })}
              <td className="border-l border-border px-4 py-3 text-right"><Score score={row.average} className="text-[1.35rem]" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TaskColumn({ task, t }: { task: TaskSummary; t: RT }) {
  const title = t.locale === 'ru' ? task.title.ru : task.title.en
  return (
    <Link href={`/t/${task.slug}`}
      className="group flex flex-col border-border p-5 not-first:border-t hover:bg-muted/50 sm:p-6 md:not-first:border-t-0 md:not-first:border-l">
      <TaskGlyph slug={task.slug} />
      <h3 className="heading mt-5 text-[1.2rem] group-hover:underline">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.locale === 'ru' ? task.tagline.ru : task.tagline.en}</p>
      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 pt-6 text-sm">
        <Fact label={t('factTime')} value={t('minutes', { n: Math.round(task.time_limit_s / 60) })} />
        <Fact label={t('factBudget')} value={compact(task.token_budget)} />
        <Fact label={t('factRuns')} value={String(task.runs)} />
        <Fact label={t('factBest')} value={task.best ? <Score score={task.best.score} /> : '—'} />
      </dl>
    </Link>
  )
}

export function Fact({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tnum">{value}</dd>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { useT } from '@/lib/i18n-client'
import { isVoted, type Run, type TaskSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, CheckStrip, Score } from './bits'
import { TaskGlyph } from './task-glyph'

export type Standing = { id: string; name: string; owner: string; provider: string; cells: Record<string, Run>; average: number; rank: number }

// The tasks a score ranks: the voted ones (invent, startup) are ranked by people's votes, their checks only gate the run.
export const scoredTasks = (tasks: TaskSummary[]) => tasks.filter((x) => !isVoted(x.kind))

// Agents ranked by the average of their best score on every scored task (a task they have not run counts as 0).
export function rankAgents(all: TaskSummary[]): Standing[] {
  const tasks = scoredTasks(all)
  const rows = new Map<string, Omit<Standing, 'average' | 'rank'>>()
  for (const task of tasks) {
    for (const r of task.leaderboard) {
      if (r.score == null) continue
      const row = rows.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, owner: r.agent.owner, provider: r.agent.provider, cells: {} }
      row.cells[task.slug] = r
      rows.set(r.agent.id, row)
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, average: Math.round(tasks.reduce((s, x) => s + (row.cells[x.slug]?.score ?? 0), 0) / Math.max(1, tasks.length)), rank: 0 }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name))
    .map((row, i) => ({ ...row, rank: i + 1 }))
}

// Agents down, tasks across: every agent's best run on every task.
export function StandingsTable({ tasks: all, rows }: { tasks: TaskSummary[]; rows: Standing[] }) {
  const t = useT()
  const tasks = scoredTasks(all)
  if (rows.length === 0) return <EmptyState>{t('Завершённых прогонов пока нет. Результаты появятся здесь после первой проверки.', 'No finished runs yet. Results show up here after the first check.')}</EmptyState>
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-border">
      <table className="w-full min-w-[640px] text-title">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-body text-muted-foreground">
            <th className="h-11 w-12 pl-4 font-medium">#</th>
            <th className="h-11 px-3 font-medium">{t('Агент', 'Agent')}</th>
            {tasks.map((x) => (
              <th key={x.slug} className="h-11 px-3 font-medium">
                <Link href={`/t/${x.slug}`} className="inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-primary">
                  <TaskGlyph slug={x.slug} className="size-4" />{t.text(x.title)}
                </Link>
              </th>
            ))}
            <th className="h-11 px-4 text-right font-medium">{t('Среднее', 'Average')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="py-3 pl-4 text-faint tnum">{row.rank}</td>
              <td className="px-3 py-3">
                <Link href={`/agents/${row.id}`} className="flex items-center gap-3 transition-colors hover:text-primary">
                  <AgentAvatar name={row.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block font-semibold whitespace-nowrap">{row.name}</span>
                    <span className="block text-body text-muted-foreground">{row.owner}</span>
                  </span>
                </Link>
              </td>
              {tasks.map((x) => {
                const r = row.cells[x.slug]
                return (
                  <td key={x.slug} className={cn('relative px-3 py-3', r && 'transition-colors duration-150 hover:bg-secondary')}>
                    {r ? (
                      <Link href={`/r/${r.id}`} className="flex items-center gap-2.5 after:absolute after:inset-0" aria-label={`${row.name}, ${t.text(x.title)}: ${r.score}`}>
                        <Score score={r.score} className="w-8" />
                        <CheckStrip checks={r.checks} size="xs" />
                      </Link>
                    ) : <span className="text-faint">—</span>}
                  </td>
                )
              })}
              <td className="px-4 py-3 text-right"><Score score={row.average} className="text-section" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

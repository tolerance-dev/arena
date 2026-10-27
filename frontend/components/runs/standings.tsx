'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Trophy } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { duration, usd } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import { providerLabel, SUBSCRIPTIONS } from '@/lib/providers'
import { isVoted, type Run, type TaskSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, scoreTone } from './bits'
import { TaskGlyph } from './task-glyph'

export type Standing = {
  id: string; name: string; owner: string; provider: string; model_name?: string; cells: Record<string, Run>
  average: number; rank: number; solved: number
  cost: number | null; seconds: number | null // averages over its median runs with a known value
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

// The tasks a score ranks: the voted ones (invent, startup) are ranked by people's votes, their checks only gate the run.
export const scoredTasks = (tasks: TaskSummary[]) => tasks.filter((x) => !isVoted(x.kind))

// Agents ranked by the average of their median score on every scored task (a task they have not run counts as 0). Equal
// averages share a place (1, 1, 3), as arena boards do.
export function rankAgents(all: TaskSummary[]): Standing[] {
  const tasks = scoredTasks(all)
  const rows = new Map<string, Pick<Standing, 'id' | 'name' | 'owner' | 'provider' | 'model_name' | 'cells'>>()
  for (const task of tasks) {
    for (const r of task.leaderboard) {
      if (r.score == null) continue
      const row = rows.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, owner: r.agent.owner, provider: r.agent.provider, model_name: r.agent.model_name, cells: {} }
      row.cells[task.slug] = r
      rows.set(r.agent.id, row)
    }
  }
  const sorted = [...rows.values()]
    .map((row) => {
      const runs = Object.values(row.cells)
      return {
        ...row, rank: 0, solved: runs.length,
        average: Math.round(tasks.reduce((s, x) => s + (row.cells[x.slug]?.score ?? 0), 0) / Math.max(1, tasks.length)),
        cost: mean(runs.flatMap((r) => (r.cost_usd == null ? [] : [r.cost_usd]))),
        seconds: mean(runs.flatMap((r) => (r.agent_seconds == null ? [] : [r.agent_seconds]))),
      }
    })
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name))
  sorted.forEach((row, i) => { row.rank = i > 0 && sorted[i - 1].average === row.average ? sorted[i - 1].rank : i + 1 })
  return sorted
}

type SortKey = 'average' | 'cost' | 'seconds' | `task:${string}`

function sortValue(row: Standing, key: SortKey): number | null {
  if (key === 'average') return row.average
  if (key === 'cost') return row.cost
  if (key === 'seconds') return row.seconds
  return row.cells[key.slice(5)]?.score ?? null
}

// Agents down: place, the agent and its model, the overall score, then the median run at every task, the cost and
// time of a run. Any column but the agent sorts; the place stays the overall one.
export function StandingsTable({ tasks: all, rows }: { tasks: TaskSummary[]; rows: Standing[] }) {
  const t = useT()
  const tasks = scoredTasks(all)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'average', desc: true })
  if (rows.length === 0) return <EmptyState>{t('Завершённых прогонов пока нет. Результаты появятся здесь после первой проверки.', 'No finished runs yet. Results show up here after the first check.')}</EmptyState>

  // Missing values go last whichever way it sorts; ties keep the overall order.
  const shown = [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key), y = sortValue(b, sort.key)
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1
    return (sort.desc ? y - x : x - y) || a.rank - b.rank
  })
  // Scores sort best first, cost and time cheapest and fastest first.
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'average' || key.startsWith('task:') }))
  // wrap: a long task title takes two lines instead of pushing cost and time off the table. The sorted column is
  // tinted, as arena boards mark theirs.
  const on = (key: SortKey) => sort.key === key && 'bg-accent/50'
  const head = (key: SortKey, label: React.ReactNode, hint: string, className?: string, wrap?: boolean) => (
    <th key={key} className={cn('h-12 px-3 py-2 font-medium', on(key), className)} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => toggle(key)} title={hint}
        className={cn('inline-flex items-center gap-1 transition-colors hover:text-foreground', wrap ? 'max-w-26 flex-col gap-0.5 text-center leading-4' : 'whitespace-nowrap',
          sort.key === key ? 'text-accent-foreground' : 'text-faint')}>
        {label}
        {sort.key === key ? (sort.desc ? <ArrowDown className="size-3.5 shrink-0" /> : <ArrowUp className="size-3.5 shrink-0" />) : null}
      </button>
    </th>
  )

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04),0_4px_16px_-4px_rgb(16_24_40/0.06)]">
      <table className="w-full text-title">
        <thead>
          <tr className="border-b border-border text-left text-ui">
            <th className="h-12 w-12 pl-3 font-medium text-faint sm:w-14 sm:pl-4" title={t('Место по общей оценке', 'Place by the overall score')}>#</th>
            <th className="h-12 px-3 font-medium text-faint">{t('Агент', 'Agent')}</th>
            {head('average', t('Оценка', 'Score'), t('Среднее медианных оценок по всем задачам, 0–100', 'Average of the median scores over every task, 0–100'), 'pr-4 sm:pr-3')}
            {tasks.map((x) => head(`task:${x.slug}`, <><TaskGlyph slug={x.slug} className="size-4 shrink-0" /><span>{t.text(x.title)}</span></>,
              t(`Медианная оценка в задаче «${t.text(x.title)}»`, `Median score at “${t.text(x.title)}”`), 'hidden px-1.5 text-center md:table-cell', true))}
            {head('cost', t('Цена', 'Cost'), t('Средняя цена медианного прогона по прейскуранту модели', 'Average cost of a median run at the model’s list price'), 'hidden text-right sm:table-cell')}
            {head('seconds', t('Время', 'Time'), t('Сколько в среднем работал агент', 'How long the agent worked, on average'), 'hidden pr-4 text-right sm:table-cell')}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => { const label = agentLabel(row); return (
            <tr key={row.id} className="group/row relative border-b border-border transition-colors duration-[120ms] last:border-0 hover:bg-muted">
              <td className="py-4 pl-3 sm:pl-4"><Rank rank={row.rank} /></td>
              <td className="max-w-[180px] px-3 py-4 sm:max-w-[230px]">
                <Link href={`/agents/${row.id}`} className="flex min-w-0 items-center gap-3 after:absolute after:inset-0">
                  <AgentAvatar name={row.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold tracking-[-0.01em] transition-colors group-hover/row:text-primary" title={row.name}>{label.title}</span>
                    <span className="block truncate text-ui text-muted-foreground">{[label.sub, row.owner].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </td>
              <td className={cn('py-4 pr-4 pl-3 sm:pr-3', on('average'))}>
                <div className="flex items-center gap-3">
                  <span className={cn('w-9 text-right text-[22px] leading-7 font-semibold tracking-[-0.02em] tnum', scoreTone(row.average))}>{row.average}</span>
                  <Bar score={row.average} className="hidden w-12 lg:block" />
                </div>
                {row.solved < tasks.length && (
                  <div className="mt-1 text-meta whitespace-nowrap text-faint">{t(`решал ${row.solved} из ${tasks.length}`, `did ${row.solved} of ${tasks.length}`)}</div>
                )}
              </td>
              {tasks.map((x) => {
                const r = row.cells[x.slug]
                const ok = r?.checks.filter((c) => c.passed).length ?? 0
                return (
                  <td key={x.slug} className={cn('hidden px-1.5 py-4 text-center md:table-cell', on(`task:${x.slug}`))}>
                    {r ? (
                      // Above the row's link, so the cell opens that run.
                      <Link href={`/r/${r.id}`} className="relative z-10 inline-flex rounded-lg transition-transform duration-150 hover:scale-105"
                        title={t(`Пройдено ${ok} из ${r.checks.length} проверок — открыть прогон`, `${ok} of ${r.checks.length} checks passed: open the run`)}
                        aria-label={`${row.name}, ${t.text(x.title)}: ${r.score}`}>
                        <ScoreChip score={r.score ?? 0} />
                      </Link>
                    ) : (
                      <span className="inline-flex h-8 w-11 items-center justify-center rounded-lg border border-dashed border-border-strong text-ui text-faint"
                        title={t('Не решал: считается за 0', 'Not done: counts as 0')}>—</span>
                    )}
                  </td>
                )
              })}
              <td className={cn('hidden px-3 py-4 text-right text-body tnum sm:table-cell', on('cost'))}>
                {row.cost === 0 ? (
                  <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2 text-meta font-medium text-muted-foreground" title={providerLabel(row.provider, t)}>
                    {SUBSCRIPTIONS.some((x) => x.value === row.provider) ? t('подписка', 'subscription') : t('бесплатно', 'free')}
                  </span>
                ) : usd(row.cost)}
              </td>
              <td className={cn('hidden py-4 pr-4 pl-3 text-right text-body text-muted-foreground tnum sm:table-cell', on('seconds'))}>{duration(row.seconds)}</td>
            </tr>
          ) })}
        </tbody>
      </table>
    </div>
  )
}

// A task score as a tinted tile in its colour: the row reads as a heat strip.
export function ScoreChip({ score, className }: { score: number; className?: string }) {
  const tone = score >= 75 ? 'bg-success/12 text-success' : score >= 45 ? 'bg-warning/12 text-warning' : 'bg-destructive/12 text-destructive'
  return <span className={cn('inline-flex h-8 w-11 items-center justify-center rounded-lg text-body font-semibold tnum', tone, className)}>{score}</span>
}

// The model in front and the CLI under it, as agent benchmarks show them ("Claude Opus 5.5" over "Claude Code"):
// a ready agent is named "<CLI> · <model>". An agent without a known model keeps its name.
export function agentLabel(row: Pick<Standing, 'name' | 'model_name'>): { title: string; sub: string | null } {
  const m = row.model_name
  if (!m) return { title: row.name, sub: null }
  const cli = row.name.split(' · ')[0].trim()
  // "(free)" is said by the cost column.
  return { title: m.replace(/\s*\(free\)$/i, ''), sub: cli && cli !== row.name && cli !== m ? cli : null }
}

// The first three stand out: the leader in gold (the warning amber), the next two in grey.
function Rank({ rank }: { rank: number }) {
  if (rank > 3) return <span className="inline-flex w-8 justify-center text-body font-medium text-faint tnum">{rank}</span>
  return (
    <span className={cn('inline-flex size-8 items-center justify-center rounded-full text-body font-semibold tnum',
      rank === 1 ? 'bg-warning/15 text-warning ring-1 ring-warning/30 ring-inset' : 'bg-secondary text-foreground ring-1 ring-border ring-inset')}>
      {rank === 1 ? <Trophy className="size-4" aria-label="1" /> : rank}
    </span>
  )
}

// A score as a filled share of a track, in the score's colour.
function Bar({ score, className }: { score: number; className?: string }) {
  const fill = score >= 75 ? 'bg-success' : score >= 45 ? 'bg-warning' : 'bg-destructive'
  return (
    <span aria-hidden className={cn('h-2 overflow-hidden rounded-full bg-secondary', className)}>
      <span className={cn('block h-full rounded-full', fill)} style={{ width: `${Math.max(2, score)}%` }} />
    </span>
  )
}

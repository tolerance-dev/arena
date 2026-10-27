'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Play, RotateCcw } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { duration, usd } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import type { T } from '@/lib/i18n'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { AgentAvatar, exitLabel, isActive, RunShot, Score, StatusPill, TaskTile } from './bits'
import { agentElapsed, useNow } from './live-runs'

// What a cell holds: the newest run of that agent at that task, or nothing yet.
type Cell = { kind: 'none' } | { kind: 'active' | 'done' | 'failed' | 'cancelled'; run: Run }

// A run worth starting again: the platform failed it, or the agent left no app that starts.
function cellOf(run: Run | undefined): Cell {
  if (!run) return { kind: 'none' }
  if (isActive(run)) return { kind: 'active', run }
  if (run.status === 'infra_error') return { kind: run.failure_reason === 'cancelled' ? 'cancelled' : 'failed', run }
  return { kind: run.app_started ? 'done' : 'failed', run }
}

function failure(run: Run, t: T) {
  if (run.status === 'infra_error') return run.failure_reason ? t(`Сбой платформы: ${run.failure_reason}`, `Platform failure: ${run.failure_reason}`) : t('Сбой платформы', 'Platform failure')
  return [t('Приложение не запустилось', 'The app didn’t start'), exitLabel(run.agent_exit, t)].filter(Boolean).join(' · ')
}

// Every agent against every task in one table, so that all of them get done: a finished cell shows the app like a
// tile, an empty one starts the first run, a red one (a platform failure, or no app that starts) starts it again.
// "Start the missing ones" fills every empty and red cell in one click.
export function RunMatrix({ agents, tasks, onStarted }: { agents: Agent[]; tasks: TaskSummary[]; onStarted: () => void }) {
  const t = useT()
  const now = useNow()
  const latest = usePoll<{ items: Run[] }>('/my/runs?latest=1', 3_000)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const byPair = new Map((latest.data?.items ?? []).map((r) => [`${r.agent.id}/${r.task}`, r]))
  const rows = [...agents].sort((a, b) => a.name.localeCompare(b.name))
  const missing = rows.flatMap((a) => tasks.filter((task) => {
    const k = cellOf(byPair.get(`${a.id}/${task.slug}`)).kind
    return k === 'none' || k === 'failed'
  }).map((task) => ({ agent: a.id, task: task.slug })))

  async function start(pairs: { agent: string; task: string }[]) {
    const keys = pairs.map((p) => `${p.agent}/${p.task}`)
    setBusy((b) => new Set([...b, ...keys]))
    setErr('')
    try {
      // One at a time: the queue takes them in order, and a per-user limit stops the rest with its own message.
      for (const p of pairs) await post<Run>('/my/runs', { agent_id: p.agent, task: p.task })
    } catch (e) {
      setErr(errorText(e, t))
    } finally {
      await latest.reload()
      setBusy((b) => new Set([...b].filter((k) => !keys.includes(k))))
      onStarted()
    }
  }

  if (!rows.length || !tasks.length) return null
  return (
    <section>
      <SectionTitle aside={missing.length > 0 && (
        <Button size="sm" disabled={busy.size > 0} onClick={() => void start(missing)}>
          <Play /> {t.plural(missing.length, ['Запустить {n} недостающий', 'Запустить {n} недостающих', 'Запустить {n} недостающих'], ['Start {n} missing', 'Start {n} missing'])}
        </Button>
      )}>{t('Агенты × задания', 'Agents × tasks')}</SectionTitle>
      {err && <p role="alert" className="mb-3 text-body text-destructive">{err}</p>}
      <div className="overflow-x-auto rounded-xl border-2 border-border">
        <table className="w-full min-w-[600px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="w-40 px-3 py-2 text-meta font-medium text-muted-foreground sm:w-56 sm:px-4">{t('Агент', 'Agent')}</th>
              {tasks.map((task) => (
                <th key={task.slug} className="px-3 py-2">
                  <Link href={`/t/${encodeURIComponent(task.slug)}`} className="inline-flex items-center gap-2 text-body font-semibold hover:text-primary">
                    <TaskTile slug={task.slug} size="sm" />{t.text(task.title)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.id}>
                <th scope="row" className="px-3 py-3 align-top font-normal sm:px-4">
                  <span className="flex items-start gap-2">
                    <AgentAvatar name={a.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold">{a.name}</span>
                      <span className="block truncate text-meta text-muted-foreground">{a.model_name ?? a.model ?? t('свой файл', 'own file')}</span>
                    </span>
                  </span>
                </th>
                {tasks.map((task) => {
                  const key = `${a.id}/${task.slug}`
                  return (
                    <td key={task.slug} className="p-2 align-top">
                      <MatrixCell cell={cellOf(byPair.get(key))} now={now} busy={busy.has(key)} loading={!latest.data}
                        onStart={() => void start([{ agent: a.id, task: task.slug }])} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MatrixCell({ cell, now, busy, loading, onStart }: { cell: Cell; now: number; busy: boolean; loading: boolean; onStart: () => void }) {
  const t = useT()
  const box = 'flex aspect-[16/11] w-full flex-col overflow-hidden rounded-lg border-2'
  if (loading) return <div className={cn(box, 'animate-pulse border-transparent bg-muted')} />
  if (cell.kind === 'none' || cell.kind === 'cancelled') {
    return (
      <button type="button" onClick={onStart} disabled={busy}
        className={cn(box, 'items-center justify-center gap-1 border-dashed border-border-strong text-body font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50')}>
        <Play className="size-4" />
        {busy ? t('Запускаем…', 'Starting…') : t('Запустить', 'Start')}
        {cell.kind === 'cancelled' && <span className="text-meta font-normal text-faint">{t('прошлый отменён', 'the last was cancelled')}</span>}
      </button>
    )
  }
  const run = cell.run
  if (cell.kind === 'active') {
    const elapsed = agentElapsed(run, now)
    return (
      <Link href={`/r/${run.id}`} className={cn(box, 'items-center justify-center gap-1.5 border-border bg-muted transition-colors hover:border-border-strong')}>
        <StatusPill run={run} />
        <span className="text-meta text-muted-foreground tnum">
          {run.status === 'queued'
            ? (run.queue_position ? t(`${run.queue_position}-й в очереди`, `#${run.queue_position} in the queue`) : t('в очереди', 'queued'))
            : `${duration(elapsed)} / ${duration(run.time_limit_s)}`}
        </span>
      </Link>
    )
  }
  if (cell.kind === 'failed') {
    return (
      <div className={cn(box, 'justify-between border-destructive/30 bg-destructive/5 p-2.5')}>
        <Link href={`/r/${run.id}`} className="line-clamp-3 text-meta text-destructive hover:underline">{failure(run, t)}</Link>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onStart} className="self-start">
          <RotateCcw /> {busy ? t('Запускаем…', 'Starting…') : t('Повторить', 'Retry')}
        </Button>
      </div>
    )
  }
  return (
    <div className={cn(box, 'group relative border-border transition-colors hover:border-border-strong')}>
      <Link href={`/r/${run.id}`} className="flex min-h-0 flex-1 flex-col">
        <RunShot run={run} className="min-h-0 w-full flex-1 object-cover object-top" />
        <span className="flex items-baseline justify-between gap-2 border-t border-border px-2 py-1">
          <span><Score score={run.score} /><span className="text-meta text-faint"> / 100</span></span>
          <span className="text-meta text-muted-foreground tnum">{duration(run.agent_seconds)} · {usd(run.cost_usd)}</span>
        </span>
      </Link>
      <button type="button" onClick={onStart} disabled={busy} title={t('Запустить ещё раз', 'Run again')}
        className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-primary disabled:opacity-50">
        <RotateCcw className="size-3.5" />
      </button>
    </div>
  )
}

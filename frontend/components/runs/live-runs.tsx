'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SectionTitle } from '@/components/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import type { Run } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, exitLabel, isActive, PHASE, queueLine, StatusPill, taskTitle } from './bits'
import { TaskGlyph } from './task-glyph'
import { FinishedRuns } from './finished-runs'

// Ticks every second, so running timers move.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// Seconds the agent has worked: live while it builds, final once it stopped.
export function agentElapsed(run: Run, now: number) {
  if (run.status === 'agent' && run.started_at) return Math.max(0, (now - new Date(run.started_at).getTime()) / 1000)
  return run.agent_seconds
}

// The last meaningful line of the agent's log: what it is doing now, or the error it stopped on.
export function lastStep(run: Pick<Run, 'log_tail'>) {
  const lines = (run.log_tail ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('=='))
  const line = lines.at(-1) ?? ''
  return line.replace(/^[•→]\s*/, '').slice(0, 220)
}

// What came of a finished run, in one plain sentence, and whether it went well.
export function outcome(run: Run): { text: string; tone: 'good' | 'bad' | 'muted' } {
  if (run.status === 'infra_error') {
    if (run.failure_reason === 'cancelled') return { text: 'Отменён', tone: 'muted' }
    return { text: `Ошибка платформы: ${run.failure_reason ?? '?'}`, tone: 'bad' }
  }
  const how = run.agent_exit ? exitLabel(run.agent_exit) : ''
  if (run.app_started) return { text: ['Приложение запустилось', how].filter(Boolean).join(' · '), tone: 'good' }
  return { text: ['Приложение не запустилось', how].filter(Boolean).join(' · '), tone: 'bad' }
}

// What is running right now (each run's stage, clock, tokens and last step) and what just finished, with why.
// onChange (the owner's page) lets finished runs be picked, run again and deleted.
export function LiveRuns({ runs, empty, onChange }: { runs: Run[]; empty?: string; onChange?: () => void }) {
  const now = useNow()
  const active = runs.filter(isActive).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const finished = runs.filter((r) => !isActive(r))
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle count={active.length || undefined}>Сейчас идёт</SectionTitle>
        {active.length === 0 ? <EmptyState>{empty ?? 'Сейчас ничего не идёт. Выберите задачу у агента ниже и нажмите «Запустить».'}</EmptyState> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {active.map((r) => <li key={r.id}><LiveCard run={r} now={now} /></li>)}
          </ul>
        )}
      </section>
      {finished.length > 0 && <FinishedRuns runs={finished} onChange={onChange} />}
    </div>
  )
}

function RunTitle({ run }: { run: Run }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-semibold">{run.agent.name}</span>
      <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run)}
      </span>
    </span>
  )
}

function LiveCard({ run, now }: { run: Run; now: number }) {
  const secs = agentElapsed(run, now) ?? 0
  const pct = run.status === 'agent' ? Math.min(100, (100 * secs) / Math.max(1, run.time_limit_s)) : run.status === 'checking' ? 100 : 0
  const used = usedTokens(run.tokens)
  const step = lastStep(run)
  return (
    <Link href={`/r/${run.id}`} className="group block rounded-xl border-2 border-border p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <AgentAvatar name={run.agent.name} size="sm" />
        <RunTitle run={run} />
        <StatusPill run={run} className="ml-auto shrink-0" />
      </div>
      <p className="mt-3 text-body font-medium">{PHASE[run.status]}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pending">
        <div className={cn('h-full rounded-full transition-[width] duration-1000', run.status === 'checking' ? 'animate-status-pulse bg-primary' : 'bg-primary')}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-meta text-muted-foreground tnum">
        <span>{run.status === 'queued' ? (queueLine(run) ?? '—') : `${duration(secs)} из ${duration(run.time_limit_s)}`}</span>
        <span>{`${compact(used)} токенов · запросов к LLM: ${run.tokens.requests}`}{run.cost_usd != null && used > 0 && <> · <b className="font-semibold text-foreground">{usd(run.cost_usd)}</b></>}</span>
      </div>
      {step && run.status !== 'queued' && (
        <p className="mt-3 truncate rounded-md bg-terminal px-2.5 py-1.5 font-mono text-meta text-terminal-foreground" title={step}>{step}</p>
      )}
    </Link>
  )
}

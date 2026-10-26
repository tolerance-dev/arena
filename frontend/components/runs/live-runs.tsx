'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import type { Run } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, exitLabel, isActive, queueLine, StatusPill, taskTitle, type RT } from './bits'
import { TaskGlyph } from './task-glyph'

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
export function outcome(run: Run, t: RT): { text: string; tone: 'good' | 'bad' | 'muted' } {
  if (run.status === 'infra_error') {
    if (run.failure_reason === 'cancelled') return { text: t('outCancelled'), tone: 'muted' }
    return { text: t('outPlatform', { reason: run.failure_reason ?? '?' }), tone: 'bad' }
  }
  const how = run.agent_exit ? exitLabel(t, run.agent_exit) : ''
  if (run.app_started) return { text: [t('outStarted'), how].filter(Boolean).join(' · '), tone: 'good' }
  return { text: [t('outNoStart'), how].filter(Boolean).join(' · '), tone: 'bad' }
}

// What is running right now (each run's stage, clock, tokens and last step) and what just finished, with why.
export function LiveRuns({ runs, t, empty }: { runs: Run[]; t: RT; empty?: string }) {
  const now = useNow()
  const active = runs.filter(isActive).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const finished = runs.filter((r) => !isActive(r)).slice(0, 8)
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle count={active.length || undefined}>{t('liveTitle')}</SectionTitle>
        {active.length === 0 ? <EmptyState>{empty ?? t('liveEmpty')}</EmptyState> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {active.map((r) => <li key={r.id}><LiveCard run={r} now={now} t={t} /></li>)}
          </ul>
        )}
      </section>
      {finished.length > 0 && (
        <section>
          <SectionTitle>{t('finishedTitle')}</SectionTitle>
          <ul className="divide-y divide-border rounded-xl border-2 border-border">
            {finished.map((r) => <li key={r.id}><FinishedRow run={r} t={t} /></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function RunTitle({ run, t }: { run: Run; t: RT }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-semibold">{run.agent.name}</span>
      <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run, t.locale)}
      </span>
    </span>
  )
}

function LiveCard({ run, now, t }: { run: Run; now: number; t: RT }) {
  const secs = agentElapsed(run, now) ?? 0
  const pct = run.status === 'agent' ? Math.min(100, (100 * secs) / Math.max(1, run.time_limit_s)) : run.status === 'checking' ? 100 : 0
  const used = usedTokens(run.tokens)
  const step = lastStep(run)
  return (
    <Link href={`/r/${run.id}`} className="group block rounded-xl border-2 border-border p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <AgentAvatar name={run.agent.name} size="sm" />
        <RunTitle run={run} t={t} />
        <StatusPill run={run} className="ml-auto shrink-0" />
      </div>
      <p className="mt-3 text-body font-medium">{t(`phase.${run.status}` as 'phase.agent')}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pending">
        <div className={cn('h-full rounded-full transition-[width] duration-1000', run.status === 'checking' ? 'animate-status-pulse bg-primary' : 'bg-primary')}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-meta text-muted-foreground tnum">
        <span>{run.status === 'queued' ? (queueLine(run, t) ?? '—') : t('elapsedOf', { t: duration(secs), limit: duration(run.time_limit_s) })}</span>
        <span>{t('tokensReqs', { tokens: compact(used), n: run.tokens.requests })}{run.cost_usd != null && used > 0 && <> · <b className="font-semibold text-foreground">{usd(run.cost_usd)}</b></>}</span>
      </div>
      {step && run.status !== 'queued' && (
        <p className="mt-3 truncate rounded-md bg-terminal px-2.5 py-1.5 font-mono text-meta text-terminal-foreground" title={step}>{step}</p>
      )}
    </Link>
  )
}

function FinishedRow({ run, t }: { run: Run; t: RT }) {
  const o = outcome(run, t)
  const step = o.tone === 'bad' && run.status === 'done' ? lastStep(run) : ''
  return (
    <Link href={`/r/${run.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
      <AgentAvatar name={run.agent.name} size="sm" />
      <RunTitle run={run} t={t} />
      <span className="ml-auto min-w-0 max-w-[55%] text-right">
        <span className={cn('block truncate text-body font-medium', o.tone === 'good' && 'text-success', o.tone === 'bad' && 'text-destructive', o.tone === 'muted' && 'text-muted-foreground')}>
          {o.text}
        </span>
        <span className="block truncate text-meta text-faint" title={step || undefined}>
          {step || <>{duration(run.agent_seconds)} · {t('tokensShort', { tokens: compact(usedTokens(run.tokens)) })}{run.cost_usd != null && <> · {usd(run.cost_usd)}</>} · <Ago iso={run.created_at} /></>}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </Link>
  )
}

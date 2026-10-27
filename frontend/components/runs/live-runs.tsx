'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Square } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import type { T } from '@/lib/i18n'
import { useT } from '@/lib/i18n-client'
import type { Run } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, exitLabel, isActive, phase, queueLine, StatusPill, taskTitle } from './bits'
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
export function outcome(run: Run, t: T): { text: string; tone: 'good' | 'bad' | 'muted' } {
  if (run.status === 'infra_error') {
    if (run.failure_reason === 'cancelled') return { text: t('Отменён', 'Cancelled'), tone: 'muted' }
    return { text: t(`Ошибка платформы: ${run.failure_reason ?? '?'}`, `Platform error: ${run.failure_reason ?? '?'}`), tone: 'bad' }
  }
  if (run.agent_exit === 'key_rejected') return { text: t('Провайдер отклонил ключ агента', 'The provider rejected the agent’s key'), tone: 'bad' }
  const how = run.agent_exit ? exitLabel(run.agent_exit, t) : ''
  if (run.app_started) return { text: [t('Приложение запустилось', 'The app started'), how].filter(Boolean).join(' · '), tone: 'good' }
  return { text: [t('Приложение не запустилось', 'The app didn’t start'), how].filter(Boolean).join(' · '), tone: 'bad' }
}

// What is running right now (each run's stage, clock, tokens and last step) and what just finished, with why.
// Active runs can be ticked and cancelled together; the API lets only their owner (or an admin) do it.
export function LiveRuns({ runs, empty, onChange }: { runs: Run[]; empty?: string; onChange?: () => void }) {
  const t = useT()
  const now = useNow()
  const active = runs.filter(isActive).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const finished = runs.filter((r) => !isActive(r)).slice(0, 8)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Runs that finished meanwhile drop out of the selection.
  const selected = active.filter((r) => picked.has(r.id)).map((r) => r.id)
  const all = active.length > 0 && selected.length === active.length
  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p)
    if (!next.delete(id)) next.add(id)
    return next
  })
  async function cancel() {
    if (!confirm) { setConfirm(true); return }
    setConfirm(false)
    setBusy(true)
    setErr('')
    const results = await Promise.allSettled(selected.map((id) => post(`/my/runs/${id}/cancel`)))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) setErr(errorText(failed.reason, t))
    setPicked(new Set())
    setBusy(false)
    onChange?.()
  }
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle count={active.length || undefined} aside={active.length > 0 && (
          <span className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-ui text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={all}
                onChange={() => setPicked(all ? new Set() : new Set(active.map((r) => r.id)))} />
              {t('Выбрать все', 'Select all')}
            </label>
            {selected.length > 0 && (
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void cancel()} onBlur={() => setConfirm(false)}>
                <Square /> {confirm ? t(`Отменить ${selected.length}? Нажмите ещё раз`, `Cancel ${selected.length}? Press again`) : t(`Отменить выбранные: ${selected.length}`, `Cancel selected: ${selected.length}`)}
              </Button>
            )}
          </span>
        )}>{t('Сейчас идёт', 'Running now')}</SectionTitle>
        {err && <p role="alert" className="mb-3 text-body text-destructive">{err}</p>}
        {active.length === 0 ? <EmptyState>{empty ?? t('Сейчас ничего не идёт. Выберите задачу у агента ниже и нажмите «Запустить».', 'Nothing is running. Pick a task for an agent below and press “Start”.')}</EmptyState> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {active.map((r) => (
              <li key={r.id} className="relative">
                <LiveCard run={r} now={now} picked={picked.has(r.id)} />
                {/* Outside the card's link: a checkbox can't sit inside an <a>. */}
                <input type="checkbox" className="absolute top-[1.4rem] left-4 size-4 cursor-pointer accent-primary" checked={picked.has(r.id)}
                  onChange={() => toggle(r.id)} aria-label={t(`Выбрать прогон ${r.agent.name}`, `Select run of ${r.agent.name}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {finished.length > 0 && (
        <section>
          <SectionTitle>{t('Недавно закончились', 'Recently finished')}</SectionTitle>
          <ul className="divide-y divide-border rounded-xl border-2 border-border">
            {finished.map((r) => <li key={r.id}><FinishedRow run={r} /></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function RunTitle({ run }: { run: Run }) {
  const t = useT()
  return (
    <span className="min-w-0">
      <span className="block truncate font-semibold">{run.agent.name}</span>
      <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run, t)}
      </span>
    </span>
  )
}

function LiveCard({ run, now, picked }: { run: Run; now: number; picked: boolean }) {
  const t = useT()
  const secs = agentElapsed(run, now) ?? 0
  const pct = run.status === 'agent' ? Math.min(100, (100 * secs) / Math.max(1, run.time_limit_s)) : run.status === 'checking' ? 100 : 0
  const used = usedTokens(run.tokens)
  const step = lastStep(run)
  return (
    <Link href={`/r/${run.id}`} className={cn('group block rounded-xl border-2 p-4 pl-11 transition-colors', picked ? 'border-primary' : 'border-border hover:border-border-strong')}>
      <div className="flex items-start gap-3">
        <AgentAvatar name={run.agent.name} size="sm" />
        <RunTitle run={run} />
        <StatusPill run={run} className="ml-auto shrink-0" />
      </div>
      <p className="mt-3 text-body font-medium">{phase(run.status, t)}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pending">
        <div className={cn('h-full rounded-full transition-[width] duration-1000', run.status === 'checking' ? 'animate-status-pulse bg-primary' : 'bg-primary')}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-meta text-muted-foreground tnum">
        <span>{run.status === 'queued' ? (queueLine(run, t) ?? '—') : t(`${duration(secs)} из ${duration(run.time_limit_s)}`, `${duration(secs)} of ${duration(run.time_limit_s)}`)}</span>
        <span>{t(`${compact(used)} токенов · запросов к LLM: ${run.tokens.requests}`, `${compact(used)} tokens · ${run.tokens.requests} LLM requests`)}{run.cost_usd != null && used > 0 && <> · <b className="font-semibold text-foreground">{usd(run.cost_usd)}</b></>}</span>
      </div>
      {step && run.status !== 'queued' && (
        <p className="mt-3 truncate rounded-md bg-terminal px-2.5 py-1.5 font-mono text-meta text-terminal-foreground" title={step}>{step}</p>
      )}
    </Link>
  )
}

function FinishedRow({ run }: { run: Run }) {
  const t = useT()
  const o = outcome(run, t)
  const step = o.tone === 'bad' && run.status === 'done' ? lastStep(run) : ''
  return (
    <Link href={`/r/${run.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
      <AgentAvatar name={run.agent.name} size="sm" />
      <RunTitle run={run} />
      <span className="ml-auto min-w-0 max-w-[55%] text-right">
        <span className={cn('block truncate text-body font-medium', o.tone === 'good' && 'text-success', o.tone === 'bad' && 'text-destructive', o.tone === 'muted' && 'text-muted-foreground')}>
          {o.text}
        </span>
        <span className="block truncate text-meta text-faint" title={step || undefined}>
          {step || <>{duration(run.agent_seconds)} · {t(`${compact(usedTokens(run.tokens))} токенов`, `${compact(usedTokens(run.tokens))} tokens`)}{run.cost_usd != null && <> · {usd(run.cost_usd)}</>} · <Ago iso={run.created_at} /></>}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </Link>
  )
}

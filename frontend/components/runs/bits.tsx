'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api'
import { compact, duration, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Check, Run, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { TaskGlyph } from './task-glyph'

export type RT = ReturnType<typeof useT<typeof runsMessages.en>>

// Fetches path now and every `ms` while `active(data)` holds (or always, when active is omitted).
export function usePoll<T>(path: string | null, ms: number, active?: (d: T) => boolean) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const load = useCallback(async () => {
    if (!path) return null
    try {
      const d = await api<T>(path)
      setData(d)
      setError(null)
      return d
    } catch (e) {
      setError(e as ApiError)
      return null
    }
  }, [path])
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const d = await load()
      if (!live) return
      if (!activeRef.current || (d && activeRef.current(d))) timer = setTimeout(tick, ms)
    }
    void tick()
    return () => { live = false; clearTimeout(timer) }
  }, [load, ms])
  return { data, error, reload: load }
}

export const ACTIVE: RunStatus[] = ['queued', 'agent', 'checking']
export const isActive = (r: Pick<Run, 'status'>) => ACTIVE.includes(r.status)

export function StatusPill({ run, className }: { run: Pick<Run, 'status' | 'failure_reason'>; className?: string }) {
  const t = useT(runsMessages)
  const active = isActive(run)
  const cancelled = run.status === 'infra_error' && run.failure_reason === 'cancelled'
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap',
      active && 'bg-accent text-accent-foreground',
      run.status === 'done' && 'bg-success/12 text-success',
      run.status === 'infra_error' && (cancelled ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'), className)}>
      <span className={cn('size-1.5 rounded-full bg-current', active && 'animate-status-pulse')} />
      {cancelled ? t('cancelled') : t(`status.${run.status}`)}
    </span>
  )
}

// Green from 75, amber from 45, red below.
export function scoreTone(score: number) {
  return score >= 75 ? 'text-success' : score >= 45 ? 'text-warning' : 'text-destructive'
}

export function Score({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return <span className={cn('text-muted-foreground', className)}>—</span>
  return <span className={cn('font-semibold tnum', scoreTone(score), className)}>{score}</span>
}

// The run's checks in the order they ran, one cell each: the arena's signature. Small in tables, large on a
// run page (with each check's name on hover).
export function CheckStrip({ checks, size = 'sm', className }: { checks: Check[]; size?: 'sm' | 'lg'; className?: string }) {
  const t = useT(runsMessages)
  if (checks.length === 0) return null
  const ok = checks.filter((c) => c.passed).length
  return (
    <span role="img" aria-label={t.plural('checksPassed', checks.length, { ok })}
      className={cn('flex', size === 'sm' ? 'gap-[2px]' : 'flex-wrap gap-[3px]', className)}>
      {checks.map((c, i) => (
        <span key={`${i}-${c.name}`} title={size === 'lg' ? `${i + 1}. ${c.name}` : undefined}
          className={cn('shrink-0', size === 'sm' ? 'h-3 w-[5px] rounded-[1px]' : 'h-7 w-[18px] rounded-[2px]',
            c.passed ? 'bg-success' : 'bg-destructive')} />
      ))}
    </span>
  )
}

export function exitLabel(t: RT, exit: string | null) {
  if (!exit) return ''
  if (exit.startsWith('error:')) return t('exit.error', { code: exit.slice(6) })
  return t(`exit.${exit}` as 'exit.ok')
}

export function taskTitle(slug: string, locale: 'en' | 'ru') {
  const titles: Record<string, [string, string]> = {
    rbtree: ['Red-black tree', 'Красно-чёрное дерево'], 'linked-list': ['Doubly linked list', 'Двусвязный список'],
    digraph: ['Directed graph', 'Ориентированный граф'],
  }
  const p = titles[slug]
  return p ? p[locale === 'ru' ? 1 : 0] : slug
}

function passed(r: Run) {
  return { ok: r.checks.filter((c) => c.passed).length, all: r.checks.length }
}

const th = 'px-3 py-2 font-medium'
const td = 'px-3 py-2.5'

// Runs as a table: the leaderboard (ranked) or a plain list. Scrolls sideways inside itself on phones.
export function RunTable({ runs, ranked, showTask }: { runs: Run[]; ranked?: boolean; showTask?: boolean }) {
  const t = useT(runsMessages)
  if (runs.length === 0) {
    return <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noRuns')}</p>
  }
  const judged = runs.some((r) => r.judge?.status === 'ok')
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {ranked && <th className={cn(th, 'w-10 pl-4')}>#</th>}
            <th className={cn(th, !ranked && 'pl-4')}>{t('colAgent')}</th>
            <th className={cn(th, 'text-right')}>{t('colScore')}</th>
            <th className={th}>{t('colChecks')}</th>
            <th className={cn(th, 'text-right')}>{t('colLoc')}</th>
            <th className={cn(th, 'text-right')}>{t('colTime')}</th>
            <th className={cn(th, 'text-right')}>{t('colTokens')}</th>
            {judged && <th className={cn(th, 'text-right')}>{t('colJudge')}</th>}
            <th className={cn(th, 'pr-4 text-right')}>{t('colWhen')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const c = passed(r)
            const done = r.status === 'done'
            return (
              <tr key={r.id} className="relative border-b border-border last:border-0 hover:bg-muted/60">
                {ranked && <td className={cn(td, 'pl-4 text-muted-foreground tnum')}>{i + 1}</td>}
                <td className={cn(td, !ranked && 'pl-4')}>
                  <Link href={`/r/${r.id}`} className="font-medium whitespace-nowrap after:absolute after:inset-0 hover:underline">{r.agent.name}</Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                    {showTask && <><TaskGlyph slug={r.task} className="size-3.5" /><span>{taskTitle(r.task, t.locale)}</span><span aria-hidden>/</span></>}
                    <span>{r.agent.owner}</span>
                  </div>
                </td>
                <td className={cn(td, 'text-right text-base')}>{done ? <Score score={r.score} /> : <StatusPill run={r} />}</td>
                <td className={td}>
                  {c.all ? (
                    <div className="flex items-center gap-2.5">
                      <CheckStrip checks={r.checks} />
                      <span className="text-xs text-muted-foreground tnum">{c.ok}/{c.all}</span>
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={cn(td, 'text-right tnum')}>{done ? compact(r.stats.loc) : '—'}</td>
                <td className={cn(td, 'text-right tnum')}>{duration(r.agent_seconds)}</td>
                <td className={cn(td, 'text-right tnum')}>{compact(usedTokens(r.tokens))}</td>
                {judged && <td className={cn(td, 'text-right tnum')}>{r.judge?.status === 'ok' ? r.judge.score : '—'}</td>}
                <td className={cn(td, 'pr-4 text-right text-xs whitespace-nowrap text-muted-foreground')}><Ago iso={r.created_at} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function Ago({ iso }: { iso: string }) {
  const t = useT(runsMessages)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return null
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return <>{t('ago.s', { n: s })}</>
  if (s < 3600) return <>{t('ago.m', { n: Math.round(s / 60) })}</>
  if (s < 86400) return <>{t('ago.h', { n: Math.round(s / 3600) })}</>
  return <>{t('ago.d', { n: Math.round(s / 86400) })}</>
}

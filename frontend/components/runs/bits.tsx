'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api'
import { compact, duration, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

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
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold whitespace-nowrap',
      active && 'bg-accent text-accent-foreground',
      run.status === 'done' && 'bg-success/12 text-success',
      run.status === 'infra_error' && 'bg-destructive/10 text-destructive', className)}>
      <span className={cn('size-1.5 rounded-full bg-current', active && 'animate-status-pulse')} />
      {cancelled ? t('cancelled') : t(`status.${run.status}`)}
    </span>
  )
}

// The score as a number on a colour that reads at a glance: green from 75, amber from 45, red below.
export function ScoreBadge({ score, size = 'md' }: { score: number | null; size?: 'md' | 'lg' }) {
  if (score == null) return <span className="text-muted-foreground">—</span>
  const tone = score >= 75 ? 'bg-success text-success-foreground' : score >= 45 ? 'bg-warning text-warning-foreground' : 'bg-destructive text-white dark:text-background'
  return (
    <span className={cn('inline-flex items-center justify-center rounded-lg font-mono font-bold tabular-nums', tone,
      size === 'lg' ? 'h-16 min-w-20 px-3 text-4xl' : 'h-7 min-w-10 px-1.5 text-sm')}>
      {score}
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
    marketplace: ['Marketplace', 'Маркетплейс'], hotels: ['Hotel booking', 'Бронирование отелей'], cinema: ['Online cinema', 'Онлайн-кинотеатр'],
  }
  const p = titles[slug]
  return p ? p[locale === 'ru' ? 1 : 0] : slug
}

// One accent per task, used for the poster cards and small markers.
export const TASK_ACCENT: Record<string, string> = { marketplace: 'var(--pop-1)', hotels: 'var(--pop-4)', cinema: 'var(--pop-2)' }

function passed(r: Run) {
  return { ok: r.checks.filter((c) => c.passed).length, all: r.checks.length }
}

// Runs as a table: the leaderboard (ranked) or a plain list. Scrolls sideways inside itself on phones.
export function RunTable({ runs, ranked, showTask }: { runs: Run[]; ranked?: boolean; showTask?: boolean }) {
  const t = useT(runsMessages)
  if (runs.length === 0) {
    return <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noRuns')}</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
            {ranked && <th className="w-10 py-2.5 pl-4">#</th>}
            <th className="py-2.5 pl-4">{t('colAgent')}</th>
            <th className="px-2 py-2.5">{t('colScore')}</th>
            <th className="px-2 py-2.5 text-right">{t('colLoc')}</th>
            <th className="px-2 py-2.5 text-right">{t('colTime')}</th>
            <th className="px-2 py-2.5 text-right">{t('colTokens')}</th>
            <th className="px-2 py-2.5 text-right">{t('colChecks')}</th>
            <th className="px-2 py-2.5 text-right">{t('colJudge')}</th>
            <th className="py-2.5 pr-4 pl-2 text-right">{t('colWhen')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const c = passed(r)
            return (
              <tr key={r.id} className="group relative border-b border-border last:border-0 hover:bg-muted/50">
                {ranked && <td className="py-3 pl-4 font-mono text-muted-foreground tabular-nums">{i + 1}</td>}
                <td className="py-3 pl-4">
                  <Link href={`/r/${r.id}`} className="font-bold after:absolute after:inset-0 hover:underline">{r.agent.name}</Link>
                  <div className="text-xs text-muted-foreground">
                    {showTask && <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: TASK_ACCENT[r.task] }} />}
                    {showTask ? taskTitle(r.task, t.locale) + ' · ' : ''}{r.agent.owner}
                  </div>
                </td>
                <td className="px-2 py-3">{r.status === 'done' ? <ScoreBadge score={r.score} /> : <StatusPill run={r} />}</td>
                <td className="px-2 py-3 text-right font-mono tabular-nums">{r.status === 'done' ? compact(r.stats.loc) : '—'}</td>
                <td className="px-2 py-3 text-right font-mono tabular-nums">{duration(r.agent_seconds)}</td>
                <td className="px-2 py-3 text-right font-mono tabular-nums">{compact(usedTokens(r.tokens))}</td>
                <td className="px-2 py-3 text-right font-mono tabular-nums">{c.all ? `${c.ok}/${c.all}` : '—'}</td>
                <td className="px-2 py-3 text-right font-mono tabular-nums">{r.judge?.status === 'ok' ? r.judge.score : '—'}</td>
                <td className="py-3 pr-4 pl-2 text-right text-xs whitespace-nowrap text-muted-foreground"><Ago iso={r.created_at} /></td>
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

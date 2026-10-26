'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { compact, duration, plural, usd, usedTokens } from '@/lib/format'
import { PROVIDERS, SUBSCRIPTIONS } from '@/lib/providers'
import type { Check, Run, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { stackOf, VENDOR_CLASS, VENDOR_LABEL, vendorOf } from '@/lib/vendor'
import { EmptyState } from '@/components/ui/empty-state'
import { TaskGlyph } from './task-glyph'

// only: the providers to offer (a ready agent works with some keys only).
export function ProviderOptions({ subscriptions, only }: { subscriptions?: boolean; only?: string[] }) {
  return <>{[...PROVIDERS, ...(subscriptions ? SUBSCRIPTIONS : [])].filter((p) => !only || only.includes(p.value))
    .map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</>
}

export const ACTIVE: RunStatus[] = ['queued', 'agent', 'checking']

const STATUS: Record<RunStatus, string> = {
  queued: 'В очереди', agent: 'Строит', checking: 'Проверка', done: 'Готово', infra_error: 'Ошибка платформы',
}

// What an active run is doing, for its page and the live cards.
export const PHASE: Partial<Record<RunStatus, string>> = {
  queued: 'Ждёт свободного места', agent: 'Агент пишет приложение', checking: 'Проверка: запуск, проверки, скриншоты',
}

const EXIT: Record<string, string> = { ok: 'закончил сам', timeout: 'упёрся в лимит времени', budget: 'кончились токены' }
export const isActive = (r: Pick<Run, 'status'>) => ACTIVE.includes(r.status)

// A queued run's place and wait: "Place in the queue: 3 · starts in about 40 min". null when it isn't queued.
export function queueLine(run: Run): string | null {
  if (run.status !== 'queued' || run.queue_position == null) return null
  const place = run.queue_position === 1 ? 'Следующий в очереди' : `Место в очереди: ${run.queue_position}`
  const w = run.queue_wait_s
  const wait = w == null ? 'очередь на паузе'
    : w < 90 ? 'старт примерно через минуту'
    : w < 2 * 3600 ? `старт примерно через ${Math.round(w / 60)} мин`
    : `старт примерно через ${Math.round(w / 3600)} ч`
  return `${place} · ${wait}`
}

export function StatusPill({ run, className }: { run: Pick<Run, 'status' | 'failure_reason'>; className?: string }) {
  const active = isActive(run)
  const cancelled = run.status === 'infra_error' && run.failure_reason === 'cancelled'
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-card px-1.5 text-meta font-medium whitespace-nowrap text-muted-foreground',
      className)}>
      <span className={cn('size-1.5 rounded-full',
        active && 'animate-status-pulse bg-primary',
        run.status === 'done' && 'bg-success',
        run.status === 'infra_error' && (cancelled ? 'bg-faint' : 'bg-destructive'))} />
      {cancelled ? 'Отменён' : STATUS[run.status]}
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
export function CheckStrip({ checks, size = 'sm', className }: { checks: Check[]; size?: 'xs' | 'sm' | 'lg'; className?: string }) {
  if (checks.length === 0) return null
  const ok = checks.filter((c) => c.passed).length
  return (
    <span role="img" aria-label={plural(checks.length, `Пройдено ${ok} из {n} проверки`, `Пройдено ${ok} из {n} проверок`, `Пройдено ${ok} из {n} проверок`)}
      className={cn('flex', size === 'xs' ? 'gap-px' : size === 'sm' ? 'gap-[2px]' : 'flex-wrap gap-[3px]', className)}>
      {checks.map((c, i) => (
        <span key={`${i}-${c.name}`} title={size === 'lg' ? `${i + 1}. ${c.name}` : undefined}
          className={cn('shrink-0', size === 'xs' ? 'h-3 w-[3px] rounded-[1px]' : size === 'sm' ? 'h-3 w-[5px] rounded-[1px]' : 'h-7 w-[18px] rounded-[2px]',
            c.passed ? 'bg-success' : 'bg-destructive')} />
      ))}
    </span>
  )
}

export function exitLabel(exit: string | null) {
  if (!exit) return ''
  if (exit.startsWith('error:')) return `упал (код ${exit.slice(6)})`
  return EXIT[exit] ?? exit
}

// The run's task as the catalog names it; the slug when the task has left the catalog.
export function taskTitle(run: Pick<Run, 'task' | 'task_title'>) {
  return run.task_title || run.task
}

function passed(r: Run) {
  return { ok: r.checks.filter((c) => c.passed).length, all: r.checks.length }
}

const th = 'h-9 px-3 font-medium'
const td = 'px-3 py-2.5'

// Runs as a table: the leaderboard (ranked) or a plain list. Scrolls sideways inside itself on phones.
export function RunTable({ runs, ranked, showTask }: { runs: Run[]; ranked?: boolean; showTask?: boolean }) {
  if (runs.length === 0) return <EmptyState>Прогонов пока нет.</EmptyState>
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] text-body">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-meta text-faint">
            {ranked && <th className={cn(th, 'w-10 pl-4')}>#</th>}
            <th className={cn(th, !ranked && 'pl-4')}>Агент</th>
            <th className={cn(th, 'text-right')}>Оценка</th>
            <th className={th}>Проверки</th>
            <th className={cn(th, 'text-right')}>Строк</th>
            <th className={cn(th, 'text-right')}>Время</th>
            <th className={cn(th, 'text-right')}>Токены</th>
            <th className={cn(th, 'text-right')}>Стоимость</th>
            <th className={cn(th, 'pr-4 text-right')}>Когда</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const c = passed(r)
            const done = r.status === 'done'
            return (
              <tr key={r.id} className="relative border-b border-border transition-colors duration-[120ms] last:border-0 hover:bg-muted">
                {ranked && <td className={cn(td, 'pl-4 text-faint tnum')}>{i + 1}</td>}
                <td className={cn(td, !ranked && 'pl-4')}>
                  <Link href={`/r/${r.id}`} className="font-medium whitespace-nowrap after:absolute after:inset-0">{r.agent.name}</Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-meta whitespace-nowrap text-faint">
                    {showTask && <><TaskGlyph slug={r.task} className="size-3.5" /><span>{taskTitle(r)}</span><span aria-hidden>·</span></>}
                    <span>{r.agent.owner}</span>
                  </div>
                </td>
                <td className={cn(td, 'text-right text-lead')}>{done ? <Score score={r.score} /> : <StatusPill run={r} />}</td>
                <td className={td}>
                  {c.all ? (
                    <div className="flex items-center gap-2.5">
                      <CheckStrip checks={r.checks} />
                      <span className="text-meta text-faint tnum">{c.ok}/{c.all}</span>
                    </div>
                  ) : <span className="text-faint">—</span>}
                </td>
                <td className={cn(td, 'text-right tnum')}>{done ? compact(r.stats.loc) : '—'}</td>
                <td className={cn(td, 'text-right tnum')}>{duration(r.agent_seconds)}</td>
                <td className={cn(td, 'text-right tnum')}>{compact(usedTokens(r.tokens))}</td>
                <td className={cn(td, 'text-right tnum')}>{usd(r.cost_usd)}</td>
                <td className={cn(td, 'pr-4 text-right text-meta whitespace-nowrap text-faint')}><Ago iso={r.created_at} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// A task's glyph on a grey tile: the task's "logo" (Product Hunt's 48px list logos, 64px in a page header).
export function TaskTile({ slug, size = 'md', className }: { slug: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center border border-border bg-muted',
      size === 'sm' ? 'size-8 rounded-lg' : size === 'md' ? 'size-12 rounded-xl' : 'size-16 rounded-lg', className)}>
      <TaskGlyph slug={slug} className={size === 'sm' ? 'size-5' : size === 'md' ? 'size-7' : 'size-9'} />
    </span>
  )
}

// An agent's "logo": its initials on a tile in its model vendor's colour (grey when the name doesn't say). Agents
// have no images, and vendors' logos are not ours to use.
export function AgentAvatar({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
  const vendor = vendorOf(name)
  return (
    <span aria-hidden title={vendor ? VENDOR_LABEL[vendor] : undefined}
      className={cn('flex shrink-0 items-center justify-center border font-semibold',
        vendor ? VENDOR_CLASS[vendor] : 'border-border bg-muted text-muted-foreground',
        size === 'xs' ? 'size-6 rounded-md text-[10px]' : size === 'sm' ? 'size-8 rounded-lg text-meta' : size === 'md' ? 'size-12 rounded-xl text-title' : 'size-16 rounded-lg text-section', className)}>
      {initials}
    </span>
  )
}

// The app's stack in one line ("TypeScript · CSS · Python"), from the run's lines of code per language.
// `pill` sets it apart inside a "·"-separated meta line (Product Hunt's tag pill).
export function Stack({ run, pill, className }: { run: Pick<Run, 'stats'>; pill?: boolean; className?: string }) {
  const stack = stackOf(run.stats?.languages)
  if (!stack.length) return null
  return (
    <span className={cn(pill && 'inline-flex h-6 items-center rounded-full px-2.5 align-middle text-ui whitespace-nowrap text-muted-foreground ring-1 ring-border-strong ring-inset', className)}>
      {stack.join(' · ')}
    </span>
  )
}

// What the run built, as the checker saw it after start; a quiet placeholder when there is no screenshot.
export function RunShot({ run, className }: { run: Pick<Run, 'id' | 'has_shot' | 'agent'>; className?: string }) {
  if (!run.has_shot) {
    return <div className={cn('flex items-center justify-center bg-muted text-ui text-faint', className)}>Нет скриншота</div>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/v1/runs/${run.id}/shot.jpg`} alt={`Страница, которую построил ${run.agent.name}`} loading="lazy"
    className={cn('bg-muted object-cover object-top', className)} />
}

export function Ago({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return null
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return <>{`${s} с назад`}</>
  if (s < 3600) return <>{`${Math.round(s / 60)} мин назад`}</>
  if (s < 86400) return <>{`${Math.round(s / 3600)} ч назад`}</>
  return <>{`${Math.round(s / 86400)} дн назад`}</>
}

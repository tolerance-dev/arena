'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import type { T } from '@/lib/i18n'
import { useT } from '@/lib/i18n-client'
import { PROVIDERS, SUBSCRIPTIONS } from '@/lib/providers'
import type { Check, Run, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { stackOf, VENDOR_CLASS, VENDOR_LABEL, vendorOf } from '@/lib/vendor'
import { EmptyState } from '@/components/ui/empty-state'
import { TaskGlyph } from './task-glyph'

// only: the providers to offer (a ready agent works with some keys only).
export function ProviderOptions({ subscriptions, only }: { subscriptions?: boolean; only?: string[] }) {
  const t = useT()
  return <>{[...PROVIDERS.map((p) => ({ value: p.value, label: p.label })), ...(subscriptions ? SUBSCRIPTIONS.map((p) => ({ value: p.value, label: t.text(p.label) })) : [])]
    .filter((p) => !only || only.includes(p.value))
    .map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</>
}

export const ACTIVE: RunStatus[] = ['queued', 'agent', 'checking']

function statusLabel(s: RunStatus, t: T) {
  switch (s) {
    case 'queued': return t('В очереди', 'Queued')
    case 'agent': return t('Строит', 'Building')
    case 'checking': return t('Проверка', 'Checking')
    case 'done': return t('Готово', 'Done')
    case 'infra_error': return t('Ошибка платформы', 'Platform error')
  }
}

// What an active run is doing, for its page and the live cards.
export function phase(s: RunStatus, t: T) {
  switch (s) {
    case 'queued': return t('Ждёт свободного места', 'Waiting for a free slot')
    case 'agent': return t('Агент пишет приложение', 'The agent is writing the app')
    case 'checking': return t('Проверка: запуск, проверки, скриншоты', 'Checking: start, checks, screenshots')
    default: return ''
  }
}
export const isActive = (r: Pick<Run, 'status'>) => ACTIVE.includes(r.status)

// A queued run's place and wait: "Place in the queue: 3 · starts in about 40 min". null when it isn't queued.
export function queueLine(run: Run, t: T): string | null {
  if (run.status !== 'queued' || run.queue_position == null) return null
  const place = run.queue_position === 1 ? t('Следующий в очереди', 'Next in the queue') : t(`Место в очереди: ${run.queue_position}`, `Place in the queue: ${run.queue_position}`)
  const w = run.queue_wait_s
  const wait = w == null ? t('очередь на паузе', 'the queue is paused')
    : w < 90 ? t('старт примерно через минуту', 'starts in about a minute')
    : w < 2 * 3600 ? t(`старт примерно через ${Math.round(w / 60)} мин`, `starts in about ${Math.round(w / 60)} min`)
    : t(`старт примерно через ${Math.round(w / 3600)} ч`, `starts in about ${Math.round(w / 3600)} h`)
  return `${place} · ${wait}`
}

export function StatusPill({ run, className }: { run: Pick<Run, 'status' | 'failure_reason'>; className?: string }) {
  const active = isActive(run)
  const cancelled = run.status === 'infra_error' && run.failure_reason === 'cancelled'
  const t = useT()
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-card px-1.5 text-meta font-medium whitespace-nowrap text-muted-foreground',
      className)}>
      <span className={cn('size-1.5 rounded-full',
        active && 'animate-status-pulse bg-primary',
        run.status === 'done' && 'bg-success',
        run.status === 'infra_error' && (cancelled ? 'bg-faint' : 'bg-destructive'))} />
      {cancelled ? t('Отменён', 'Cancelled') : statusLabel(run.status, t)}
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
  const t = useT()
  if (checks.length === 0) return null
  const ok = checks.filter((c) => c.passed).length
  return (
    <span role="img" aria-label={t.plural(checks.length, [`Пройдено ${ok} из {n} проверки`, `Пройдено ${ok} из {n} проверок`, `Пройдено ${ok} из {n} проверок`], [`${ok} of {n} check passed`, `${ok} of {n} checks passed`])}
      className={cn('flex', size === 'xs' ? 'gap-px' : size === 'sm' ? 'gap-[2px]' : 'flex-wrap gap-[3px]', className)}>
      {checks.map((c, i) => (
        <span key={`${i}-${c.name}`} title={size === 'lg' ? `${i + 1}. ${c.name}` : undefined}
          className={cn('shrink-0', size === 'xs' ? 'h-3 w-[3px] rounded-[1px]' : size === 'sm' ? 'h-3 w-[5px] rounded-[1px]' : 'h-7 w-[18px] rounded-[2px]',
            c.passed ? 'bg-success' : 'bg-destructive')} />
      ))}
    </span>
  )
}

export function exitLabel(exit: string | null, t: T) {
  if (!exit) return ''
  if (exit.startsWith('error:')) return t(`упал (код ${exit.slice(6)})`, `crashed (code ${exit.slice(6)})`)
  switch (exit) {
    case 'ok': return t('закончил сам', 'finished on its own')
    case 'timeout': return t('упёрся в лимит времени', 'hit the time limit')
    case 'budget': return t('кончились токены', 'ran out of tokens')
    case 'key_rejected': return t('провайдер отклонил ключ', 'the provider rejected the key')
    case 'gateway_restart': return t('платформа перезапускалась', 'the platform restarted')
    default: return exit
  }
}

// The run's task as the catalog names it; the slug when the task has left the catalog.
export function taskTitle(run: Pick<Run, 'task' | 'task_title'>, t: T) {
  return t.text(run.task_title) || run.task
}

function passed(r: Run) {
  return { ok: r.checks.filter((c) => c.passed).length, all: r.checks.length }
}

const th = 'h-9 px-3 font-medium'
const td = 'px-3 py-2.5'

// Runs as a table: the leaderboard (ranked) or a plain list. Scrolls sideways inside itself on phones.
export function RunTable({ runs, ranked, showTask }: { runs: Run[]; ranked?: boolean; showTask?: boolean }) {
  const t = useT()
  if (runs.length === 0) return <EmptyState>{t('Прогонов пока нет.', 'No runs yet.')}</EmptyState>
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] text-body">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-meta text-faint">
            {ranked && <th className={cn(th, 'w-10 pl-4')}>#</th>}
            <th className={cn(th, !ranked && 'pl-4')}>{t('Агент', 'Agent')}</th>
            <th className={cn(th, 'text-right')}>{t('Оценка', 'Score')}</th>
            <th className={th}>{t('Проверки', 'Checks')}</th>
            <th className={cn(th, 'text-right')}>{t('Строк', 'Lines')}</th>
            <th className={cn(th, 'text-right')}>{t('Время', 'Time')}</th>
            <th className={cn(th, 'text-right')}>{t('Токены', 'Tokens')}</th>
            <th className={cn(th, 'text-right')}>{t('Стоимость', 'Cost')}</th>
            <th className={cn(th, 'pr-4 text-right')}>{t('Когда', 'When')}</th>
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
                    {showTask && <><TaskGlyph slug={r.task} className="size-3.5" /><span>{taskTitle(r, t)}</span><span aria-hidden>·</span></>}
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
  const t = useT()
  if (!run.has_shot) {
    return <div className={cn('flex items-center justify-center bg-muted text-ui text-faint', className)}>{t('Нет скриншота', 'No screenshot')}</div>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/v1/runs/${run.id}/shot.jpg`} alt={t(`Страница, которую построил ${run.agent.name}`, `The page ${run.agent.name} built`)} loading="lazy"
    className={cn('bg-muted object-cover object-top', className)} />
}

export function Ago({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null)
  const t = useT()
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return null
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return <>{t(`${s} с назад`, `${s}s ago`)}</>
  if (s < 3600) return <>{t(`${Math.round(s / 60)} мин назад`, `${Math.round(s / 60)} min ago`)}</>
  if (s < 86400) return <>{t(`${Math.round(s / 3600)} ч назад`, `${Math.round(s / 3600)} h ago`)}</>
  return <>{t(`${Math.round(s / 86400)} дн назад`, `${Math.round(s / 86400)} d ago`)}</>
}

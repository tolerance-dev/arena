'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { compact, duration, plural, usd, usedTokens } from '@/lib/format'
import type { Rating, Run } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, CheckStrip, exitLabel, RunShot, Score, Stack } from './bits'

type Row = {
  label: string
  hint?: string
  cell: (r: Run) => ReactNode
  // The number the row is ranked by; null = nothing to compare. The best cell in a row gets highlighted.
  value?: (r: Run) => number | null
  better?: 'high' | 'low'
}
type Section = { title: string; rows: Row[] }

// The automatic checks by name, in the order they run (every run of a task runs the same checks); names come from
// the run with the most of them.
function checkNames(runs: Run[]): string[] {
  return runs.map((r) => r.checks.map((c) => c.name)).reduce((a, b) => (b.length > a.length ? b : a), [] as string[])
}

// Each agent's best run at the task side by side: what it looks like, which checks it passed, what people think of
// it, and what it cost to build. The point of the arena is the difference between agents, so this is the task's
// first tab.
export function Compare({ runs, ratings = {} }: { runs: Run[]; ratings?: Record<string, Rating> }) {
  if (runs.length === 0) return <EmptyState>Прогонов пока нет.</EmptyState>
  const names = checkNames(runs)
  const sections: Section[] = [
    {
      title: 'Результат',
      rows: [
        { label: 'Оценка', cell: (r) => <Score score={r.score} className="text-section" />, value: (r) => r.score, better: 'high' },
        // People's Elo, once anyone has voted at this task.
        ...(Object.keys(ratings).length ? [{
          label: 'Люди (Elo)', hint: 'По слепым голосам людей на /vote',
          cell: (r: Run) => {
            const p = ratings[r.agent.id]
            return p ? <span><span className="font-semibold tnum">{p.elo}</span><span className="block text-meta text-faint">{plural(p.votes, '{n} голос', '{n} голоса', '{n} голосов')}</span></span> : <span className="text-faint">—</span>
          },
          value: (r: Run) => ratings[r.agent.id]?.elo ?? null, better: 'high' as const,
        }] : []),
        {
          label: 'Проверки',
          cell: (r) => r.checks.length ? (
            <span className="flex items-center gap-2.5"><CheckStrip checks={r.checks} /><span className="text-body text-faint tnum">{r.checks.filter((c) => c.passed).length}/{r.checks.length}</span></span>
          ) : <span className="text-faint">—</span>,
          value: (r) => r.checks.length ? r.checks.filter((c) => c.passed).length : null, better: 'high',
        },
      ],
    },
    ...(names.length ? [{ title: 'Проверки', rows: names.map(checkRow) }] : []),
    {
      title: 'Как строил',
      rows: [
        {
          label: 'Время агента',
          cell: (r) => <span><span className="tnum">{duration(r.agent_seconds)}</span>{r.agent_exit && <span className="block text-meta text-faint">{exitLabel(r.agent_exit)}</span>}</span>,
          value: (r) => r.agent_seconds, better: 'low',
        },
        { label: 'Токены', cell: (r) => <span className="tnum">{compact(usedTokens(r.tokens))}</span>, value: (r) => usedTokens(r.tokens), better: 'low' },
        { label: 'Стоимость', cell: (r) => <span className="tnum">{usd(r.cost_usd)}</span>, value: (r) => r.cost_usd, better: 'low' },
        { label: 'Запросов к LLM', cell: (r) => <span className="tnum">{r.tokens.requests}</span>, value: (r) => r.tokens.requests, better: 'low' },
        { label: 'Строк кода', cell: (r) => <span className="tnum">{compact(r.stats.loc)}<span className="text-faint"> · {`файлов: ${r.stats.files}`}</span></span> },
        {
          label: 'Языки',
          cell: (r) => {
            const top = Object.entries(r.stats.languages).sort((a, b) => b[1] - a[1]).slice(0, 3)
            return top.length ? <span className="text-body">{top.map(([l, n]) => `${l} ${compact(n)}`).join(' · ')}</span> : <span className="text-faint">—</span>
          },
        },
        {
          label: 'Старт за',
          cell: (r) => <span className="tnum">{r.stats.start_seconds != null ? `${r.stats.start_seconds.toFixed(1)} s` : '—'}</span>,
          value: (r) => r.stats.start_seconds ?? null, better: 'low',
        },
        { label: 'Ошибок в консоли', cell: (r) => <span className="tnum">{r.stats.console_errors}</span>, value: (r) => r.stats.console_errors, better: 'low' },
      ],
    },
  ]

  // Agents share the width equally, at least 14rem each; more agents than fit scroll sideways.
  const cols = { gridTemplateColumns: `var(--lbl) repeat(${runs.length}, minmax(14rem, 1fr))`, minWidth: `calc(var(--lbl) + ${runs.length} * 14rem)` }
  return (
    <ScrollSync cols={cols} runs={runs}
      head={<>
        <div className="sticky left-0 z-10 bg-muted" />
        {runs.map((r) => (
          <div key={r.id} className="min-w-0 border-l border-border bg-muted px-3 py-2.5">
            <Link href={`/r/${r.id}`} className="flex items-center gap-2.5 transition-colors hover:text-primary">
              <AgentAvatar name={r.agent.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.agent.name}</span>
                <Stack run={r} className="block truncate text-meta text-muted-foreground" />
              </span>
              <Score score={r.score} className="text-section" />
            </Link>
          </div>
        ))}
      </>}>
      <RowLabel label="Десктоп" />
      {runs.map((r) => (
        <div key={r.id} className="min-w-0 border-b border-l border-border p-3">
          <Link href={`/r/${r.id}`} className="block overflow-hidden rounded-lg border border-border">
            <RunShot run={r} className="aspect-[16/10] w-full" />
          </Link>
        </div>
      ))}
      <RowLabel label="Телефон" />
      {runs.map((r) => (
        <div key={r.id} className="flex justify-center border-b border-l border-border p-3">
          {r.has_shot_mobile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/v1/runs/${r.id}/shot-mobile.jpg`} alt={`Страница, которую построил ${r.agent.name}`} loading="lazy"
              className="h-56 w-auto rounded-lg border border-border bg-muted object-cover object-top" />
          ) : <span className="py-8 text-meta text-faint">Нет скриншота</span>}
        </div>
      ))}

      {sections.map((s) => (
        <SectionRows key={s.title} section={s} runs={runs} />
      ))}

      <div className="sticky left-0 z-10 bg-card" />
      {runs.map((r) => (
        <div key={r.id} className="flex flex-wrap gap-2 border-l border-border p-3">
          {r.preview_url && (
            <Button variant="outline" size="sm" render={<a href={r.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
              <ExternalLink /> Живое превью
            </Button>
          )}
          <Button variant="outline" size="sm" render={<Link href={`/r/${r.id}`} />} nativeButton={false}>Подробнее</Button>
        </div>
      ))}
    </ScrollSync>
  )
}

// The table in two grids with the same columns: the agents' row sticks under the site header while the body
// scrolls sideways under it (one element can't do both: a sideways scroller would trap the sticky row). Once the
// row is stuck, a strip of small screenshots hangs under it, so you still see whose column you are reading.
function ScrollSync({ cols, runs, head, children }: { cols: CSSProperties; runs: Run[]; head: ReactNode; children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null)
  const sticky = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const check = () => {
      if (!sentinel.current || !sticky.current) return
      setStuck(sentinel.current.getBoundingClientRect().top < parseFloat(getComputedStyle(sticky.current).top) - 1)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [])
  const sync = () => {
    const x = body.current?.scrollLeft ?? 0
    if (top.current) top.current.scrollLeft = x
    if (strip.current) strip.current.scrollLeft = x
  }
  useEffect(sync, [stuck])
  return (
    <div className="overflow-clip rounded-xl border-2 border-border">
      <div ref={sentinel} aria-hidden />
      <div ref={sticky} className="sticky top-[58px] z-20 md:top-[72px]">
        <div ref={top} className="overflow-hidden border-b border-border bg-muted">
          <div className="grid [--lbl:7.5rem] sm:[--lbl:11rem]" style={cols}>{head}</div>
        </div>
        {stuck && (
          <div ref={strip} className="absolute inset-x-0 top-full overflow-hidden border-b border-border bg-card shadow-[0_6px_12px_-8px_rgba(16,24,40,0.25)]">
            <div className="grid [--lbl:7.5rem] sm:[--lbl:11rem]" style={cols}>
              <div className="sticky left-0 z-10 bg-card" />
              {runs.map((r) => (
                <Link key={r.id} href={`/r/${r.id}`} className="flex min-w-0 gap-2 border-l border-border px-3 py-2" aria-label={`Страница, которую построил ${r.agent.name}`}>
                  <RunShot run={r} className="aspect-[16/10] h-14 rounded-md border border-border" />
                  {r.has_shot_mobile && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/v1/runs/${r.id}/shot-mobile.jpg`} alt="" className="h-14 w-auto rounded-md border border-border bg-muted object-cover object-top" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <div ref={body} onScroll={sync} className="overflow-x-auto">
        <div className="grid [--lbl:7.5rem] sm:[--lbl:11rem]" style={cols}>{children}</div>
      </div>
    </div>
  )
}

function SectionRows({ section, runs }: { section: Section; runs: Run[] }) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b border-border bg-card px-3 pt-5 pb-2 text-meta font-semibold tracking-wide text-faint uppercase">{section.title}</div>
      <div className="border-b border-border" style={{ gridColumn: `span ${runs.length}` }} />
      {section.rows.map((row) => {
        const best = bestValue(runs, row)
        return (
          <div key={row.label} className="contents">
            <RowLabel label={row.label} hint={row.hint} />
            {runs.map((r) => {
              const v = row.value?.(r)
              return (
                <div key={r.id} className={cn('min-w-0 border-b border-l border-border px-3 py-2.5', best != null && v === best && 'bg-success/10')}>
                  {row.cell(r)}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

function RowLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="sticky left-0 z-10 border-b border-border bg-card px-3 py-2.5 text-body">
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-meta text-faint">{hint}</span>}
    </div>
  )
}

// The best value of a row, or null when there is nothing to tell apart (fewer than two values, or all equal).
function bestValue(runs: Run[], row: Row): number | null {
  if (!row.value || !row.better) return null
  const vs = runs.map((r) => row.value!(r)).filter((v): v is number => v != null)
  if (vs.length < 2 || vs.every((v) => v === vs[0])) return null
  return row.better === 'high' ? Math.max(...vs) : Math.min(...vs)
}

// One row per automatic check: passed or not, and why not.
function checkRow(name: string): Row {
  return {
    label: name,
    cell: (r) => {
      const c = r.checks.find((x) => x.name === name)
      if (!c) return <span className="text-faint">—</span>
      return (
        <span className="flex items-start gap-1.5" title={c.detail}>
          {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" />}
          {!c.passed && c.detail && <span className="line-clamp-2 text-meta leading-snug text-muted-foreground">{c.detail}</span>}
        </span>
      )
    },
  }
}

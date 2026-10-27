'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { fieldClass } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, Score, taskTitle } from './bits'
import { outcome } from './live-runs'
import { TaskGlyph } from './task-glyph'

type Kind = 'all' | 'good' | 'bad' | 'cancelled'

// GET /my/runs/history: one page, and totals over every run the filter matches.
interface HistoryPage {
  items: Run[]; total: number; page: number; per: number
  totals: { good: number; agent_seconds: number; tokens: number; cost_usd: number }
}

// Every finished run of the user's agents, newest first, a page at a time, with its numbers and a button to run the
// same agent at the same task again; filtered by agent, task and outcome on the server, so the totals on top cover
// every run the filter matches. The running ones are above (LiveRuns), the agents × tasks table above that.
export function RunHistory({ agents, tasks, onStarted }: { agents: Agent[]; tasks: TaskSummary[]; onStarted: () => void }) {
  const t = useT()
  const [agent, setAgent] = useState('')
  const [task, setTask] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [page, setPage] = useState(1)
  const q = new URLSearchParams({ page: String(page), ...(agent && { agent }), ...(task && { task }), ...(kind !== 'all' && { outcome: kind }) })
  const history = usePoll<HistoryPage>(`/my/runs/history?${q}`, 10_000)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const data = history.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1
  // A filter starts again from the first page.
  const filter = <V,>(set: (v: V) => void) => (v: V) => { set(v); setPage(1) }
  const filtered = !!(agent || task || kind !== 'all')

  async function again(run: Run) {
    setBusy(run.id)
    setErr('')
    try {
      await post<Run>('/my/runs', { agent_id: run.agent.id, task: run.task })
      onStarted()
    } catch (e) {
      setErr(errorText(e, t))
    } finally {
      setBusy('')
    }
  }

  if (data && data.total === 0 && !filtered) return null
  return (
    <section>
      <SectionTitle count={data?.total || undefined}>{t('История запусков', 'Run history')}</SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label={t('Агент', 'Agent')} className={cn(fieldClass, 'h-8 w-auto max-w-[16rem] text-ui')} value={agent} onChange={(e) => filter(setAgent)(e.target.value)}>
          <option value="">{t('Все агенты', 'All agents')}</option>
          {[...agents].sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label={t('Задание', 'Task')} className={cn(fieldClass, 'h-8 w-auto text-ui')} value={task} onChange={(e) => filter(setTask)(e.target.value)}>
          <option value="">{t('Все задания', 'All tasks')}</option>
          {tasks.map((x) => <option key={x.slug} value={x.slug}>{t.text(x.title)}</option>)}
        </select>
        <Segmented label={t('Исход', 'Outcome')} value={kind} onChange={filter(setKind)} options={[
          { value: 'all', label: t('Все', 'All') }, { value: 'good', label: t('Успешные', 'Succeeded') },
          { value: 'bad', label: t('Упавшие', 'Failed') }, { value: 'cancelled', label: t('Отменённые', 'Cancelled') },
        ]} />
      </div>
      {data && data.total > 0 && (
        <p className="mb-3 text-body text-muted-foreground tnum">
          {t.plural(data.total, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}
          {' · '}{t(`успешных ${data.totals.good}`, `${data.totals.good} succeeded`)}
          {' · '}{t(`время агентов ${duration(data.totals.agent_seconds)}`, `agent time ${duration(data.totals.agent_seconds)}`)}
          {' · '}{t(`${compact(data.totals.tokens)} токенов`, `${compact(data.totals.tokens)} tokens`)}
          {' · '}<b className="font-semibold text-foreground">{usd(data.totals.cost_usd)}</b>
        </p>
      )}
      {err && <p role="alert" className="mb-3 text-body text-destructive">{err}</p>}
      {!data ? <div className="h-64 animate-pulse rounded-xl bg-muted" /> : !data.items.length ? (
        <EmptyState>{t('Под этот фильтр прогонов нет.', 'No runs match this filter.')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border-2 border-border">
          <table className="w-full min-w-[760px] border-collapse text-left text-body">
            <thead>
              <tr className="border-b border-border bg-muted text-meta font-medium text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t('Агент и задание', 'Agent and task')}</th>
                <th className="px-3 py-2 font-medium">{t('Итог', 'Outcome')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Балл', 'Score')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Время', 'Time')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Токены', 'Tokens')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Цена', 'Cost')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Когда', 'When')}</th>
                <th className="w-0 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((r) => {
                const o = outcome(r, t)
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted">
                    <td className="px-4 py-2.5">
                      <Link href={`/r/${r.id}`} className="flex items-center gap-2.5 hover:text-primary">
                        <AgentAvatar name={r.agent.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{r.agent.name}</span>
                          <span className="flex items-center gap-1.5 text-meta text-muted-foreground"><TaskGlyph slug={r.task} className="size-3.5" />{taskTitle(r, t)}</span>
                        </span>
                      </Link>
                    </td>
                    <td className={cn('max-w-[16rem] px-3 py-2.5 text-meta', o.tone === 'good' && 'text-success', o.tone === 'bad' && 'text-destructive', o.tone === 'muted' && 'text-muted-foreground')}>
                      <span className="line-clamp-2">{o.text}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right"><Score score={r.status === 'done' ? r.score : null} /></td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground tnum">{duration(r.agent_seconds)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground tnum" title={t(`запросов к LLM: ${r.tokens.requests}`, `${r.tokens.requests} LLM requests`)}>{compact(usedTokens(r.tokens))}</td>
                    <td className="px-3 py-2.5 text-right tnum">{usd(r.cost_usd)}</td>
                    <td className="px-3 py-2.5 text-right text-meta whitespace-nowrap text-muted-foreground"><Ago iso={r.created_at} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant={o.tone === 'bad' ? 'destructive' : 'outline'} disabled={busy === r.id} onClick={() => void again(r)}
                        title={t('Запустить этого агента на этом задании ещё раз', 'Run this agent at this task again')}>
                        <RotateCcw /> {busy === r.id ? t('Запускаем…', 'Starting…') : t('Ещё раз', 'Again')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <Pager page={Math.min(page, pages)} pages={pages} onPage={setPage} />}
    </section>
  )
}

// Previous, the pages around the current one with the first and the last, next.
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const t = useT()
  const near = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  return (
    <nav aria-label={t('Страницы', 'Pages')} className="mt-3 flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /> {t('Назад', 'Previous')}</Button>
      {near.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - near[i - 1] > 1 && <span className="px-1 text-faint">…</span>}
          <Button variant={p === page ? 'secondary' : 'ghost'} size="sm" aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)} className="tnum">{p}</Button>
        </span>
      ))}
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Вперёд', 'Next')} <ChevronRight /></Button>
    </nav>
  )
}

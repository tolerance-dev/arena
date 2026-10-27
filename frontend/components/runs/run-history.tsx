'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { fieldClass } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import type { Run } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, isActive, Score, taskTitle } from './bits'
import { outcome } from './live-runs'
import { TaskGlyph } from './task-glyph'

type Kind = 'all' | 'good' | 'bad' | 'cancelled'

// The same split as outcome(): the app started, it didn't (or the platform failed), or the run was cancelled.
function kindOf(run: Run): Exclude<Kind, 'all'> {
  if (run.status === 'infra_error') return run.failure_reason === 'cancelled' ? 'cancelled' : 'bad'
  return run.app_started && run.agent_exit !== 'key_rejected' ? 'good' : 'bad'
}

// Every finished run of the user's agents, newest first, with its numbers and a button to run the same agent at the
// same task again; filtered by agent, task and outcome, totals for what's shown on top. The running ones are above
// (LiveRuns), the agents × tasks table above that.
export function RunHistory({ onStarted }: { onStarted: () => void }) {
  const t = useT()
  const [limit, setLimit] = useState(100)
  const runs = usePoll<{ items: Run[] }>(`/my/runs?limit=${limit}`, 10_000)
  const [agent, setAgent] = useState('')
  const [task, setTask] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const finished = (runs.data?.items ?? []).filter((r) => !isActive(r))
  const agents = [...new Map(finished.map((r) => [r.agent.id, r.agent.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const tasks = [...new Map(finished.map((r) => [r.task, taskTitle(r, t)])).entries()]
  const shown = finished.filter((r) => (!agent || r.agent.id === agent) && (!task || r.task === task) && (kind === 'all' || kindOf(r) === kind))
  const good = shown.filter((r) => kindOf(r) === 'good').length
  const tokens = shown.reduce((s, r) => s + usedTokens(r.tokens), 0)
  const spent = shown.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const agentTime = shown.reduce((s, r) => s + (r.agent_seconds ?? 0), 0)

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

  if (runs.data && !finished.length) return null
  return (
    <section>
      <SectionTitle count={finished.length || undefined}>{t('История запусков', 'Run history')}</SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label={t('Агент', 'Agent')} className={cn(fieldClass, 'h-8 w-auto max-w-[16rem] text-ui')} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">{t('Все агенты', 'All agents')}</option>
          {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label={t('Задание', 'Task')} className={cn(fieldClass, 'h-8 w-auto text-ui')} value={task} onChange={(e) => setTask(e.target.value)}>
          <option value="">{t('Все задания', 'All tasks')}</option>
          {tasks.map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}
        </select>
        <Segmented label={t('Исход', 'Outcome')} value={kind} onChange={setKind} options={[
          { value: 'all', label: t('Все', 'All') }, { value: 'good', label: t('Успешные', 'Succeeded') },
          { value: 'bad', label: t('Упавшие', 'Failed') }, { value: 'cancelled', label: t('Отменённые', 'Cancelled') },
        ]} />
      </div>
      {shown.length > 0 && (
        <p className="mb-3 text-body text-muted-foreground tnum">
          {t.plural(shown.length, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}
          {' · '}{t(`успешных ${good}`, `${good} succeeded`)}
          {' · '}{t(`время агентов ${duration(agentTime)}`, `agent time ${duration(agentTime)}`)}
          {' · '}{t(`${compact(tokens)} токенов`, `${compact(tokens)} tokens`)}
          {' · '}<b className="font-semibold text-foreground">{usd(spent)}</b>
        </p>
      )}
      {err && <p role="alert" className="mb-3 text-body text-destructive">{err}</p>}
      {!runs.data ? <div className="h-64 animate-pulse rounded-xl bg-muted" /> : !shown.length ? (
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
              {shown.map((r) => {
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
      {runs.data && runs.data.items.length >= limit && limit < 500 && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setLimit((l) => Math.min(500, l + 200))}>{t('Показать ещё', 'Show more')}</Button>
      )}
    </section>
  )
}

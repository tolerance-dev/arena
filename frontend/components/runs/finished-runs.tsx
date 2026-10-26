'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { del, post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { compact, duration, plural, usd, usedTokens } from '@/lib/format'
import type { Run } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, taskTitle } from './bits'
import { TaskGlyph } from './task-glyph'
import { lastStep, outcome } from './live-runs'

type Kind = 'all' | 'good' | 'bad' | 'error'
const kindOf = (r: Run): Exclude<Kind, 'all'> => (r.status === 'infra_error' ? 'error' : r.app_started ? 'good' : 'bad')
const PAGE = 10
const select = 'h-7 max-w-52 truncate rounded-md border border-input bg-card px-2 text-meta font-medium text-foreground'

// Finished runs, newest first: filters by outcome, agent and task; with onChange (the owner's page) runs can be
// picked and run again or deleted in bulk.
export function FinishedRuns({ runs, onChange }: { runs: Run[]; onChange?: () => void }) {
  const [kindPick, setKind] = useState<Kind>('all')
  const [agentPick, setAgent] = useState('')
  const [taskPick, setTask] = useState('')
  const [all, setAll] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const agents = [...new Map(runs.map((r) => [r.agent.id, r.agent.name])).entries()]
  const tasks = [...new Map(runs.map((r) => [r.task, taskTitle(r)])).entries()]
  // A filter whose runs are all gone (deleted) falls back to all.
  const agent = agents.some(([id]) => id === agentPick) ? agentPick : ''
  const task = tasks.some(([slug]) => slug === taskPick) ? taskPick : ''
  const scoped = runs.filter((r) => (!agent || r.agent.id === agent) && (!task || r.task === task))
  const count = (k: Kind) => (k === 'all' ? scoped.length : scoped.filter((r) => kindOf(r) === k).length)
  const kind = count(kindPick) > 0 ? kindPick : 'all'
  const shown = scoped.filter((r) => kind === 'all' || kindOf(r) === kind)
  const visible = all ? shown : shown.slice(0, PAGE)
  // A pick stays only while its run is in the filtered list.
  const chosen = shown.filter((r) => picked.has(r.id))
  const allPicked = shown.length > 0 && chosen.length === shown.length

  function toggle(id: string) {
    setArmed(false)
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function pickAll() {
    setArmed(false)
    setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.id)))
  }
  // One by one, stopping at the first refusal (a per-user limit, a deleted agent): what went through is said.
  async function bulk(verb: 'restart' | 'delete') {
    if (verb === 'delete' && !armed) return setArmed(true)
    setBusy(true)
    setArmed(false)
    setNote(null)
    let done = 0
    try {
      for (const r of chosen) {
        if (verb === 'restart') await post('/my/runs', { agent_id: r.agent.id, task: r.task, time_limit_s: r.time_limit_s, token_budget: r.token_budget })
        else await del(`/my/runs/${r.id}`)
        done++
      }
      setPicked(new Set())
      setNote({ text: verb === 'restart'
        ? plural(done, 'Запущен заново {n} прогон: он наверху, в «Сейчас идёт».', 'Запущено заново {n} прогона: они наверху, в «Сейчас идёт».', 'Запущено заново {n} прогонов: они наверху, в «Сейчас идёт».')
        : plural(done, 'Удалён {n} прогон.', 'Удалено {n} прогона.', 'Удалено {n} прогонов.') })
    } catch (e) {
      const what = verb === 'restart' ? 'Запущено заново' : 'Удалено'
      setNote({ text: `${what} ${done} из ${chosen.length}. ${errorText(e)}`, bad: true })
    } finally {
      setBusy(false)
      onChange?.()
    }
  }

  return (
    <section>
      <SectionTitle count={runs.length}>Недавно закончились</SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Исход" value={kind} onChange={(v) => { setKind(v); setArmed(false) }} options={([
          ['all', 'Все'], ['good', 'Запустились'], ['bad', 'Не запустились'], ['error', 'Ошибки и отмены'],
        ] as const).filter(([k]) => k === 'all' || count(k) > 0).map(([k, label]) => ({
          value: k, label: <>{label} <span className="text-faint tnum">{count(k)}</span></>,
        }))} />
        {agents.length > 1 && (
          <select aria-label="Агент" className={select} value={agent} onChange={(e) => { setAgent(e.target.value); setArmed(false) }}>
            <option value="">Все агенты</option>
            {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {tasks.length > 1 && (
          <select aria-label="Задача" className={select} value={task} onChange={(e) => { setTask(e.target.value); setArmed(false) }}>
            <option value="">Все задачи</option>
            {tasks.map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}
          </select>
        )}
      </div>
      {note && <p role="status" className={cn('mb-3 text-body', note.bad ? 'text-destructive' : 'text-muted-foreground')}>{note.text}</p>}
      {shown.length === 0 ? <EmptyState>Под эти фильтры прогонов нет.</EmptyState> : (
        <div className="rounded-xl border-2 border-border">
          {onChange && (
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-1.5">
              <label className="flex cursor-pointer items-center gap-3 text-body text-muted-foreground">
                <input type="checkbox" className="size-4 accent-primary" checked={allPicked} onChange={pickAll}
                  ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allPicked }} />
                {chosen.length ? <span className="font-medium text-foreground">{plural(chosen.length, 'Выбран {n}', 'Выбрано {n}', 'Выбрано {n}')}</span> : `Выбрать все ${shown.length}`}
              </label>
              {chosen.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk('restart')}><RotateCcw /> Перезапустить</Button>
                  <Button size="sm" variant={armed ? 'destructive' : 'outline'} disabled={busy} onClick={() => void bulk('delete')} onBlur={() => setArmed(false)}>
                    <Trash2 /> {armed ? `Удалить ${chosen.length}? Нажмите ещё раз` : 'Удалить'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPicked(new Set()); setArmed(false) }}>Снять выбор</Button>
                </div>
              )}
            </div>
          )}
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className={cn('flex items-center', picked.has(r.id) && 'bg-primary/5')}>
                {onChange && (
                  <label className="flex cursor-pointer self-stretch items-center pl-4 pr-1" aria-label={`Выбрать: ${r.agent.name}, ${taskTitle(r)}`}>
                    <input type="checkbox" className="size-4 accent-primary" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  </label>
                )}
                <FinishedRow run={r} />
              </li>
            ))}
          </ul>
          {shown.length > visible.length && (
            <button type="button" onClick={() => setAll(true)}
              className="w-full border-t border-border px-4 py-2.5 text-body font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Показать ещё {shown.length - visible.length}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function FinishedRow({ run }: { run: Run }) {
  const o = outcome(run)
  const step = o.tone === 'bad' && run.status === 'done' ? lastStep(run) : ''
  return (
    <Link href={`/r/${run.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
      <AgentAvatar name={run.agent.name} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{run.agent.name}</span>
        <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run)}
        </span>
      </span>
      <span className="ml-auto min-w-0 max-w-[55%] text-right">
        <span className={cn('block truncate text-body font-medium', o.tone === 'good' && 'text-success', o.tone === 'bad' && 'text-destructive', o.tone === 'muted' && 'text-muted-foreground')}>
          {o.text}
        </span>
        <span className="block truncate text-meta text-faint" title={step || undefined}>
          {step || <>{duration(run.agent_seconds)} · {`${compact(usedTokens(run.tokens))} токенов`}{run.cost_usd != null && <> · {usd(run.cost_usd)}</>} · <Ago iso={run.created_at} /></>}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </Link>
  )
}

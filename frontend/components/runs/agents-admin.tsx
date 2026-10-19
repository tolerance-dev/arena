'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Play, Upload } from 'lucide-react'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { loginHref } from '@/components/public/return-path'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { del, post, put, upload } from '@/lib/api'
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { RunTable, ScoreBadge, usePoll, type RT } from './bits'

const field = 'h-10 w-full rounded-[9px] border border-input bg-card px-3 text-sm'

export function AgentsAdmin() {
  const t = useT(runsMessages)
  const { me, loading } = useMe()
  const agents = usePoll<{ items: Agent[] }>(me?.can_admin ? '/admin/agents' : null, 30_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const runs = usePoll<{ items: Run[] }>(me ? '/runs?limit=20' : null, 4_000)

  if (loading) return <div className="h-96 animate-pulse rounded-2xl bg-muted" />
  if (!me) {
    return (
      <div className="space-y-4">
        <p>{t('signInFirst')}</p>
        <Button render={<Link href={loginHref('/admin')} />} nativeButton={false}>{t('signInFirst')}</Button>
      </div>
    )
  }
  // Everyone signed in sees the same page; only admins (for now the owner) can upload and start runs.
  const canUpload = !!me.can_admin
  const refresh = () => { void agents.reload(); void runs.reload() }
  return (
    <div className="space-y-12">
      <PageHeader title={t('adminTitle')}>{t('adminLead')}</PageHeader>
      <NewAgent t={t} onDone={refresh} disabled={!canUpload} />
      <section>
        <SectionTitle>{t('yourAgents')}</SectionTitle>
        {(!canUpload || agents.data?.items.length === 0) && (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noAgents')}</p>
        )}
        <div className="space-y-4">
          {agents.data?.items.map((a) => <AgentCard key={a.id} agent={a} tasks={tasks.data?.items ?? []} t={t} onChange={refresh} />)}
        </div>
      </section>
      <section>
        <SectionTitle>{t('allRuns')}</SectionTitle>
        <RunTable runs={runs.data?.items ?? []} showTask />
      </section>
    </div>
  )
}

function NewAgent({ t, onDone, disabled }: { t: RT; onDone: () => void; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    setErr('')
    try {
      await upload<Agent>('/admin/agents', new FormData(form))
      form.reset()
      onDone()
    } catch (e) {
      setErr(errorText(e, t.locale))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
      <h2 className="heading mb-5 text-lg">{t('newAgent')}</h2>
      <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
        <fieldset disabled={disabled} className="contents">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('agentName')}</Label>
          <Input id="name" name="name" required minLength={2} maxLength={60} placeholder="Claude Code · Opus 5.5" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">{t('agentDescription')}</Label>
          <Input id="description" name="description" maxLength={500} placeholder={t('agentDescriptionPh')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="provider">{t('agentProvider')}</Label>
          <select id="provider" name="provider" className={field} defaultValue="anthropic">
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api_key">{t('agentKey')}</Label>
          <Input id="api_key" name="api_key" type="password" required autoComplete="off" placeholder="sk-ant-…" />
          <p className="text-xs text-muted-foreground">{t('agentKeyHint')}</p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bundle">{t('agentBundle')}</Label>
          <input id="bundle" name="bundle" type="file" required accept=".zip,.sh,application/zip,text/x-sh"
            className="block w-full rounded-[9px] border border-input bg-card text-sm file:mr-3 file:h-10 file:border-0 file:bg-muted file:px-4 file:font-semibold" />
          <p className="text-xs text-muted-foreground">{t('agentBundleHint')}</p>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy || disabled}><Upload /> {busy ? t('uploading') : t('upload')}</Button>
          {disabled && <span className="text-sm font-semibold text-muted-foreground">{t('inDevelopment')}</span>}
          {err && <span className="text-sm text-destructive">{err}</span>}
        </div>
        </fieldset>
      </form>
    </section>
  )
}

function AgentCard({ agent, tasks, t, onChange }: { agent: Agent; tasks: TaskSummary[]; t: RT; onChange: () => void }) {
  const router = useRouter()
  const [task, setTask] = useState('')
  const [minutes, setMinutes] = useState('')
  const [budgetK, setBudgetK] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [armed, setArmed] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<string>(agent.provider)
  const chosen = task || tasks[0]?.slug || ''

  async function start() {
    setBusy(true)
    setErr('')
    try {
      const run = await post<Run>('/admin/runs', {
        agent_id: agent.id, task: chosen,
        time_limit_s: minutes ? Math.round(Number(minutes) * 60) : 0,
        token_budget: budgetK ? Math.round(Number(budgetK) * 1000) : 0,
      })
      router.push(`/r/${run.id}`)
    } catch (e) {
      setErr(errorText(e, t.locale))
      setBusy(false)
    }
  }
  async function remove() {
    if (!armed) return setArmed(true)
    try {
      await del(`/admin/agents/${agent.id}`)
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
  }
  async function saveKey() {
    try {
      await put(`/admin/agents/${agent.id}/key`, { provider, api_key: key })
      setKey('')
      setKeyOpen(false)
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="heading text-lg">{agent.name}</h3>
            {agent.best_score != null && <ScoreBadge score={agent.best_score} />}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[agent.description, agent.provider, agent.key_hint && t('keyHint', { hint: agent.key_hint }), t.plural('runs', agent.runs)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setKeyOpen((v) => !v)}>{t('replaceKey')}</Button>
          <Button variant="destructive" size="sm" onClick={() => void remove()} onBlur={() => setArmed(false)}>{armed ? t('confirmAgain') : t('deleteAgent')}</Button>
        </div>
      </div>
      {keyOpen && (
        <div className="mt-4 flex flex-wrap gap-2">
          <select className={cn(field, 'w-36')} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <Input type="password" className="min-w-0 flex-1" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
          <Button onClick={() => void saveKey()} disabled={key.length < 20}>{t('saveKey')}</Button>
        </div>
      )}
      <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>{t('task')}</Label>
          <select className={field} value={chosen} onChange={(e) => setTask(e.target.value)}>
            {tasks.map((x) => <option key={x.slug} value={x.slug}>{t.locale === 'ru' ? x.title.ru : x.title.en}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('timeLimit')}</Label>
          <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={String(Math.round((tasks.find((x) => x.slug === chosen)?.time_limit_s ?? 0) / 60))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('tokenBudget')}</Label>
          <Input inputMode="numeric" value={budgetK} onChange={(e) => setBudgetK(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={String(Math.round((tasks.find((x) => x.slug === chosen)?.token_budget ?? 0) / 1000))} />
        </div>
        <Button onClick={() => void start()} disabled={busy || !chosen}><Play /> {busy ? t('starting') : t('start')}</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('defaults')}</p>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </div>
  )
}

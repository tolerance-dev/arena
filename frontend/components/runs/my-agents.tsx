'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Layers, Play, Upload } from 'lucide-react'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { loginHref } from '@/components/public/return-path'
import { Button } from '@/components/ui/button'
import { Input, fieldClass } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { del, post, put, upload } from '@/lib/api'
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Agent, Run, TaskSummary } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { ProviderOptions, providerLabel, RunTable, Score, usePoll, type RT } from './bits'

const field = fieldClass

// Any signed-in user uploads agents here and runs them; each user sees only their own agents and runs.
export function MyAgents() {
  const t = useT(runsMessages)
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const agents = usePoll<{ items: Agent[] }>(me ? '/my/agents' : null, 30_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const runs = usePoll<{ items: Run[] }>(me ? '/my/runs' : null, 4_000)

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-muted" />
  if (!me) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="display text-page">{t('myTitle')}</h1>
        <p className="text-muted-foreground">{t('signInLead')}</p>
        {signIn
          ? <Button onClick={signIn}>{t('signInButton')}</Button>
          : <Button render={<Link href={loginHref('/my')} />} nativeButton={false}>{t('signInButton')}</Button>}
      </div>
    )
  }
  const refresh = () => { void agents.reload(); void runs.reload() }
  return (
    <div className="space-y-12">
      <PageHeader title={t('myTitle')}>{t('myLead')}</PageHeader>
      <NewAgent t={t} onDone={refresh} subscriptions={!!me.subscriptions} />
      <section>
        <SectionTitle>{t('yourAgents')}</SectionTitle>
        {agents.data?.items.length === 0 && (
          <EmptyState>{t('noAgents')}</EmptyState>
        )}
        <div className="space-y-3">
          {agents.data?.items.map((a) => <AgentCard key={a.id} agent={a} tasks={tasks.data?.items ?? []} t={t} onChange={refresh} subscriptions={!!me.subscriptions} />)}
        </div>
      </section>
      <section>
        <SectionTitle>{t('yourRuns')}</SectionTitle>
        <RunTable runs={runs.data?.items ?? []} showTask />
      </section>
    </div>
  )
}

function NewAgent({ t, onDone, subscriptions }: { t: RT; onDone: () => void; subscriptions: boolean }) {
  const [provider, setProvider] = useState('anthropic')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    setErr('')
    try {
      await upload<Agent>('/my/agents', new FormData(form))
      form.reset()
      onDone()
    } catch (e) {
      setErr(errorText(e, t.locale))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-6 rounded-lg border border-border bg-card p-5 sm:p-7 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="heading text-title">{t('newAgent')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('newAgentHint')}</p>
      </div>
      <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
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
          <select id="provider" name="provider" className={field} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <ProviderOptions subscriptions={subscriptions} />
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api_key">{t('agentKey')}</Label>
          {provider === 'chatgpt-sub' ? (
            <textarea id="api_key" name="api_key" required rows={3} autoComplete="off" spellCheck={false} placeholder='{"auth_mode": "chatgpt", "tokens": {…}}'
              className={cn(field, 'h-auto py-2 font-mono text-xs')} />
          ) : (
            <Input id="api_key" name="api_key" type="password" required autoComplete="off" placeholder="sk-…" />
          )}
          <p className="text-xs text-muted-foreground">
            {provider === 'claude-sub' ? t('keyHintClaudeSub') : provider === 'chatgpt-sub' ? t('keyHintChatgptSub') : t('agentKeyHint')}
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bundle">{t('agentBundle')}</Label>
          <input id="bundle" name="bundle" type="file" required accept=".zip,.sh,application/zip,text/x-sh"
            className="block w-full rounded-md border border-input bg-card text-sm file:mr-3 file:h-8 file:border-0 file:border-r file:border-input file:bg-muted file:px-4 file:font-medium disabled:cursor-not-allowed disabled:opacity-50" />
          <p className="text-xs text-muted-foreground">{t('agentBundleHint')}</p>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}><Upload /> {busy ? t('uploading') : t('upload')}</Button>
          {err && <span className="text-sm text-destructive">{err}</span>}
        </div>
      </form>
    </section>
  )
}

function AgentCard({ agent, tasks, t, onChange, subscriptions }: { agent: Agent; tasks: TaskSummary[]; t: RT; onChange: () => void; subscriptions: boolean }) {
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
      const run = await post<Run>('/my/runs', {
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
  // One run per task with the tasks' default limits, so the agent shows up in every task's comparison.
  async function startAll() {
    setBusy(true)
    setErr('')
    try {
      for (const x of tasks) await post<Run>('/my/runs', { agent_id: agent.id, task: x.slug, time_limit_s: 0, token_budget: 0 })
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
      onChange()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!armed) return setArmed(true)
    try {
      await del(`/my/agents/${agent.id}`)
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
  }
  async function saveKey() {
    try {
      await put(`/my/agents/${agent.id}/key`, { provider, api_key: key })
      setKey('')
      setKeyOpen(false)
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="heading text-title">{agent.name}</h3>
            {agent.best_score != null && <span className="text-sm text-muted-foreground">{t('bestScore')} <Score score={agent.best_score} /></span>}
          </div>
          {agent.description && <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{providerLabel(agent.provider)}</span>
            {agent.key_hint && <span className="font-mono">{t('keyHint', { hint: agent.key_hint })}</span>}
            <span>{t.plural('runs', agent.runs)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setKeyOpen((v) => !v)}>{t('replaceKey')}</Button>
          <Button variant="destructive" size="sm" onClick={() => void remove()} onBlur={() => setArmed(false)}>{armed ? t('confirmAgain') : t('deleteAgent')}</Button>
        </div>
      </div>
      {keyOpen && (
        <div className="mt-4 flex flex-wrap gap-2">
          <select className={cn(field, 'w-44')} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <ProviderOptions subscriptions={subscriptions} />
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('defaults')}</p>
        <Button variant="outline" size="sm" onClick={() => void startAll()} disabled={busy || tasks.length === 0}>
          <Layers /> {t.plural('startAll', tasks.length)}
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </div>
  )
}

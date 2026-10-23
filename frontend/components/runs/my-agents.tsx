'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Layers, MoreHorizontal, Play, Plus, Upload } from 'lucide-react'
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
import { AgentAvatar, ProviderOptions, providerLabel, usePoll, type RT } from './bits'
import { LiveRuns } from './live-runs'

const field = fieldClass

// Any signed-in user uploads agents here and runs them; each user sees only their own agents and runs. What is
// running right now comes first, then the agents, each with its launch controls in one row.
export function MyAgents() {
  const t = useT(runsMessages)
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const agents = usePoll<{ items: Agent[] }>(me ? '/my/agents' : null, 30_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const runs = usePoll<{ items: Run[] }>(me ? '/my/runs' : null, 3_000)
  const [adding, setAdding] = useState<boolean | null>(null)

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
  const started = () => { refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const none = agents.data?.items.length === 0
  const showForm = adding ?? none
  return (
    <div className="space-y-12">
      <PageHeader title={t('myTitle')}>{t('myLead')}</PageHeader>
      {runs.data ? <LiveRuns runs={runs.data.items} t={t} /> : <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      <section>
        <SectionTitle aside={!showForm && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> {t('newAgent')}</Button>
        )}>{t('yourAgents')}</SectionTitle>
        {showForm && <NewAgent t={t} onDone={() => { setAdding(false); refresh() }} onCancel={none ? undefined : () => setAdding(false)} subscriptions={!!me.subscriptions} />}
        {none && !showForm && <EmptyState>{t('noAgents')}</EmptyState>}
        {!!agents.data?.items.length && (
          <ul className={cn('divide-y divide-border rounded-xl border-2 border-border', showForm && 'mt-6')}>
            {agents.data.items.map((a) => <li key={a.id}><AgentRow agent={a} tasks={tasks.data?.items ?? []} t={t} onChange={refresh} onStarted={started} subscriptions={!!me.subscriptions} /></li>)}
          </ul>
        )}
      </section>
    </div>
  )
}

function NewAgent({ t, onDone, onCancel, subscriptions }: { t: RT; onDone: () => void; onCancel?: () => void; subscriptions: boolean }) {
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
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>}
          {err && <span className="text-sm text-destructive">{err}</span>}
        </div>
      </form>
    </section>
  )
}

// One agent in one row: who it is, then a task and "Start". Limits, the key and deleting hide behind "⋯".
function AgentRow({ agent, tasks, t, onChange, onStarted, subscriptions }: {
  agent: Agent; tasks: TaskSummary[]; t: RT; onChange: () => void; onStarted: () => void; subscriptions: boolean
}) {
  const [task, setTask] = useState('')
  const [minutes, setMinutes] = useState('')
  const [budgetK, setBudgetK] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [armed, setArmed] = useState(false)
  const [more, setMore] = useState(false)
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<string>(agent.provider)
  const chosen = task || tasks[0]?.slug || ''
  const limits = { time_limit_s: minutes ? Math.round(Number(minutes) * 60) : 0, token_budget: budgetK ? Math.round(Number(budgetK) * 1000) : 0 }

  async function launch(slugs: string[]) {
    setBusy(true)
    setErr('')
    try {
      for (const slug of slugs) await post<Run>('/my/runs', { agent_id: agent.id, task: slug, ...limits })
      onStarted()
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
      onChange()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <AgentAvatar name={agent.name} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-semibold">{agent.name}</div>
            <div className="truncate text-meta text-muted-foreground">
              {providerLabel(agent.provider)}{agent.key_hint && <> · <span className="font-mono">{agent.key_hint}</span></>} · {t.plural('runs', agent.runs)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t('task')} className={cn(field, 'h-8 w-48 text-body')} value={chosen} onChange={(e) => setTask(e.target.value)}>
            {tasks.map((x) => <option key={x.slug} value={x.slug}>{t.locale === 'ru' ? x.title.ru : x.title.en}</option>)}
          </select>
          <Button size="sm" onClick={() => void launch([chosen])} disabled={busy || !chosen}><Play /> {busy ? t('starting') : t('start')}</Button>
          <Button size="sm" variant="outline" onClick={() => void launch(tasks.map((x) => x.slug))} disabled={busy || tasks.length === 0}
            title={t.plural('startAll', tasks.length)}><Layers /> {t('allTasks')}</Button>
          <Button size="icon" variant="ghost" aria-label={t('moreSettings')} aria-expanded={more} onClick={() => setMore((v) => !v)}><MoreHorizontal /></Button>
        </div>
      </div>
      {err && <p className="mt-2 text-body text-destructive">{err}</p>}
      {more && (
        <div className="mt-4 grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-2">
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
          <p className="-mt-2 text-meta text-muted-foreground sm:col-span-2">{t('defaults')}</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t('replaceKey')}</Label>
            <div className="flex flex-wrap gap-2">
              <select className={cn(field, 'w-48')} value={provider} onChange={(e) => setProvider(e.target.value)}>
                <ProviderOptions subscriptions={subscriptions} />
              </select>
              <Input type="password" className="min-w-0 flex-1" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
              <Button variant="outline" onClick={() => void saveKey()} disabled={key.length < 20}>{t('saveKey')}</Button>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Button variant="destructive" size="sm" onClick={() => void remove()} onBlur={() => setArmed(false)}>{armed ? t('confirmAgain') : t('deleteAgent')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

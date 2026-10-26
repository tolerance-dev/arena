'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Layers, MoreHorizontal, Play, Plus, Upload } from 'lucide-react'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { Button } from '@/components/ui/button'
import { Input, fieldClass } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { del, post, put, upload } from '@/lib/api'
import { errorText } from '@/lib/errors'
import type { Agent, ExampleAgent, ExampleModel, Run, TaskSummary } from '@/lib/types'
import { compact, plural, runEstimate, usd } from '@/lib/format'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { AgentAvatar, ProviderOptions, providerLabel, usePoll } from './bits'
import { LiveRuns } from './live-runs'

const field = fieldClass

// Any signed-in user uploads agents here and runs them; each user sees only their own agents and runs. What is
// running right now comes first, then the agents, each with its launch controls in one row.
export function MyAgents() {
  const { me, loading } = useMe()
  const router = useRouter()
  const agents = usePoll<{ items: Agent[] }>(me ? '/my/agents' : null, 30_000)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const runs = usePoll<{ items: Run[] }>(me ? '/my/runs' : null, 3_000)
  const [adding, setAdding] = useState<boolean | null>(null)
  // /my?task=<slug> (the task page's "Run your agent"): that task comes preselected in every agent's row.
  const [preset, setPreset] = useState('')
  useEffect(() => setPreset(new URLSearchParams(window.location.search).get('task') ?? ''), [])

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-muted" />
  const selectedTask = tasks.data?.items.find((task) => task.slug === preset)
  if (!me) {
    return (
      <div className="max-w-md space-y-5">
        <h1 className="display text-page">Запустить агента</h1>
        <p className="text-muted-foreground">Войдите, чтобы сохранить агента и запустить выбранное задание. API-ключ модели добавите на следующем шаге.</p>
        {selectedTask && <p className="text-body font-medium">Задание: {selectedTask.title}</p>}
        <SignInOptions next={preset ? `/my?task=${encodeURIComponent(preset)}` : '/my'} />
      </div>
    )
  }
  const refresh = () => { void agents.reload(); void runs.reload() }
  const started = () => { refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const none = agents.data?.items.length === 0
  const showForm = adding ?? none
  if (agents.error && !agents.data) return <EmptyState action={<Button variant="outline" onClick={() => void agents.reload()}>Попробовать ещё раз</Button>}>{errorText(agents.error)}</EmptyState>
  return (
    <div className="space-y-8">
      <PageHeader title={(none ? "Первый запуск" : "Мои агенты")}>{(none ? "Выберите задание, агента и модель. Добавьте свой API-ключ, чтобы получить приложение и результаты проверок." : "Загрузите агента с его ключом LLM, запустите на задачах и сравните с остальными. Что идёт прямо сейчас — наверху.")}</PageHeader>
      {runs.data ? !!runs.data.items.length && <LiveRuns runs={runs.data.items} /> : <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      <section>
        {!none && <SectionTitle aside={!showForm && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> Новый агент</Button>
        )}>Ваши агенты</SectionTitle>}
        {showForm && <NewAgent tasks={tasks.data?.items ?? []} preset={preset} onDone={() => { setAdding(false); refresh() }}
          onStarted={(run) => router.push(`/r/${run.id}`)} onCancel={none ? undefined : () => setAdding(false)} subscriptions={!!me.subscriptions} />}
        {none && !showForm && <EmptyState>Агентов пока нет. Загрузите первого выше.</EmptyState>}
        {!!agents.data?.items.length && (
          <ul className={cn('divide-y divide-border rounded-xl border-2 border-border', showForm && 'mt-6')}>
            {agents.data.items.map((a) => <li key={a.id}><AgentRow agent={a} tasks={tasks.data?.items ?? []} preset={preset} onChange={refresh} onStarted={started} subscriptions={!!me.subscriptions} /></li>)}
          </ul>
        )}
      </section>
      {!me.can_admin && <DeleteAccount />}
    </div>
  )
}

// Deleting the account takes everything with it (agents and their keys, runs, votes); two clicks, like an agent.
function DeleteAccount() {
  const [armed, setArmed] = useState(false)
  const [err, setErr] = useState('')
  const remove = async () => {
    if (!armed) return setArmed(true)
    try {
      await del('/me')
      window.location.assign('/')
    } catch (e) {
      setErr(errorText(e))
    }
  }
  return (
    <section className="max-w-[68ch]">
      <SectionTitle>Аккаунт</SectionTitle>
      <p className="text-body text-muted-foreground">Удаление аккаунта удаляет всех ваших агентов вместе с ключами, их прогоны и ваши голоса и выходит из аккаунта. Копии остаются в ежедневных бэкапах базы до 30 дней.</p>
      <Button className="mt-3" variant="destructive" size="sm" onClick={() => void remove()} onBlur={() => setArmed(false)}>
        {armed ? 'Нажмите ещё раз для подтверждения' : 'Удалить аккаунт'}
      </Button>
      {err && <p className="mt-2 text-body text-destructive">{err}</p>}
    </section>
  )
}

const EXAMPLES_URL = 'https://github.com/tolerance-dev/arena/tree/main/backend/internal/agents/examples'

function NewAgent({ tasks, preset, onDone, onStarted, onCancel, subscriptions }: {
  tasks: TaskSummary[]; preset: string; onDone: () => void; onStarted: (run: Run) => void; onCancel?: () => void; subscriptions: boolean
}) {
  const catalog = usePoll<{ items: ExampleAgent[]; models: ExampleModel[] }>('/agents/examples', 3_600_000)
  const examples = catalog.data?.items ?? []
  const [source, setSource] = useState<'example' | 'file'>('example')
  const [slug, setSlug] = useState('')
  const example = source === 'example' ? (examples.find((e) => e.slug === slug) ?? examples[0]) : undefined
  const usable = (p: string) => subscriptions || !p.endsWith('-sub')
  const models = (catalog.data?.models ?? []).filter((m) => example?.providers.some((p) => usable(p) && m.ids[p]))
  const [modelSlug, setModelSlug] = useState('')
  const model = models.find((m) => m.slug === modelSlug) ?? models.find((m) => m.slug === example?.model) ?? models[0]
  const [name, setName] = useState<string | null>(null)
  const [provider, setProvider] = useState('anthropic')
  const offered = example?.providers.filter((p) => usable(p) && (!model || model.ids[p]))
  const providerValue = offered && !offered.includes(provider) ? offered[0] : provider
  const defaultName = example && model ? `${example.name} · ${model.name.replace(' (free)', '')}` : ''
  const [task, setTask] = useState('')
  const chosen = tasks.find((x) => x.slug === task) ?? tasks.find((x) => x.slug === preset) ?? tasks[0]
  const [saved, setSaved] = useState<Agent | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const launch = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'save'
    setBusy(true)
    setErr('')
    try {
      // A queue failure must not make a retry upload the agent and key again.
      let agent = saved
      if (!agent) {
        const data = new FormData(form)
        if (example) data.set('example', example.slug)
        if (example && model) data.set('model', model.slug)
        if (example && !String(data.get('name') ?? '').trim()) data.set('name', defaultName)
        agent = await upload<Agent>('/my/agents', data)
        setSaved(agent)
        form.reset()
      }
      if (!launch) { onDone(); return }
      const run = await post<Run>('/my/runs', { agent_id: agent.id, task: chosen?.slug })
      onStarted(run)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-6 rounded-lg border border-border bg-card p-5 sm:p-7 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div className="hidden lg:block">
        <h2 className="heading text-title">Новый агент</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Ключ хранится зашифрованным и не попадает в песочницу: агент получает токен прогона, который принимает только наш шлюз.</p>
      </div>
      <form aria-label="Новый агент" onSubmit={submit} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="launch-task">Задание</Label>
          <select id="launch-task" className={field} value={chosen?.slug ?? ''} onChange={(e) => setTask(e.target.value)} disabled={busy || !tasks.length}>
            {tasks.map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
          </select>
          {chosen && <p className="text-body text-muted-foreground">{`${Math.round(chosen.time_limit_s / 60)} мин · ${compact(chosen.token_budget)} токенов`}</p>}
        </div>
        {saved ? <p role="status" className="text-body text-muted-foreground sm:col-span-2">{`Агент «${saved.name}» сохранён. Повторите запуск или вернитесь к своим агентам.`}</p> : (
          <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:col-span-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Segmented label="Откуда агент" value={source} onChange={setSource} options={[
                { value: 'example', label: "Готовый агент" }, { value: 'file', label: "Свой файл" },
              ]} />
              {source === 'example' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="example">Агент</Label>
                  <select id="example" className={field} value={example?.slug ?? ''} onChange={(e) => { setSlug(e.target.value); setModelSlug('') }}>
                    {examples.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}
                  </select>
                  <Label htmlFor="model" className="pt-2">Модель</Label>
                  <select id="model" className={field} value={model?.slug ?? ''} onChange={(e) => setModelSlug(e.target.value)}>
                    {models.map((m) => <option key={m.slug} value={m.slug}>{m.name}{m.slug === example?.model ? ' · родная' : ''}</option>)}
                  </select>
                  {example && model && <p className="text-xs text-muted-foreground">
                    {(model.slug === example.model ? `Ключи для этой пары: ${(offered ?? []).map(providerLabel).join(', ')}. Один ключ OrcaRouter запускает любого агента с любой моделью.` : `Ключи для этой пары: ${(offered ?? []).map(providerLabel).join(', ')}. Модель не из «родного» CLI ещё не проверена: прогон может упасть сразу.`)}{' '}
                    {model.price.in + model.price.out === 0 ? "Модель бесплатная." : `Цена: ${usd(model.price.in)} вход, ${usd(model.price.out)} выход за миллион токенов.`}
                  </p>}
                  {catalog.error && <div role="alert" className="space-y-2 text-body text-destructive">
                    <p>{errorText(catalog.error)}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void catalog.reload()}>Попробовать ещё раз</Button>
                  </div>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="bundle">Агент: run.sh или .zip с run.sh в корне</Label>
                  <input id="bundle" name="bundle" type="file" required accept=".zip,.sh,application/zip,text/x-sh"
                    className="block w-full rounded-md border border-input bg-card text-sm file:mr-3 file:h-8 file:border-0 file:border-r file:border-input file:bg-muted file:px-4 file:font-medium disabled:cursor-not-allowed disabled:opacity-50" />
                  <p className="text-xs text-muted-foreground">
                    Запускается как /agent/run.sh в /work, где лежат TASK.md и data/.{' '}
                    <a href={EXAMPLES_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2">
                      Примеры и окружение на GitHub <ExternalLink className="size-3" />
                    </a>
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider">Провайдер LLM</Label>
              <select id="provider" name="provider" className={field} value={providerValue} onChange={(e) => setProvider(e.target.value)}>
                <ProviderOptions subscriptions={subscriptions} only={offered} />
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api_key">API-ключ</Label>
              {providerValue === 'chatgpt-sub' ? (
                <textarea id="api_key" name="api_key" required rows={3} autoComplete="off" spellCheck={false} placeholder='{"auth_mode": "chatgpt", "tokens": {…}}'
                  className={cn(field, 'h-auto py-2 font-mono text-xs')} />
              ) : (
                <Input id="api_key" name="api_key" type="password" required autoComplete="off" placeholder="sk-…" />
              )}
              <p className="text-xs text-muted-foreground">
                {providerValue === 'claude-sub' ? "Ваша подписка Claude, только на этом локальном стенде: выполните `claude setup-token` и вставьте токен. Прогоны тратят лимиты подписки." : providerValue === 'chatgpt-sub' ? "Ваша подписка ChatGPT, только на этом локальном стенде: вставьте ~/.codex/auth.json от Codex, вошедшего через ChatGPT. Хранится только access-токен (живёт около недели; когда истечёт, вставьте свежий файл)." : "Тратится только этим агентом, через шлюз. Лучше отдельный ключ с лимитом трат."}{' '}
                <Link href="/privacy" className="font-medium text-foreground underline underline-offset-2">Как хранятся ключи</Link>
              </p>
            </div>
            <details key={source} open={source === 'file'} className="sm:col-span-2">
              <summary className="cursor-pointer text-body font-medium focus-visible:outline-2 focus-visible:outline-ring">Название и описание</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Название</Label>
                  <Input id="name" name="name" required={source === 'file'} minLength={2} maxLength={60} placeholder="Claude Code · Opus 5.5"
                    value={name ?? defaultName} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Описание (необязательно)</Label>
                  <Input id="description" name="description" maxLength={500} placeholder="Claude Code + Opus, промпт по умолчанию" />
                </div>
              </div>
            </details>
          </fieldset>
        )}
        {err && <p role="alert" className="text-body text-destructive sm:col-span-2">{err}</p>}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" value="launch" disabled={busy || !chosen || (!saved && source === 'example' && (!example || !model))}>
            <Play /> {busy ? "Запускаем…" : (saved ? "Запустить" : "Создать и запустить")}
          </Button>
          {saved ? <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>К моим агентам</Button> : (
            <Button type="submit" value="save" variant="ghost" disabled={busy || (source === 'example' && (!example || !model))}><Upload />Сохранить без запуска</Button>
          )}
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Отмена</Button>}
        </div>
      </form>
    </section>
  )
}

// One agent in one row: who it is, then a task and "Start". Limits, the key and deleting hide behind "⋯".
function AgentRow({ agent, tasks, preset, onChange, onStarted, subscriptions }: {
  agent: Agent; tasks: TaskSummary[]; preset: string; onChange: () => void; onStarted: () => void; subscriptions: boolean
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
  const chosen = task || (tasks.some((x) => x.slug === preset) ? preset : '') || tasks[0]?.slug || ''
  const limits = { time_limit_s: minutes ? Math.round(Number(minutes) * 60) : 0, token_budget: budgetK ? Math.round(Number(budgetK) * 1000) : 0 }
  // Quick time picks up to the task's limit; an empty field means the task's own.
  const picked = tasks.find((x) => x.slug === chosen)
  const taskMinutes = Math.round((picked?.time_limit_s ?? 0) / 60)
  const choices = [...new Set([5, 10, 15, 30, taskMinutes])].filter((m) => m > 0 && m <= taskMinutes).sort((a, b) => a - b)
  const runMinutes = minutes ? Number(minutes) : taskMinutes

  async function launch(slugs: string[]) {
    setBusy(true)
    setErr('')
    try {
      for (const slug of slugs) await post<Run>('/my/runs', { agent_id: agent.id, task: slug, ...limits })
      onStarted()
    } catch (e) {
      setErr(errorText(e))
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
      setErr(errorText(e))
    }
  }
  async function saveKey() {
    try {
      await put(`/my/agents/${agent.id}/key`, { provider, api_key: key })
      setKey('')
      onChange()
    } catch (e) {
      setErr(errorText(e))
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
              {providerLabel(agent.provider)}{agent.key_hint && <> · <span className="font-mono">{agent.key_hint}</span></>} · {plural(agent.runs, '{n} прогон', '{n} прогона', '{n} прогонов')}
              {agent.spent_usd != null && agent.runs > 0 && <> · {`потрачено ${usd(agent.spent_usd)}`}</>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Задание" className={cn(field, 'h-8 w-48 text-body')} value={chosen} onChange={(e) => setTask(e.target.value)}>
            {tasks.map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
          </select>
          <Button size="sm" onClick={() => void launch([chosen])} disabled={busy || !chosen}><Play /> {busy ? 'Запускаем…' : 'Запустить'}</Button>
          <Button size="sm" variant="outline" onClick={() => void launch(tasks.map((x) => x.slug))} disabled={busy || tasks.length === 0}
            title={plural(tasks.length, 'Запустить на задаче', 'Запустить на всех {n} задачах', 'Запустить на всех {n} задачах')}><Layers /> Все задачи</Button>
          <Button size="icon" variant="ghost" aria-label="Лимиты, ключ, удаление" aria-expanded={more} onClick={() => setMore((v) => !v)}><MoreHorizontal /></Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {choices.length > 1 && (
          <Segmented label="Время прогона" value={String(runMinutes)} onChange={(v) => setMinutes(v)}
            options={choices.map((m) => ({ value: String(m), label: `${m} мин` }))} />
        )}
        <CostEstimate agent={agent} minutes={runMinutes} budget={limits.token_budget || (picked?.token_budget ?? 0)} />
      </div>
      {err && <p className="mt-2 text-body text-destructive">{err}</p>}
      {more && (
        <div className="mt-4 grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Лимит времени, минут</Label>
            <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={String(Math.round((tasks.find((x) => x.slug === chosen)?.time_limit_s ?? 0) / 60))} />
          </div>
          <div className="space-y-1.5">
            <Label>Бюджет токенов, тысяч</Label>
            <Input inputMode="numeric" value={budgetK} onChange={(e) => setBudgetK(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={String(Math.round((tasks.find((x) => x.slug === chosen)?.token_budget ?? 0) / 1000))} />
          </div>
          <p className="-mt-2 text-meta text-muted-foreground sm:col-span-2">Пусто = значения задания</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Заменить ключ</Label>
            <div className="flex flex-wrap gap-2">
              <select className={cn(field, 'w-48')} value={provider} onChange={(e) => setProvider(e.target.value)}>
                <ProviderOptions subscriptions={subscriptions} />
              </select>
              <Input type="password" className="min-w-0 flex-1" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
              <Button variant="outline" onClick={() => void saveKey()} disabled={key.length < 20}>Сохранить</Button>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Button variant="destructive" size="sm" onClick={() => void remove()} onBlur={() => setArmed(false)}>{armed ? 'Нажмите ещё раз для подтверждения' : 'Удалить'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// What a run of this agent should cost for the picked time: the model's spending rate × minutes at its price.
function CostEstimate({ agent, minutes, budget }: { agent: Agent; minutes: number; budget: number }) {
  const note = (text: string) => <span className="text-meta text-muted-foreground">{text}</span>
  if (agent.provider.endsWith('-sub')) return <span className="cursor-help text-body font-semibold tnum" title="Подписка: прогоны тратят её лимиты, а не деньги">≈ $0</span>
  if (!agent.price) return agent.model ? null : note('Цена неизвестна (свой агент)')
  const p = agent.price
  if (p.in + p.out + p.cache_read + p.cache_write === 0) return <span className="cursor-help text-body font-semibold tnum" title="Бесплатно">≈ $0</span>
  if (!agent.rate) return note('Оценки пока нет')
  // One number: the picked time at the model's spending rate (cut where the budget runs out); details in the tooltip.
  const e = runEstimate(p, agent.rate, minutes, budget)
  const detail = [
    `${usd(e.perMin)} в минуту`,
    agent.rate.all_models ? `у этой модели прогонов ещё нет: по ${agent.rate.runs} прогонам всех моделей` : `по прогонам этой модели: ${agent.rate.runs}`,
    e.budgetMin != null && `бюджет токенов кончится на ~${Math.max(1, Math.round(e.budgetMin))} мин`,
  ].filter(Boolean).join(' · ')
  return <span className="cursor-help text-body font-semibold tnum" title={detail}>≈ {usd(e.total)}</span>
}

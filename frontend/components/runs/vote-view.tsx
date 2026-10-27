'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Equal, ExternalLink, Maximize2 } from 'lucide-react'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { PageHeader } from '@/components/page-header'
import { loginHref } from '@/components/public/return-path'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { PillTabs } from '@/components/ui/pill-tabs'
import { api, post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useT } from '@/lib/i18n-client'
import type { Contender, Pair, Reveal, TaskSummary, Winner } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, Scenarios } from './bits'


// A guest's pick waits here while they sign in (OAuth leaves the page); back on /vote it is sent and revealed.
const pendingKey = 'tolerance:pending-vote'

type Pending = { pair: Pair; winner: Winner; sent?: boolean }

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey)
    sessionStorage.removeItem(pendingKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// The blind pairwise vote: two agents' apps at one task, names hidden until the pick is in. /vote?task=<slug>
// starts on that task. Guests see the pairs too and sign in when they pick.
export function VoteView() {
  const t = useT()
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const [task, setTask] = useState<string | null>(null)
  const [pair, setPair] = useState<Pair | null | undefined>(undefined)
  const [picked, setPicked] = useState<{ winner: Winner; reveal: Reveal } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // undefined = not read yet. Kept in a ref so a re-run of the effect (React dev runs effects twice) neither sends the
  // pick again nor loads a new pair over its reveal.
  const pending = useRef<Pending | null | undefined>(undefined)

  useEffect(() => setTask(new URLSearchParams(window.location.search).get('task') ?? ''), [])

  const load = useCallback(async (slug: string) => {
    setPair(undefined); setPicked(null); setErr('')
    try {
      const r = await api<{ pair: Pair | null }>(`${me ? '/my/vote' : '/vote'}${slug ? `?task=${encodeURIComponent(slug)}` : ''}`)
      setPair(r.pair)
    } catch (e) {
      setPair(null); setErr(errorText(e, t))
    }
  }, [me, t])

  // Back from sign-in with a pick: send it on the same pair; if that fails (expired, own agent), go on to a new one.
  const sendPending = useCallback(async (p: Pending, slug: string) => {
    setPair(p.pair); setPicked(null); setBusy(true); setErr('')
    try {
      setPicked({ winner: p.winner, reveal: await post<Reveal>('/my/votes', { pair: p.pair.id, winner: p.winner }) })
    } catch (e) {
      await load(slug)
      setErr(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }, [load, t])

  useEffect(() => {
    if (loading || task == null) return
    if (me && pending.current === undefined) pending.current = readPending()
    const p = me ? pending.current : null
    if (!p) void load(task)
    else if (!p.sent) {
      p.sent = true
      void sendPending(p, task)
    }
  }, [loading, me, task, load, sendPending])

  const vote = useCallback(async (winner: Winner) => {
    if (!pair || picked || busy) return
    if (!me) {
      try { sessionStorage.setItem(pendingKey, JSON.stringify({ pair, winner })) } catch { /* the pick is lost: they pick again */ }
      if (signIn) signIn()
      else window.location.href = loginHref('/vote')
      return
    }
    setBusy(true); setErr('')
    try {
      setPicked({ winner, reveal: await post<Reveal>('/my/votes', { pair: pair.id, winner }) })
    } catch (e) {
      setErr(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }, [pair, picked, busy, me, signIn, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest('input, textarea, select')) return
      if (!picked && e.key === 'ArrowLeft') void vote('a')
      else if (!picked && e.key === 'ArrowRight') void vote('b')
      else if (!picked && e.key === 'ArrowDown') void vote('tie')
      else if (picked && e.key === 'Enter' && task != null) void load(task)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, vote, load, task])

  const choose = (slug: string) => {
    pending.current = null
    setTask(slug)
    const url = new URL(window.location.href)
    if (slug) url.searchParams.set('task', slug)
    else url.searchParams.delete('task')
    window.history.replaceState(null, '', url)
  }

  if (loading) return <Skeleton className="h-96" />

  return (
    <div>
      <PageHeader title={t('Какое приложение лучше?', 'Which app is better?')}>{t('Два агента сделали одно и то же задание. Их имена скрыты до голоса, а голоса складываются в рейтинг агентов в этом задании.', 'Two agents did the same task. Their names are hidden until you vote, and the votes add up to the agents’ rating in this task.')}</PageHeader>
      {tasks.data && task != null && (
        <PillTabs className="mt-6" value={task} onChange={choose} options={[
          { value: '', label: t('Любое задание', 'Any task') },
          ...tasks.data.items.map((x) => ({ value: x.slug, label: t.text(x.title) })),
        ]} />
      )}

      <div className="mt-6">
        {pair === undefined ? (
          <div className="grid gap-6 sm:grid-cols-2"><Skeleton className="aspect-[16/10]" /><Skeleton className="aspect-[16/10]" /></div>
        ) : pair === null ? (
          err ? <p className="text-body text-destructive">{err}</p> : <EmptyState>{t('Здесь пока нечего сравнивать. Для пары нужны готовые приложения двух агентов, не ваших, — или вы уже проголосовали за все пары.', 'Nothing to compare here yet. A pair needs finished apps from two agents that aren’t yours — or you’ve already voted on every pair.')}</EmptyState>
        ) : (
          <>
            {!task && <p className="mb-3 text-title font-semibold"><Link href={`/t/${pair.task}`} className="hover:text-primary">{t.text(pair.task_title)}</Link></p>}
            {pair.scenarios?.length ? (
              <section className="mb-6 rounded-xl border-2 border-border p-4">
                <h2 className="text-title font-semibold">{t('Попробуйте в обоих приложениях', 'Try this in both apps')}</h2>
                <p className="mt-0.5 text-body text-muted-foreground">{t('Откройте оба вживую и выберите то, которым вам удобнее пользоваться.', 'Open both live and pick the one you’d rather use.')}</p>
                <Scenarios items={pair.scenarios} className="mt-3" />
              </section>
            ) : null}
            <div className="grid gap-6 sm:grid-cols-2">
              <Side c={pair.a} side="A" agent={picked?.reveal.a} won={picked ? picked.winner === 'a' : undefined} />
              <Side c={pair.b} side="B" agent={picked?.reveal.b} won={picked ? picked.winner === 'b' : undefined} />
            </div>
            {/* The picks stay in reach at the bottom of the screen while the screenshots scroll. */}
            <div className="sticky bottom-4 z-10 mx-auto mt-6 flex w-fit flex-wrap items-center justify-center gap-2 rounded-full bg-background/90 p-1.5 shadow-[0_6px_16px_-6px_rgba(16,24,40,0.3)] backdrop-blur sm:gap-3">
              {picked ? (
                <Button size="lg" onClick={() => task != null && void load(task)}>{t('Следующая пара', 'Next pair')} <ArrowRight /></Button>
              ) : (
                <>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('a')}><ArrowLeft /> {t('A лучше', 'A is better')}</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('tie')}><Equal /> {t('Ничья', 'Tie')}</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('b')}>{t('B лучше', 'B is better')} <ArrowRight /></Button>
                </>
              )}
            </div>
            {err && <p className="mt-3 text-center text-body text-destructive">{err}</p>}
            {!me && !picked && <p className="mt-3 text-center text-body text-muted-foreground">{t('Голос засчитается после входа: один человек — один голос за пару. Имена агентов откроются сразу.', 'Your vote counts after you sign in: one person, one vote per pair. The agents’ names show right away.')}</p>}
            <p className="mt-4 text-center text-body text-muted-foreground">
              {(picked ? pair.left - 1 : pair.left) > 0 && <>{t.plural(picked ? pair.left - 1 : pair.left, ['В этом задании осталась {n} пара', 'В этом задании осталось {n} пары', 'В этом задании осталось {n} пар'], ['{n} pair left in this task', '{n} pairs left in this task'])}<span className="max-sm:hidden"> · </span></>}
              <span className="max-sm:hidden">{t('Клавиши: ← A, ↓ ничья, → B, Enter — дальше.', 'Keys: ← A, ↓ tie, → B, Enter — next.')}</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// One app of the pair: the desktop screenshot leads, the phone one beside it; after the vote, whose it was.
function Side({ c, side, agent, won }: { c: Contender; side: 'A' | 'B'; agent?: Reveal['a']; won?: boolean }) {
  const t = useT()
  const shot = `/api/v1/vote/${c.alias}/shot.jpg`
  const mobile = `/api/v1/vote/${c.alias}/shot-mobile.jpg`
  return (
    <article className={cn('rounded-xl border-2 p-3 transition-colors duration-300', won ? 'border-primary' : 'border-border')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title font-semibold">{t(`Приложение ${side}`, `App ${side}`)}</h2>
        {won && <span className="rounded-full bg-primary px-2.5 text-meta font-semibold leading-6 text-primary-foreground">{t('Ваш выбор', 'Your pick')}</span>}
      </div>
      <div className="mt-3 flex gap-3">
        {c.has_shot ? (
          <a href={shot} target="_blank" rel="noreferrer" className="block min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={t(`Скриншот приложения ${side}`, `Screenshot of app ${side}`)} className="aspect-[16/10] w-full bg-muted object-cover object-top" />
          </a>
        ) : <div className="flex aspect-[16/10] flex-1 items-center justify-center rounded-lg bg-muted text-ui text-faint">{t('Нет скриншота', 'No screenshot')}</div>}
        {c.has_shot_mobile && (
          <a href={mobile} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-lg border border-border max-sm:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mobile} alt={t(`Скриншот приложения ${side} на телефоне`, `Screenshot of app ${side} on a phone`)} className="aspect-[9/19] h-full max-h-56 w-auto bg-muted object-cover object-top" />
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.preview_url && (
          <Button variant="outline" size="sm" render={<a href={c.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> {t('Открыть вживую', 'Open live')}
          </Button>
        )}
        {c.has_shot && (
          <Button variant="ghost" size="sm" render={<a href={shot} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <Maximize2 /> {t('Скриншот целиком', 'Full screenshot')}
          </Button>
        )}
      </div>
      {agent && (
        <Link href={`/agents/${agent.id}`} className="mt-3 flex items-center gap-2.5 border-t border-border pt-3 transition-colors hover:text-primary">
          <AgentAvatar name={agent.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{agent.name}</span>
            <span className="block truncate text-body text-muted-foreground">{t(`автор ${agent.owner}`, `by ${agent.owner}`)}</span>
          </span>
        </Link>
      )}
    </article>
  )
}

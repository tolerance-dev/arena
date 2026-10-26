'use client'

import { plural } from '@/lib/format'
import { useCallback, useEffect, useState } from 'react'
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
import type { Contender, Pair, Reveal, TaskSummary, Winner } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { AgentAvatar, usePoll } from './bits'


// The blind pairwise vote: two agents' apps at one task, names hidden until the pick is in. /vote?task=<slug>
// starts on that task.
export function VoteView() {
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 60_000)
  const [task, setTask] = useState<string | null>(null)
  const [pair, setPair] = useState<Pair | null | undefined>(undefined)
  const [picked, setPicked] = useState<{ winner: Winner; reveal: Reveal } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => setTask(new URLSearchParams(window.location.search).get('task') ?? ''), [])

  const load = useCallback(async (slug: string) => {
    setPair(undefined); setPicked(null); setErr('')
    try {
      const r = await api<{ pair: Pair | null }>(`/my/vote${slug ? `?task=${encodeURIComponent(slug)}` : ''}`)
      setPair(r.pair)
    } catch (e) {
      setPair(null); setErr(errorText(e))
    }
  }, [])

  useEffect(() => {
    if (me && task != null) void load(task)
  }, [me, task, load])

  const vote = useCallback(async (winner: Winner) => {
    if (!pair || picked || busy) return
    setBusy(true); setErr('')
    try {
      setPicked({ winner, reveal: await post<Reveal>('/my/votes', { pair: pair.id, winner }) })
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [pair, picked, busy])

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
    setTask(slug)
    const url = new URL(window.location.href)
    if (slug) url.searchParams.set('task', slug)
    else url.searchParams.delete('task')
    window.history.replaceState(null, '', url)
  }

  if (loading) return <Skeleton className="h-96" />
  if (!me) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="display text-page">Какое приложение лучше?</h1>
        <p className="text-muted-foreground">Войдите, чтобы голосовать: один голос за пару от человека делает рейтинг честным.</p>
        {signIn
          ? <Button onClick={signIn}>Войти</Button>
          : <Button render={<Link href={loginHref('/vote')} />} nativeButton={false}>Войти</Button>}
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Какое приложение лучше?">Два агента сделали одно и то же задание. Их имена скрыты до голоса, а каждый голос двигает Elo агентов в этом задании.</PageHeader>
      {tasks.data && task != null && (
        <PillTabs className="mt-6" value={task} onChange={choose} options={[
          { value: '', label: 'Любое задание' },
          ...tasks.data.items.map((x) => ({ value: x.slug, label: x.title })),
        ]} />
      )}

      <div className="mt-6">
        {pair === undefined ? (
          <div className="grid gap-6 sm:grid-cols-2"><Skeleton className="aspect-[16/10]" /><Skeleton className="aspect-[16/10]" /></div>
        ) : pair === null ? (
          err ? <p className="text-body text-destructive">{err}</p> : <EmptyState>Здесь пока нечего сравнивать. Для пары нужны готовые приложения двух агентов, не ваших, — или вы уже проголосовали за все пары.</EmptyState>
        ) : (
          <>
            {!task && <p className="mb-3 text-title font-semibold"><Link href={`/t/${pair.task}`} className="hover:text-primary">{pair.task_title}</Link></p>}
            <div className="grid gap-6 sm:grid-cols-2">
              <Side c={pair.a} side="A" agent={picked?.reveal.a} won={picked ? picked.winner === 'a' : undefined} />
              <Side c={pair.b} side="B" agent={picked?.reveal.b} won={picked ? picked.winner === 'b' : undefined} />
            </div>
            {/* The picks stay in reach at the bottom of the screen while the screenshots scroll. */}
            <div className="sticky bottom-4 z-10 mx-auto mt-6 flex w-fit flex-wrap items-center justify-center gap-2 rounded-full bg-background/90 p-1.5 shadow-[0_6px_16px_-6px_rgba(16,24,40,0.3)] backdrop-blur sm:gap-3">
              {picked ? (
                <Button size="lg" onClick={() => task != null && void load(task)}>Следующая пара <ArrowRight /></Button>
              ) : (
                <>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('a')}><ArrowLeft /> A лучше</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('tie')}><Equal /> Ничья</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('b')}>B лучше <ArrowRight /></Button>
                </>
              )}
            </div>
            {err && <p className="mt-3 text-center text-body text-destructive">{err}</p>}
            <p className="mt-4 text-center text-body text-muted-foreground">
              {(picked ? pair.left - 1 : pair.left) > 0 && <>{plural(picked ? pair.left - 1 : pair.left, 'В этом задании осталась {n} пара', 'В этом задании осталось {n} пары', 'В этом задании осталось {n} пар')}<span className="max-sm:hidden"> · </span></>}
              <span className="max-sm:hidden">Клавиши: ← A, ↓ ничья, → B, Enter — дальше.</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// One app of the pair: the desktop screenshot leads, the phone one beside it; after the vote, whose it was.
function Side({ c, side, agent, won }: { c: Contender; side: 'A' | 'B'; agent?: Reveal['a']; won?: boolean }) {
  const shot = `/api/v1/my/vote/${c.alias}/shot.jpg`
  const mobile = `/api/v1/my/vote/${c.alias}/shot-mobile.jpg`
  return (
    <article className={cn('rounded-xl border-2 p-3 transition-colors duration-300', won ? 'border-primary' : 'border-border')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title font-semibold">{side === 'A' ? 'Приложение A' : 'Приложение B'}</h2>
        {won && <span className="rounded-full bg-primary px-2.5 text-meta font-semibold leading-6 text-primary-foreground">Ваш выбор</span>}
      </div>
      <div className="mt-3 flex gap-3">
        {c.has_shot ? (
          <a href={shot} target="_blank" rel="noreferrer" className="block min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={`Скриншот приложения ${side}`} className="aspect-[16/10] w-full bg-muted object-cover object-top" />
          </a>
        ) : <div className="flex aspect-[16/10] flex-1 items-center justify-center rounded-lg bg-muted text-ui text-faint">Нет скриншота</div>}
        {c.has_shot_mobile && (
          <a href={mobile} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-lg border border-border max-sm:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mobile} alt={`Скриншот приложения ${side} на телефоне`} className="aspect-[9/19] h-full max-h-56 w-auto bg-muted object-cover object-top" />
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.preview_url && (
          <Button variant="outline" size="sm" render={<a href={c.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> Открыть вживую
          </Button>
        )}
        {c.has_shot && (
          <Button variant="ghost" size="sm" render={<a href={shot} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <Maximize2 /> Скриншот целиком
          </Button>
        )}
      </div>
      {agent && (
        <Link href={`/agents/${agent.id}`} className="mt-3 flex items-center gap-2.5 border-t border-border pt-3 transition-colors hover:text-primary">
          <AgentAvatar name={agent.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{agent.name}</span>
            <span className="block truncate text-body text-muted-foreground">{`автор ${agent.owner}`}</span>
          </span>
        </Link>
      )}
    </article>
  )
}

'use client'

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
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { voteMessages } from '@/lib/i18n/messages/vote'
import type { Contender, Pair, Reveal, TaskSummary, Winner } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { AgentAvatar, usePoll } from './bits'

type VT = ReturnType<typeof useT<typeof voteMessages.en>>

// The blind pairwise vote: two agents' apps at one task, names hidden until the pick is in. /vote?task=<slug>
// starts on that task.
export function VoteView() {
  const t = useT(voteMessages)
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
      setPair(null); setErr(errorText(e, t.locale))
    }
  }, [t.locale])

  useEffect(() => {
    if (me && task != null) void load(task)
  }, [me, task, load])

  const vote = useCallback(async (winner: Winner) => {
    if (!pair || picked || busy) return
    setBusy(true); setErr('')
    try {
      setPicked({ winner, reveal: await post<Reveal>('/my/votes', { a: pair.a.id, b: pair.b.id, winner }) })
    } catch (e) {
      setErr(errorText(e, t.locale))
    } finally {
      setBusy(false)
    }
  }, [pair, picked, busy, t.locale])

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
        <h1 className="display text-page">{t('title')}</h1>
        <p className="text-muted-foreground">{t('signInLead')}</p>
        {signIn
          ? <Button onClick={signIn}>{t('signIn')}</Button>
          : <Button render={<Link href={loginHref('/vote')} />} nativeButton={false}>{t('signIn')}</Button>}
      </div>
    )
  }

  const title = (x: { title: { en: string; ru: string } }) => (t.locale === 'ru' ? x.title.ru : x.title.en)
  return (
    <div>
      <PageHeader title={t('title')}>{t('lead')}</PageHeader>
      {tasks.data && task != null && (
        <PillTabs className="mt-6" value={task} onChange={choose} options={[
          { value: '', label: t('anyTask') },
          ...tasks.data.items.map((x) => ({ value: x.slug, label: title(x) })),
        ]} />
      )}

      <div className="mt-6">
        {pair === undefined ? (
          <div className="grid gap-6 sm:grid-cols-2"><Skeleton className="aspect-[16/10]" /><Skeleton className="aspect-[16/10]" /></div>
        ) : pair === null ? (
          err ? <p className="text-body text-destructive">{err}</p> : <EmptyState>{t('none')}</EmptyState>
        ) : (
          <>
            {!task && <p className="mb-3 text-title font-semibold"><Link href={`/t/${pair.task}`} className="hover:text-primary">{title({ title: pair.task_title })}</Link></p>}
            <div className="grid gap-6 sm:grid-cols-2">
              <Side c={pair.a} side="A" t={t} agent={picked?.reveal.a} won={picked ? picked.winner === 'a' : undefined} />
              <Side c={pair.b} side="B" t={t} agent={picked?.reveal.b} won={picked ? picked.winner === 'b' : undefined} />
            </div>
            {/* The picks stay in reach at the bottom of the screen while the screenshots scroll. */}
            <div className="sticky bottom-4 z-10 mx-auto mt-6 flex w-fit flex-wrap items-center justify-center gap-2 rounded-full bg-background/90 p-1.5 shadow-[0_6px_16px_-6px_rgba(16,24,40,0.3)] backdrop-blur sm:gap-3">
              {picked ? (
                <Button size="lg" onClick={() => task != null && void load(task)}>{t('next')} <ArrowRight /></Button>
              ) : (
                <>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('a')}><ArrowLeft /> {t('aBetter')}</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('tie')}><Equal /> {t('tie')}</Button>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => void vote('b')}>{t('bBetter')} <ArrowRight /></Button>
                </>
              )}
            </div>
            {err && <p className="mt-3 text-center text-body text-destructive">{err}</p>}
            <p className="mt-4 text-center text-body text-muted-foreground">
              {(picked ? pair.left - 1 : pair.left) > 0 && <>{t.plural('left', picked ? pair.left - 1 : pair.left)}<span className="max-sm:hidden"> · </span></>}
              <span className="max-sm:hidden">{t('keys')}</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// One app of the pair: the desktop screenshot leads, the phone one beside it; after the vote, whose it was.
function Side({ c, side, t, agent, won }: { c: Contender; side: 'A' | 'B'; t: VT; agent?: Reveal['a']; won?: boolean }) {
  const shot = `/api/v1/runs/${c.id}/shot.jpg`
  return (
    <article className={cn('rounded-xl border-2 p-3 transition-colors duration-300', won ? 'border-primary' : 'border-border')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title font-semibold">{side === 'A' ? t('appA') : t('appB')}</h2>
        {won && <span className="rounded-full bg-primary px-2.5 text-meta font-semibold leading-6 text-primary-foreground">{t('winner')}</span>}
      </div>
      <div className="mt-3 flex gap-3">
        {c.has_shot ? (
          <a href={shot} target="_blank" rel="noreferrer" className="block min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={t('shotAlt', { side })} className="aspect-[16/10] w-full bg-muted object-cover object-top" />
          </a>
        ) : <div className="flex aspect-[16/10] flex-1 items-center justify-center rounded-lg bg-muted text-ui text-faint">{t('noShot')}</div>}
        {c.has_shot_mobile && (
          <a href={`/api/v1/runs/${c.id}/shot-mobile.jpg`} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-lg border border-border max-sm:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/runs/${c.id}/shot-mobile.jpg`} alt={t('mobileAlt', { side })} className="aspect-[9/19] h-full max-h-56 w-auto bg-muted object-cover object-top" />
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.preview_url && (
          <Button variant="outline" size="sm" render={<a href={c.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> {t('livePreview')}
          </Button>
        )}
        {c.has_shot && (
          <Button variant="ghost" size="sm" render={<a href={shot} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <Maximize2 /> {t('fullShot')}
          </Button>
        )}
      </div>
      {agent && (
        <Link href={`/agents/${agent.id}`} className="mt-3 flex items-center gap-2.5 border-t border-border pt-3 transition-colors hover:text-primary">
          <AgentAvatar name={agent.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{agent.name}</span>
            <span className="block truncate text-body text-muted-foreground">{t('by', { owner: agent.owner })}</span>
          </span>
        </Link>
      )}
    </article>
  )
}

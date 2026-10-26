'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, FileJson, Play, Scale } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Meta } from '@/components/ui/feed'
import { PillTabs } from '@/components/ui/pill-tabs'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskView as TV } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { AgentAvatar, CheckStrip, RunShot, RunTable, Score, Stack, TaskTile, usePoll, type RT } from './bits'
import { Compare } from './compare'

type Tab = 'compare' | 'submissions' | 'brief' | 'results'

// A challenge, laid out like a Product Hunt product page: header, pill tabs, and the challenge's facts in the aside.
// The first tab compares what the agents built, side by side.
export function TaskView({ slug }: { slug: string }) {
  const t = useT(runsMessages)
  const [tab, setTab] = useState<Tab>('compare')
  const { me } = useMe()
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  if (error?.status === 404) return <EmptyState>{t('taskMissing')}</EmptyState>
  if (!data) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
  const title = t.locale === 'ru' ? data.title.ru : data.title.en
  const bundle = `/api/v1/tasks/${encodeURIComponent(slug)}/bundle.zip`

  return (
    <div>
      <Breadcrumbs items={[{ label: t('challengesTitle'), href: '/' }, { label: title }]} />
      {/* No aside here: the comparison needs the page's whole width. The task's facts sit in the header, its checks
          and data next to the brief. */}
      <header className="mt-6 flex flex-wrap items-start gap-x-4 gap-y-4">
        <TaskTile slug={slug} size="lg" />
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="display text-page break-words">{title}</h1>
          <p className="text-subtitle text-muted-foreground">{t.locale === 'ru' ? data.tagline.ru : data.tagline.en}</p>
          <Meta className="mt-1" items={[
            t('minutes', { n: Math.round(data.time_limit_s / 60) }),
            t('tokensBudget', { n: compact(data.token_budget) }),
            t('noInternet'),
            t.plural('runs', data.runs),
            t.plural('agents', data.agents),
          ]} />
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
          {me && (
            <Button size="lg" render={<Link href={`/my?task=${encodeURIComponent(slug)}`} />} nativeButton={false}>
              <Play /> {t('runYourAgent')}
            </Button>
          )}
          {data.compare.length >= 2 && (
            <Button variant="outline" size="lg" render={<Link href={`/vote?task=${encodeURIComponent(slug)}`} />} nativeButton={false}>
              <Scale /> {t('voteOnTask')}
            </Button>
          )}
          <Button variant="outline" size="lg" render={<a href={bundle} />} nativeButton={false}>
            <Download /> {t('downloadBrief')}
          </Button>
        </div>
      </header>

      <PillTabs className="mt-6" value={tab} onChange={setTab} options={[
        { value: 'compare', label: t('tabCompare'), count: data.compare.length },
        { value: 'submissions', label: t('tabSubmissions'), count: data.compare.length },
        { value: 'brief', label: t('tabBrief') },
        { value: 'results', label: t('tabResults'), count: data.recent.length },
      ]} />

      <div className="mt-6">
        {tab === 'compare' && <Compare runs={data.compare} ratings={data.ratings} t={t} />}
        {tab === 'submissions' && (
          data.compare.length === 0 ? <EmptyState>{t('noRuns')}</EmptyState> : (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.compare.map((r, i) => <li key={r.id}><Submission run={r} place={i + 1} t={t} /></li>)}
            </ul>
          )
        )}
        {tab === 'brief' && (
          <Columns
            main={<div className="max-w-[72ch]"><Markdown>{data.brief}</Markdown></div>}
            aside={<>
              <AsideBlock title={t('checksListTitle')}>
                {data.checks.length ? (
                  <ol className="space-y-1.5 text-body">
                    {data.checks.map((c, i) => (
                      <li key={c} className="flex gap-2.5"><span className="w-5 shrink-0 text-right text-faint tnum">{i + 1}</span><span>{c}</span></li>
                    ))}
                  </ol>
                ) : <p className="text-body text-muted-foreground">{t('noChecksList')}</p>}
                <p className="mt-3 text-body text-muted-foreground">{t('plusJudge')}</p>
              </AsideBlock>
              {data.data_files.length > 0 && (
                <AsideBlock title={t('dataTitle')}>
                  <ul className="space-y-1.5">
                    {data.data_files.map((f) => (
                      <li key={f} className="flex min-w-0 items-center gap-2 font-mono text-ui"><FileJson className="size-4 shrink-0 text-faint" /><span className="truncate">{f}</span></li>
                    ))}
                  </ul>
                </AsideBlock>
              )}
            </>} />
        )}
        {tab === 'results' && (
          <div className="space-y-10">
            <section>
              <SectionTitle>{t('resultsTitle')}</SectionTitle>
              <RunTable runs={data.leaderboard} ranked />
            </section>
            <section>
              <SectionTitle>{t('allRuns')}</SectionTitle>
              <RunTable runs={data.recent} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// One agent's best run as a showcase card: the screenshot leads, then who built it, the score and the checks.
function Submission({ run, place, t }: { run: Run; place: number; t: RT }) {
  const passed = run.checks.filter((c) => c.passed).length
  return (
    <article className="group">
      <Link href={`/r/${run.id}`} className="relative block overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 hover:border-border-strong">
        <RunShot run={run} className="aspect-[16/10] w-full" />
        <span className="absolute top-3 left-3 flex h-7 min-w-7 items-center justify-center rounded-full bg-card px-2 text-body font-semibold tnum shadow-[0_1px_2px_rgba(16,24,40,0.12)]">{place}</span>
      </Link>
      <div className="mt-3 flex items-start gap-3">
        <AgentAvatar name={run.agent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <Link href={`/r/${run.id}`} className="block truncate text-title font-semibold transition-colors hover:text-primary">{run.agent.name}</Link>
          <div className="truncate text-body text-muted-foreground">{run.agent.owner}</div>
          <Stack run={run} className="block truncate text-ui text-faint" />
        </div>
        <Score score={run.score} className="text-section" />
      </div>
      {run.checks.length > 0 && (
        <div className="mt-2 flex items-center gap-2.5 text-body text-muted-foreground">
          <CheckStrip checks={run.checks} /><span className="tnum">{passed}/{run.checks.length}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {run.preview_url && (
          <Button variant="outline" size="sm" render={<a href={run.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> {t('livePreview')}
          </Button>
        )}
        <Button variant="outline" size="sm" render={<Link href={`/r/${run.id}`} />} nativeButton={false}>{t('details')}</Button>
      </div>
    </article>
  )
}

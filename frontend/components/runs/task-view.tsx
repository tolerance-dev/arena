'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, Clock, Coins, Download, ExternalLink, FileJson, Play } from 'lucide-react'
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
import { AgentAvatar, CheckStrip, RunShot, RunTable, Score, TaskTile, usePoll, type RT } from './bits'

type Tab = 'submissions' | 'brief' | 'results'

// A challenge, laid out like a Product Hunt product page: header, pill tabs, and the challenge's facts in the aside.
// The first tab is what the agents built.
export function TaskView({ slug }: { slug: string }) {
  const t = useT(runsMessages)
  const [tab, setTab] = useState<Tab>('submissions')
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  if (error?.status === 404) return <EmptyState>{t('taskMissing')}</EmptyState>
  if (!data) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
  const title = t.locale === 'ru' ? data.title.ru : data.title.en
  const bundle = `/api/v1/tasks/${encodeURIComponent(slug)}/bundle.zip`

  return (
    <div>
      <Breadcrumbs items={[{ label: t('challengesTitle'), href: '/' }, { label: title }]} />
      <Columns className="mt-6"
        main={
          <>
            <header className="flex items-start gap-4">
              <TaskTile slug={slug} size="lg" />
              <div className="min-w-0 flex-1">
                <h1 className="display text-page break-words">{title}</h1>
                <p className="text-subtitle text-muted-foreground">{t.locale === 'ru' ? data.tagline.ru : data.tagline.en}</p>
                <Meta className="mt-1" items={[
                  t('minutes', { n: Math.round(data.time_limit_s / 60) }),
                  `${compact(data.token_budget)} ${t('metricTokens').toLowerCase()}`,
                  t.plural('runs', data.runs),
                  t.plural('agents', data.agents),
                ]} />
              </div>
              <Button variant="outline" size="lg" className="shrink-0 max-md:hidden" render={<a href={bundle} />} nativeButton={false}>
                <Download /> {t('downloadBrief')}
              </Button>
            </header>

            <PillTabs className="mt-6" value={tab} onChange={setTab} options={[
              { value: 'submissions', label: t('tabSubmissions'), count: data.leaderboard.length },
              { value: 'brief', label: t('tabBrief') },
              { value: 'results', label: t('tabResults'), count: data.recent.length },
            ]} />

            <div className="mt-6">
              {tab === 'submissions' && (
                data.leaderboard.length === 0 ? <EmptyState>{t('noRuns')}</EmptyState> : (
                  <ul className="grid gap-6 sm:grid-cols-2">
                    {data.leaderboard.map((r, i) => <li key={r.id}><Submission run={r} place={i + 1} t={t} /></li>)}
                  </ul>
                )
              )}
              {tab === 'brief' && <div className="max-w-[72ch]"><Markdown>{data.brief}</Markdown></div>}
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
          </>
        }
        aside={
          <>
            <Button variant="outline" size="lg" className="w-full md:hidden" render={<a href={bundle} />} nativeButton={false}>
              <Download /> {t('downloadBrief')}
            </Button>
            <AsideBlock title={t('infoTitle')}>
              <ul className="space-y-2.5 text-title">
                <Info icon={<Clock />}>{t('factTime')}: {t('minutes', { n: Math.round(data.time_limit_s / 60) })}</Info>
                <Info icon={<Coins />}>{t('factBudget')}: {compact(data.token_budget)}</Info>
                <Info icon={<Play />}>{t.plural('runs', data.runs)}</Info>
                <Info icon={<Bot />}>{t.plural('agents', data.agents)}</Info>
              </ul>
            </AsideBlock>
            <AsideBlock title={t('checksListTitle')}>
              {data.checks.length ? (
                <ol className="space-y-1.5 text-body">
                  {data.checks.map((c, i) => (
                    <li key={c} className="flex gap-2.5"><span className="w-5 shrink-0 text-right text-faint tnum">{i + 1}</span><span>{c}</span></li>
                  ))}
                </ol>
              ) : <p className="text-body text-muted-foreground">{t('noChecksList')}</p>}
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
          </>
        }
      />
    </div>
  )
}

function Info({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <li className="flex items-center gap-2.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">{icon}<span className="min-w-0">{children}</span></li>
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

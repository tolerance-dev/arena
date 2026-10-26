'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, FileJson, Scale } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Meta } from '@/components/ui/feed'
import { PillTabs } from '@/components/ui/pill-tabs'
import { Segmented } from '@/components/ui/segmented'
import { compact, plural } from '@/lib/format'
import type { Run, TaskView as TV } from '@/lib/types'
import { AgentAvatar, CheckStrip, RunShot, RunTable, Score, Stack, TaskTile, usePoll } from './bits'
import { Compare } from './compare'
import { StartRunButton } from './start-run-button'

type Tab = 'brief' | 'solutions' | 'runs'

// Show the brief until there are solutions; keep the chosen tab while live data refreshes.
export function TaskView({ slug }: { slug: string }) {
  const [tab, setTab] = useState<{ slug: string; value: Tab } | null>(null)
  const [view, setView] = useState<'cards' | 'compare'>('cards')
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  useEffect(() => {
    if (data && tab?.slug !== slug) setTab({ slug, value: data.compare.length ? 'solutions' : 'brief' })
  }, [data, slug, tab])
  if (error?.status === 404) return <EmptyState>Такого задания нет.</EmptyState>
  if (!data) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
  const title = data.title
  const bundle = `/api/v1/tasks/${encodeURIComponent(slug)}/bundle.zip`
  const activeTab = tab?.slug === slug ? tab.value : data.compare.length ? 'solutions' : 'brief'
  const tabsId = `task-${slug}-tabs`
  const panelId = `task-${slug}-panel`

  return (
    <div>
      <Breadcrumbs items={[{ label: "Задачи", href: '/' }, { label: title }]} />
      {/* No aside here: the comparison needs the page's whole width. The task's facts sit in the header, its checks
          and data next to the brief. */}
      <header className="mt-6 flex flex-wrap items-start gap-x-4 gap-y-4">
        <TaskTile slug={slug} size="md" className="sm:size-16 sm:[&>svg]:size-9" />
        <div className="min-w-0 flex-1 sm:basis-72">
          <h1 className="display text-page break-words">{title}</h1>
          <p className="text-subtitle text-muted-foreground">{data.tagline}</p>
          <Meta className="mt-1" items={[
            `${Math.round(data.time_limit_s / 60)} мин`,
            `${compact(data.token_budget)} токенов`,
            "Без интернета",
            ...(data.runs ? [plural(data.runs, "{n} прогон", "{n} прогона", "{n} прогонов")] : []),
            ...(data.agents ? [plural(data.agents, "{n} агент", "{n} агента", "{n} агентов")] : []),
          ]} />
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
          <StartRunButton task={slug} />
          {data.compare.length >= 2 && (
            <Button variant="outline" size="lg" render={<Link href={`/vote?task=${encodeURIComponent(slug)}`} />} nativeButton={false}>
              <Scale /> Голосовать
            </Button>
          )}
          <Button variant="outline" size="lg" render={<a href={bundle} />} nativeButton={false}>
            <Download /> Скачать задание и данные
          </Button>
        </div>
      </header>

      <PillTabs id={tabsId} panelId={panelId} label={title} className="mt-6" value={activeTab} onChange={(value) => setTab({ slug, value })} options={[
        { value: 'brief', label: "Задание" },
        { value: 'solutions', label: "Решения", count: data.compare.length || undefined },
        { value: 'runs', label: "Прогоны", count: data.recent.length || undefined },
      ]} />

      <div id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}`} tabIndex={0} className="mt-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        {activeTab === 'solutions' && (
          data.compare.length === 0 ? <EmptyState action={<StartRunButton task={slug} />}>Станьте первым, кто построит приложение на этом задании.</EmptyState> : <>
            {data.compare.length > 1 && <div className="mb-5"><Segmented label="Вид решений" value={view} onChange={setView} options={[
              { value: 'cards', label: "Решения" }, { value: 'compare', label: "Сравнение" },
            ]} /></div>}
            {view === 'compare' && data.compare.length > 1 ? <Compare runs={data.compare} ratings={data.ratings} /> : (
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.compare.map((r, i) => <li key={r.id}><Submission run={r} place={i + 1} /></li>)}
              </ul>
            )}
          </>
        )}
        {activeTab === 'brief' && (
          <Columns
            main={<div className="max-w-[72ch]"><Markdown>{data.brief}</Markdown></div>}
            aside={<>
              <AsideBlock title="Автоматические проверки">
                {data.checks.length ? (
                  <details>
                    <summary className="cursor-pointer text-body font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">{`Показать все проверки: ${data.checks.length}`}</summary>
                    <ol className="mt-3 space-y-1.5 text-body">
                      {data.checks.map((c, i) => (
                        <li key={c} className="flex gap-2.5"><span className="w-5 shrink-0 text-right text-faint tnum">{i + 1}</span><span>{c}</span></li>
                      ))}
                    </ol>
                  </details>
                ) : <p className="text-body text-muted-foreground">Проверяются только запуск, главная страница и скриншоты.</p>}
                <p className="mt-3 text-body text-muted-foreground">Балл — доля пройденных проверок; приложения сравнивают люди в слепом голосовании. <Link href="/how" className="font-medium text-primary hover:underline">Как считаем</Link></p>
              </AsideBlock>
              {data.data_files.length > 0 && (
                <AsideBlock title="Мок-данные">
                  <ul className="space-y-1.5">
                    {data.data_files.map((f) => (
                      <li key={f} className="flex min-w-0 items-center gap-2 font-mono text-ui"><FileJson className="size-4 shrink-0 text-faint" /><span className="truncate">{f}</span></li>
                    ))}
                  </ul>
                </AsideBlock>
              )}
            </>} />
        )}
        {activeTab === 'runs' && (
          data.recent.length === 0 ? <EmptyState action={<StartRunButton task={slug} />}>Станьте первым, кто построит приложение на этом задании.</EmptyState> : (
            <section>
              <SectionTitle>Все прогоны</SectionTitle>
              <RunTable runs={data.recent} />
            </section>
          )
        )}
      </div>
    </div>
  )
}

// One agent's best run as a showcase card: the screenshot leads, then who built it, the score and the checks.
function Submission({ run, place }: { run: Run; place: number }) {
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
            <ExternalLink /> Живое превью
          </Button>
        )}
        <Button variant="outline" size="sm" render={<Link href={`/r/${run.id}`} />} nativeButton={false}>Подробнее</Button>
      </div>
    </article>
  )
}

'use client'

import Link from 'next/link'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { TaskView as TV } from '@/lib/types'
import { Score, usePoll } from './bits'

// A task is two things: what the agents were asked to build, and what each of them built.
export function TaskView({ slug }: { slug: string }) {
  const t = useT(runsMessages)
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  if (error?.status === 404) return <EmptyState>{t('taskMissing')}</EmptyState>
  if (!data) return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>
  const title = t.locale === 'ru' ? data.title.ru : data.title.en

  return (
    <div className="space-y-10">
      <header>
        <Breadcrumbs items={[{ label: t('tasksTitle'), href: '/' }, { label: title }]} />
        <h1 className="display mt-5 text-[24px] leading-[30px] break-words sm:text-page">{title}</h1>
      </header>

      <section className="max-w-3xl">
        <Markdown>{data.brief}</Markdown>
      </section>

      <section aria-labelledby="built-title">
        <SectionTitle id="built-title" count={data.leaderboard.length || undefined}>{t('builtTitle')}</SectionTitle>
        {data.leaderboard.length === 0 ? (
          <EmptyState>{t('noRuns')}</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.leaderboard.map((r) => (
              <li key={r.id}>
                <Link href={`/r/${r.id}`}
                  className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors duration-[120ms] hover:border-border-strong">
                  {r.has_shot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/v1/runs/${r.id}/shot.jpg`} alt={t('bestShotAlt', { agent: r.agent.name })} loading="lazy"
                      className="aspect-[16/10] w-full border-b border-border bg-muted object-cover object-top" />
                  ) : <div className="aspect-[16/10] w-full border-b border-border bg-muted" />}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-body font-medium">{r.agent.name}</div>
                      <div className="truncate text-meta text-faint">{r.agent.owner}</div>
                    </div>
                    <Score score={r.score} className="text-title" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

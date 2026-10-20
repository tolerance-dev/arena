'use client'

import Link from 'next/link'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { TaskView as TV } from '@/lib/types'
import { Score, usePoll } from './bits'

// A task is two things: what the agents were asked to build, and what each of them built.
export function TaskView({ slug }: { slug: string }) {
  const t = useT(runsMessages)
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  if (error?.status === 404) return <p className="text-muted-foreground">{t('taskMissing')}</p>
  if (!data) return <div className="h-96 animate-pulse rounded-lg bg-muted" />
  const title = t.locale === 'ru' ? data.title.ru : data.title.en

  return (
    <div className="space-y-12">
      <header>
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground hover:underline">{t('tasksTitle')}</Link>
        </nav>
        <h1 className="display text-[2.1rem] break-words sm:text-[2.75rem]">{title}</h1>
      </header>

      <section className="max-w-3xl">
        <Markdown>{data.brief}</Markdown>
      </section>

      <section aria-labelledby="built-title">
        <SectionTitle id="built-title">{t('builtTitle')}</SectionTitle>
        {data.leaderboard.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRuns')}</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.leaderboard.map((r) => (
              <Link key={r.id} href={`/r/${r.id}`} className="group block">
                {r.has_shot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/runs/${r.id}/shot.jpg`} alt={t('bestShotAlt', { agent: r.agent.name })} loading="lazy"
                    className="aspect-[16/10] w-full rounded-md border border-border bg-muted object-cover object-top" />
                ) : <div className="aspect-[16/10] w-full rounded-md border border-dashed border-border-strong" />}
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium group-hover:underline">{r.agent.name}</span>
                  <Score score={r.score} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

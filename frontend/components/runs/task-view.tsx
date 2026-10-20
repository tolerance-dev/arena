'use client'

import Link from 'next/link'
import { Download, FileJson } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { TaskView as TV } from '@/lib/types'
import { RunTable, usePoll } from './bits'
import { Fact } from './home-view'
import { TaskGlyph } from './task-glyph'

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
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-5">
            <TaskGlyph slug={slug} className="mt-1 size-14 max-sm:hidden" />
            <div className="min-w-0">
              <h1 className="display text-[2.1rem] break-words sm:text-[2.75rem]">{title}</h1>
              <p className="mt-2 max-w-[60ch] text-[1.05rem] leading-relaxed text-muted-foreground">{t.locale === 'ru' ? data.tagline.ru : data.tagline.en}</p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0" render={<a href={`/api/v1/tasks/${slug}/bundle.zip`} />} nativeButton={false}>
            <Download /> {t('downloadBundle')}
          </Button>
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-y-4 border-y border-border py-4 sm:grid-cols-5">
          <Fact label={t('factTime')} value={t('minutes', { n: Math.round(data.time_limit_s / 60) })} />
          <Fact label={t('factBudget')} value={compact(data.token_budget)} />
          <Fact label={t('factChecks')} value={String(data.checks.length)} />
          <Fact label={t('factRuns')} value={String(data.runs)} />
          <Fact label={t('factAgents')} value={String(data.agents)} />
        </dl>
      </header>

      <section aria-labelledby="board-title">
        <SectionTitle id="board-title" aside={t('leaderboardHint')}>{t('leaderboard')}</SectionTitle>
        <RunTable runs={data.leaderboard} ranked />
      </section>

      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <SectionTitle aside={t('briefHint')}>{t('theBrief')}</SectionTitle>
          <div className="rounded-lg border border-border bg-card px-5 py-6 sm:px-8 sm:py-8"><Markdown>{data.task_md}</Markdown></div>
        </div>
        <aside className="space-y-8 lg:sticky lg:top-6 lg:self-start">
          <div>
            <h3 className="heading">{t('autoChecks')}</h3>
            <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">{t('autoChecksHint')}</p>
            <ol className="space-y-1.5 text-sm">
              {data.checks.map((c, i) => (
                <li key={c} className="flex gap-3">
                  <span className="w-5 shrink-0 text-right text-muted-foreground tnum">{i + 1}</span>
                  <span>{c}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="heading mb-2">{t('dataFiles')}</h3>
            <ul className="space-y-1.5 text-sm">
              {data.data_files.map((f) => <li key={f} className="flex items-center gap-2 font-mono text-[0.82rem]"><FileJson className="size-4 text-muted-foreground" />{f}</li>)}
            </ul>
          </div>
        </aside>
      </section>

      <section aria-labelledby="all-title">
        <SectionTitle id="all-title">{t('allRuns')}</SectionTitle>
        <RunTable runs={data.recent} />
      </section>
    </div>
  )
}

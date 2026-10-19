'use client'

import { Download, FileJson } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { TaskView as TV } from '@/lib/types'
import { RunTable, TASK_ACCENT, usePoll } from './bits'

export function TaskView({ slug }: { slug: string }) {
  const t = useT(runsMessages)
  const { data, error } = usePoll<TV>(`/tasks/${encodeURIComponent(slug)}`, 8_000)
  if (error?.status === 404) return <p className="text-muted-foreground">404</p>
  if (!data) return <div className="h-96 animate-pulse rounded-2xl bg-muted" />
  const accent = TASK_ACCENT[slug] ?? 'var(--primary)'
  const title = t.locale === 'ru' ? data.title.ru : data.title.en

  return (
    <div className="space-y-12">
      <header className="relative overflow-hidden rounded-2xl p-6 text-white sm:p-10"
        style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in oklch, ${accent}, black 45%))` }}>
        <h1 className="poster text-[2.6rem] sm:text-[4rem]">{title}</h1>
        <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-white/85">{t.locale === 'ru' ? data.tagline.ru : data.tagline.en}</p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-white/85">
          <span>{t('limits', { min: Math.round(data.time_limit_s / 60), tokens: compact(data.token_budget) })}</span>
          <span>{t.plural('runs', data.runs)}</span>
          <span>{t.plural('agents', data.agents)}</span>
        </div>
      </header>

      <section>
        <SectionTitle aside={t('leaderboardHint')}>{t('leaderboard')}</SectionTitle>
        <RunTable runs={data.leaderboard} ranked />
      </section>

      <section>
        <SectionTitle>{t('allRuns')}</SectionTitle>
        <RunTable runs={data.recent} />
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <SectionTitle aside={t('briefHint')}>{t('theBrief')}</SectionTitle>
          <div className="rounded-xl border border-border bg-card p-5 sm:p-7"><Markdown>{data.task_md}</Markdown></div>
        </div>
        <aside className="space-y-8">
          <Button variant="outline" className="w-full" render={<a href={`/api/v1/tasks/${slug}/bundle.zip`} />} nativeButton={false}>
            <Download /> {t('downloadBundle')}
          </Button>
          <div>
            <h3 className="heading mb-2">{t('dataFiles')}</h3>
            <ul className="space-y-1.5 text-sm">
              {data.data_files.map((f) => <li key={f} className="flex items-center gap-2 font-mono"><FileJson className="size-4 text-muted-foreground" />{f}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="heading mb-1">{t('autoChecks')}</h3>
            <p className="mb-2 text-xs text-muted-foreground">{t('autoChecksHint')}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {data.checks.map((c) => <li key={c}>{c}</li>)}
            </ol>
          </div>
        </aside>
      </section>
    </div>
  )
}

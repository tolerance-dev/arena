'use client'

import Link from 'next/link'
import { ArrowRight, Gavel, ListChecks, ShieldCheck } from 'lucide-react'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary } from '@/lib/types'
import { RunTable, ScoreBadge, TASK_ACCENT, usePoll } from './bits'

export function HomeView() {
  const t = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=12', 8_000)

  const steps = [
    { icon: ShieldCheck, title: t('how1'), text: t('how1Text') },
    { icon: ListChecks, title: t('how2'), text: t('how2Text') },
    { icon: Gavel, title: t('how3'), text: t('how3Text') },
  ]

  return (
    <div className="space-y-14">
      <section className="max-w-3xl">
        <p className="mb-3 text-sm font-semibold text-muted-foreground">{t('homeKicker')}</p>
        <h1 className="display text-[2.4rem] sm:text-[3.4rem]">{t('homeTitle')}</h1>
        <p className="mt-4 text-[1.02rem] leading-relaxed text-muted-foreground">{t('homeLead')}</p>
      </section>

      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title" className="heading mb-4 text-xl">{t('tasksTitle')}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(tasks.data?.items ?? []).map((task) => <TaskCard key={task.slug} task={task} />)}
          {!tasks.data && [0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </section>

      <section aria-labelledby="how-title" className="rounded-2xl bg-terminal p-6 text-terminal-foreground sm:p-8">
        <h2 id="how-title" className="heading mb-5 text-lg">{t('howTitle')}</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-white/10 font-mono text-xs">{i + 1}</span>
                <s.icon className="size-4 text-terminal-accent" />
                <span className="font-bold">{s.title}</span>
              </div>
              <p className="text-sm leading-relaxed text-terminal-foreground/75">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className="heading mb-4 text-xl">{t('recentTitle')}</h2>
        {recent.data ? <RunTable runs={recent.data.items} showTask /> : <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      </section>
    </div>
  )
}

function TaskCard({ task }: { task: TaskSummary }) {
  const t = useT(runsMessages)
  const accent = TASK_ACCENT[task.slug] ?? 'var(--primary)'
  const title = t.locale === 'ru' ? task.title.ru : task.title.en
  const best = task.best
  return (
    <Link href={`/t/${task.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg">
      <div className="relative h-36 overflow-hidden" style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in oklch, ${accent}, black 35%))` }}>
        {best?.has_shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/v1/runs/${best.id}/shot.jpg`} alt="" className="absolute inset-x-6 top-6 w-[calc(100%-3rem)] rounded-t-lg shadow-2xl ring-1 ring-black/10 transition-transform group-hover:-translate-y-1" />
        )}
        {!best?.has_shot && <div className="poster absolute bottom-3 left-5 text-5xl text-white/25">{title}</div>}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="poster text-[1.45rem]">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.locale === 'ru' ? task.tagline.ru : task.tagline.en}</p>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-muted-foreground">
          <span>{t('limits', { min: Math.round(task.time_limit_s / 60), tokens: compact(task.token_budget) })}</span>
          <span>{t.plural('runs', task.runs)}</span>
          <span>{t.plural('agents', task.agents)}</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
          {best ? (
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <ScoreBadge score={best.score} />
              <span className="truncate font-semibold">{best.agent.name}</span>
            </span>
          ) : <span className="text-sm text-muted-foreground">{t('noRuns')}</span>}
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}

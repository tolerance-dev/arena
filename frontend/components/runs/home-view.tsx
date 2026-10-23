'use client'

import Link from 'next/link'
import { ArrowUpRight, Box, Building2, Clock3, Database, MonitorPlay, Shapes, ShoppingBag, Trophy } from 'lucide-react'
import { Skeleton } from '@/components/ui/empty-state'
import { Counter, Feed, FeedRow } from '@/components/ui/feed'
import { useT } from '@/lib/i18n/client'
import { intlLocale } from '@/lib/i18n/core'
import { homeMessages } from '@/lib/i18n/messages/home'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run, TaskSummary } from '@/lib/types'
import { AgentAvatar, Ago, scoreTone, StatusPill, taskTitle, usePoll, type RT } from './bits'
import styles from './home-view.module.css'

type HT = ReturnType<typeof useT<typeof homeMessages.en>>

const taskPresentation = {
  marketplace: { icon: ShoppingBag, description: 'marketplaceDescription' },
  hotels: { icon: Building2, description: 'hotelsDescription' },
  cinema: { icon: MonitorPlay, description: 'cinemaDescription' },
} as const

export function HomeView() {
  const t = useT(homeMessages)
  const rt = useT(runsMessages)
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const items = tasks.data?.items
  const first = items?.[0]
  const sharedTime = first && items?.every((task) => task.time_limit_s === first.time_limit_s) ? first.time_limit_s : null
  const sharedBudget = first && items?.every((task) => task.token_budget === first.token_budget) ? first.token_budget : null
  const hasRuns = Boolean(recent.data?.items.length)

  return (
    <div className={styles.home}>
      <section className={styles.intro} aria-labelledby="home-title">
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 id="home-title">{t('title')}</h1>
        <p className={styles.lead}>{t('leadFirst')}<br className="max-sm:hidden" /> {t('leadSecond')}</p>
        <details className={styles.how}>
          <summary>{t('howLink')}<ArrowUpRight size={18} aria-hidden /></summary>
          <ol aria-label={rt('howTitle')}>
            {(['how1', 'how2', 'how3'] as const).map((key, i) => (
              <li key={key}>
                <span className={styles.stepNumber} aria-hidden>{i + 1}</span>
                <div><h2>{rt(key)}</h2><p>{rt(`${key}Text`)}</p></div>
              </li>
            ))}
          </ol>
        </details>
      </section>

      <section className={styles.tasks} aria-labelledby="tasks-title" aria-busy={!items && !tasks.error}>
        <div className={styles.sectionHeading}>
          <h2 id="tasks-title">{t('tasksTitle')}{items && <span className={styles.count} aria-label={t('taskCount', { n: items.length })}>{String(items.length).padStart(2, '0')}</span>}</h2>
          {first && (
            <ul className={styles.limits} aria-label={t('conditions')}>
              {sharedTime != null && <li><Clock3 size={17} aria-hidden />{t('timePerTask', { n: t.plural('minutes', Math.round(sharedTime / 60)) })}</li>}
              {sharedBudget != null && <li><Database size={17} aria-hidden />{budgetLabel(sharedBudget, t)}</li>}
              <li><Box size={17} aria-hidden />{t('sandbox')}</li>
            </ul>
          )}
        </div>
        {items ? (
          items.length ? (
            <div className={styles.taskGrid}>
              {items.map((task, i) => <TaskCard key={task.slug} task={task} index={i + 1} t={t}
                showTime={sharedTime == null} showBudget={sharedBudget == null} />)}
            </div>
          ) : <p className={styles.notice}>{t('noTasks')}</p>
        ) : tasks.error ? (
          <p className={styles.notice} role="alert">{t('taskLoadError')} <button onClick={() => void tasks.reload()}>{t('retry')}</button></p>
        ) : <div className={styles.taskGrid}>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px] rounded-none" />)}</div>}
      </section>

      <section className={styles.results} aria-labelledby="results-title">
        <div className={styles.resultsHeading}>
          <h2 id="results-title">{t('resultsTitle')}</h2>
          {hasRuns ? <Link href="/leaderboard" className={styles.textLink}>{rt('viewLeaderboard')}<ArrowUpRight size={17} aria-hidden /></Link>
            : recent.error && !recent.data ? <p role="alert">{t('resultsLoadError')} <button className={styles.textLink} onClick={() => void recent.reload()}>{t('retry')}</button></p>
              : recent.data ? <p>{t('noResults')}</p> : <Skeleton className="h-5 w-64 max-w-full" />}
        </div>
        {hasRuns && <Feed className="mt-3">{recent.data!.items.map((run) => <RunRow key={run.id} run={run} t={rt} />)}</Feed>}
      </section>
    </div>
  )
}

function budgetLabel(budget: number, t: HT) {
  const n = new Intl.NumberFormat(intlLocale(t.locale), { notation: 'compact', maximumFractionDigits: 1 }).format(budget)
  return t('tokens', { n })
}

function TaskCard({ task, index, t, showTime, showBudget }: { task: TaskSummary; index: number; t: HT; showTime: boolean; showBudget: boolean }) {
  const presentation = taskPresentation[task.slug as keyof typeof taskPresentation]
  const Icon = presentation?.icon ?? Shapes
  return (
    <Link href={`/t/${encodeURIComponent(task.slug)}`} className={styles.taskCard}>
      <div className={styles.taskIdentity}>
        <span className={styles.taskIcon}><Icon size={32} strokeWidth={1.65} aria-hidden /></span>
        <div className="min-w-0"><span className={styles.taskIndex} aria-hidden>{String(index).padStart(2, '0')}</span>
          <h3>{t.locale === 'ru' ? task.title.ru : task.title.en}</h3>
        </div>
      </div>
      <p className={styles.taskDescription}>{presentation ? t(presentation.description) : t.locale === 'ru' ? task.tagline.ru : task.tagline.en}</p>
      {(showTime || showBudget) && <p className={styles.taskLimits}>
        {[showTime && t.plural('minutes', Math.round(task.time_limit_s / 60)), showBudget && budgetLabel(task.token_budget, t)].filter(Boolean).join(' · ')}
      </p>}
      <span className={styles.taskAction}>{t('openTask')}<ArrowUpRight size={18} aria-hidden /></span>
    </Link>
  )
}

function RunRow({ run, t }: { run: Run; t: RT }) {
  const done = run.status === 'done'
  return (
    <FeedRow href={`/r/${run.id}`} thumb={<AgentAvatar name={run.agent.name} />}
      title={run.agent.name}
      meta={[
        taskTitle(run.task, t.locale),
        done ? t('by', { owner: run.agent.owner }) : <StatusPill key="s" run={run} />,
        run.checks.length ? `${run.checks.filter((c) => c.passed).length}/${run.checks.length} ${t('colChecks').toLowerCase()}` : null,
        <Ago key="a" iso={run.created_at} />,
      ].filter(Boolean)}
      counters={<Counter icon={<Trophy />} value={done && run.score != null ? run.score : '—'} label={t('score')}
        className={done && run.score != null ? scoreTone(run.score) : 'text-faint'} />}
    />
  )
}

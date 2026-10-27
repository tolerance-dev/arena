'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Feed, Meta } from '@/components/ui/feed'
import { Button } from '@/components/ui/button'
import { RECENT_RUNS } from '@/lib/api'
import { compact, usd } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import { isVoted, type Run, type TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, KindPill, RunShot, Score, TaskTile } from './bits'
import { RunRow } from './run-row'
import { rankAgents } from './standings'


// The front page in the site's one frame: the tasks as cards with their best solution, the latest runs as a feed,
// and in the aside a line with the conditions every agent works under and the top three agents.
// initialTasks and initialRuns come from the server render, so the numbers are in the HTML.
export function HomeView({ initialTasks, initialRuns }: { initialTasks?: { items: TaskSummary[] } | null; initialRuns?: { items: Run[] } | null }) {
  const t = useT()
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000, undefined, initialTasks)
  const recent = usePoll<{ items: Run[] }>(RECENT_RUNS, 8_000, undefined, initialRuns)
  const items = tasks.data?.items

  return (
    <Columns
      main={
        <div className="space-y-10">
          <section aria-labelledby="home-title">
            <h1 id="home-title" className="display text-page sm:text-[32px] sm:leading-10">{t('Разные агенты. Равные условия.', 'Different agents. Equal conditions.')}</h1>
            <p className="mt-1 max-w-[62ch] text-title text-muted-foreground">{t('Каждый агент получает одно задание, одни данные, время и бюджет токенов и в одиночку пишет целое приложение. Откройте задание, чтобы сравнить, что построил каждый.', 'Every agent gets the same task, the same data, time and token budget, and writes a whole app on its own. Open a task to compare what each one built.')}</p>
            {items ? <Showcase tasks={items} /> : !tasks.error && <Skeleton className="mt-6 h-72" />}
          </section>

          <section aria-labelledby="tasks-title" aria-busy={!items && !tasks.error}>
            <SectionTitle id="tasks-title" count={items?.length}>{t('Задания', 'Tasks')}</SectionTitle>
            {items ? (
              items.length ? (
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((task) => <li key={task.slug}><TaskCard task={task} /></li>)}
                </ul>
              ) : <EmptyState>{t('Заданий пока нет.', 'No tasks yet.')}</EmptyState>
            ) : tasks.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void tasks.reload()}>{t('Попробовать ещё раз', 'Try again')}</Button>}>{t('Не удалось загрузить задания.', 'Couldn’t load the tasks.')}</EmptyState>
            ) : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>}
          </section>

          <section aria-labelledby="results-title">
            <SectionTitle id="results-title" aside={recent.data?.items.length ? <Link href="/leaderboard" className="transition-colors hover:text-primary">{t('Весь лидерборд', 'Full leaderboard')}</Link> : undefined}>
              {t('Последние прогоны', 'Latest runs')}
            </SectionTitle>
            {recent.data ? (
              recent.data.items.length
                ? <Feed>{recent.data.items.map((run) => <RunRow key={run.id} run={run} />)}</Feed>
                : <EmptyState>{t('Прогонов пока нет. Они появятся здесь, как только стартует первый агент.', 'No runs yet. They’ll show up here as soon as the first agent starts.')}</EmptyState>
            ) : recent.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void recent.reload()}>{t('Попробовать ещё раз', 'Try again')}</Button>}>{t('Не удалось загрузить прогоны.', 'Couldn’t load the runs.')}</EmptyState>
            ) : <Skeleton className="h-64" />}
          </section>
        </div>
      }
      aside={<>
        <Conditions tasks={items} />
        <TopAgents tasks={items} />
      </>}
    />
  )
}

// The task to show first: the one with the freshest result among its ranked runs, out of tasks where at least two
// agents finished.
function showcase(tasks: TaskSummary[]): TaskSummary | null {
  const last = (t: TaskSummary) => Math.max(...t.leaderboard.map((r) => Date.parse(r.finished_at ?? r.created_at)))
  return tasks.filter((t) => !isVoted(t.kind) && t.leaderboard.length >= 2).sort((a, b) => last(b) - last(a))[0] ?? null
}

// The headline shown, not told: one task, the same limits, the top three apps side by side with score and price.
function Showcase({ tasks }: { tasks: TaskSummary[] }) {
  const t = useT()
  const task = showcase(tasks)
  if (!task) return null
  const href = `/t/${encodeURIComponent(task.slug)}`
  const minutes = Math.round(task.time_limit_s / 60)
  const budget = compact(task.token_budget).replace(/\.0+(?=[Mk])/, '')
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={href} className="inline-flex items-center gap-2 text-title font-semibold transition-colors hover:text-primary">
          <TaskTile slug={task.slug} size="sm" />{t.text(task.title)}
        </Link>
        <span className="text-body text-muted-foreground">{t(`${minutes} мин и ${budget} токенов у каждого`, `${minutes} min and ${budget} tokens each`)}</span>
        <Link href={href} className="ml-auto inline-flex items-center gap-0.5 text-body font-medium text-primary hover:underline">
          {t.plural(task.agents, ['Сравнить {n} агента', 'Сравнить {n} агентов', 'Сравнить {n} агентов'], ['Compare {n} agent', 'Compare {n} agents'])}<ChevronRight className="size-3.5" />
        </Link>
      </div>
      <ol className="-mx-4 mt-3 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
        {task.leaderboard.slice(0, 3).map((run, i) => (
          <li key={run.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
            <Link href={`/r/${run.id}`} className="group block">
              <div className="relative overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 group-hover:border-border-strong">
                <RunShot run={run} className="aspect-[4/3] w-full" />
                <span className="absolute top-2 left-2 flex size-6 items-center justify-center rounded-full bg-card text-meta font-semibold tnum shadow-sm">{i + 1}</span>
              </div>
              <div className="mt-3 flex items-start gap-2">
                <AgentAvatar name={run.agent.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold transition-colors group-hover:text-primary">{run.agent.name}</span>
                  <span className="block truncate text-meta text-muted-foreground">{run.agent.model_name ?? run.agent.model ?? run.agent.owner}</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span><Score score={run.score} className="text-section" /><span className="text-meta text-faint"> / 100</span></span>
                <span className="text-body font-semibold tnum" title={t('По прайсу модели', 'At the model’s list price')}>{usd(run.cost_usd)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

// A task with its best solution so far; it opens on the comparison of every agent's median run.
function TaskCard({ task }: { task: TaskSummary }) {
  const t = useT()
  const title = t.text(task.title)
  const best = task.best
  return (
    <Link href={`/t/${encodeURIComponent(task.slug)}`} className="group block">
      <div className="overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 group-hover:border-border-strong">
        {best?.has_shot ? <RunShot run={best} className="aspect-[16/10] w-full" /> : (
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-muted px-4 text-center text-ui text-faint">
            <TaskTile slug={task.slug} size="sm" className="bg-card" />
            {t('Решений пока нет', 'No submissions yet')}
          </div>
        )}
      </div>
      <h3 className="mt-3 text-title font-semibold transition-colors group-hover:text-primary">{title} <KindPill kind={task.kind} /></h3>
      <p className="line-clamp-2 text-body text-muted-foreground">{t.text(task.tagline)}</p>
      <Meta className="mt-1" items={[t.plural(task.agents, ['{n} агент', '{n} агента', '{n} агентов'], ['{n} agent', '{n} agents']), t.plural(task.runs, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])]} />
      {/* A voted task's best run by score means nothing: every app that starts gets 100. */}
      {best && !isVoted(task.kind) && (
        <div className="mt-2 flex items-center gap-2 text-body">
          <AgentAvatar name={best.agent.name} size="xs" />
          <span className="min-w-0 flex-1 truncate"><span className="text-faint">{t('Лучший: ', 'Best: ')}</span>{best.agent.name}</span>
          <Score score={best.score} />
        </div>
      )}
    </Link>
  )
}

// What every agent works under, in one line: the limits from the task list (the largest, when tasks differ).
function Conditions({ tasks }: { tasks: TaskSummary[] | undefined }) {
  const t = useT()
  if (!tasks?.length) return null
  const same = tasks.every((x) => x.time_limit_s === tasks[0].time_limit_s && x.token_budget === tasks[0].token_budget)
  const minutes = Math.round(Math.max(...tasks.map((x) => x.time_limit_s)) / 60)
  const budget = compact(Math.max(...tasks.map((x) => x.token_budget))).replace(/\.0+(?=[Mk])/, '')
  const upTo = same ? '' : t('до ', 'up to ')
  return (
    <p className="text-body text-muted-foreground" title={t('Время и бюджет токенов на задание, одинаковые для всех агентов', 'Time and token budget per task, the same for every agent')}>
      {upTo}{minutes} {t('мин', 'min')} · {upTo}{budget} {t('токенов', 'tokens')} · <Link href="/how" className="font-medium whitespace-nowrap text-primary hover:underline">{t('Как считаем', 'How we score')}</Link>
    </p>
  )
}

// The leaderboard's first three: the average of each agent's best score over all tasks.
function TopAgents({ tasks }: { tasks: TaskSummary[] | undefined }) {
  const t = useT()
  const top = tasks ? rankAgents(tasks).slice(0, 3) : null
  return (
    <AsideBlock title={t('Лучшие агенты', 'Top agents')} action={top?.length ? <Link href="/leaderboard" className="inline-flex items-center gap-0.5 transition-colors hover:text-primary">{t('Все', 'All')}<ChevronRight className="size-3.5" /></Link> : undefined}>
      {!top ? <Skeleton className="h-36" /> : top.length ? (
        <ol className="-mx-2">
          {top.map((a) => (
            <li key={a.id}>
              <Link href={`/agents/${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary">
                <span className="w-4 text-right text-body text-faint tnum">{a.rank}</span>
                <AgentAvatar name={a.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{a.name}</span>
                  <span className="block truncate text-meta text-muted-foreground">{a.owner}</span>
                </span>
                <Score score={a.average} className="text-title" />
              </Link>
            </li>
          ))}
        </ol>
      ) : <p className="text-body text-muted-foreground">{t('Завершённых прогонов пока нет.', 'No finished runs yet.')}</p>}
    </AsideBlock>
  )
}

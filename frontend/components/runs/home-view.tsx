'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Feed, Meta } from '@/components/ui/feed'
import { Button } from '@/components/ui/button'
import { compact, plural } from '@/lib/format'
import type { Run, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar, RunShot, Score, TaskTile } from './bits'
import { RunRow } from './run-row'
import { rankAgents } from './standings'


// The front page in the site's one frame: the tasks as cards with their best solution, the latest runs as a feed,
// and in the aside a line with the conditions every agent works under and the top three agents.
export function HomeView() {
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000)
  const recent = usePoll<{ items: Run[] }>('/runs?limit=10', 8_000)
  const items = tasks.data?.items

  return (
    <Columns
      main={
        <div className="space-y-10">
          <section aria-labelledby="home-title">
            <h1 id="home-title" className="display text-page sm:text-[32px] sm:leading-10">Разные агенты. Равные условия.</h1>
            <p className="mt-1 max-w-[62ch] text-title text-muted-foreground">Каждый агент получает одно задание, одни данные, время и бюджет токенов и в одиночку пишет целое приложение. Откройте задание, чтобы сравнить, что построил каждый.</p>
          </section>

          <section aria-labelledby="tasks-title" aria-busy={!items && !tasks.error}>
            <SectionTitle id="tasks-title" count={items?.length}>Задания</SectionTitle>
            {items ? (
              items.length ? (
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((task) => <li key={task.slug}><TaskCard task={task} /></li>)}
                </ul>
              ) : <EmptyState>Заданий пока нет.</EmptyState>
            ) : tasks.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void tasks.reload()}>Попробовать ещё раз</Button>}>Не удалось загрузить задания.</EmptyState>
            ) : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>}
          </section>

          <section aria-labelledby="results-title">
            <SectionTitle id="results-title" aside={recent.data?.items.length ? <Link href="/leaderboard" className="transition-colors hover:text-primary">Весь лидерборд</Link> : undefined}>
              Последние прогоны
            </SectionTitle>
            {recent.data ? (
              recent.data.items.length
                ? <Feed>{recent.data.items.map((run) => <RunRow key={run.id} run={run} />)}</Feed>
                : <EmptyState>Прогонов пока нет. Они появятся здесь, как только стартует первый агент.</EmptyState>
            ) : recent.error ? (
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => void recent.reload()}>Попробовать ещё раз</Button>}>Не удалось загрузить прогоны.</EmptyState>
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

// A task with its best solution so far; it opens on the comparison of every agent's best run.
function TaskCard({ task }: { task: TaskSummary }) {
  const title = task.title
  const best = task.best
  return (
    <Link href={`/t/${encodeURIComponent(task.slug)}`} className="group block">
      <div className="overflow-hidden rounded-xl border-2 border-border transition-colors duration-300 group-hover:border-border-strong">
        {best?.has_shot ? <RunShot run={best} className="aspect-[16/10] w-full" /> : (
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-muted px-4 text-center text-ui text-faint">
            <TaskTile slug={task.slug} size="sm" className="bg-card" />
            Решений пока нет
          </div>
        )}
      </div>
      <h3 className="mt-3 text-title font-semibold transition-colors group-hover:text-primary">{title}</h3>
      <p className="line-clamp-2 text-body text-muted-foreground">{task.tagline}</p>
      <Meta className="mt-1" items={[plural(task.agents, '{n} агент', '{n} агента', '{n} агентов'), plural(task.runs, '{n} прогон', '{n} прогона', '{n} прогонов')]} />
      {best && (
        <div className="mt-2 flex items-center gap-2 text-body">
          <AgentAvatar name={best.agent.name} size="xs" />
          <span className="min-w-0 flex-1 truncate"><span className="text-faint">Лучший: </span>{best.agent.name}</span>
          <Score score={best.score} />
        </div>
      )}
    </Link>
  )
}

// What every agent works under, in one line: the limits from the task list (the largest, when tasks differ).
function Conditions({ tasks }: { tasks: TaskSummary[] | undefined }) {
  if (!tasks?.length) return null
  const same = tasks.every((x) => x.time_limit_s === tasks[0].time_limit_s && x.token_budget === tasks[0].token_budget)
  const minutes = Math.round(Math.max(...tasks.map((x) => x.time_limit_s)) / 60)
  const budget = compact(Math.max(...tasks.map((x) => x.token_budget))).replace(/\.0+(?=[Mk])/, '')
  const upTo = same ? '' : 'до '
  return (
    <p className="text-body text-muted-foreground" title="Время и бюджет токенов на задание, одинаковые для всех агентов">
      {upTo}{minutes} мин · {upTo}{budget} токенов · <Link href="/how" className="font-medium whitespace-nowrap text-primary hover:underline">Как считаем</Link>
    </p>
  )
}

// The leaderboard's first three: the average of each agent's best score over all tasks.
function TopAgents({ tasks }: { tasks: TaskSummary[] | undefined }) {
  const top = tasks ? rankAgents(tasks).slice(0, 3) : null
  return (
    <AsideBlock title="Лучшие агенты" action={top?.length ? <Link href="/leaderboard" className="inline-flex items-center gap-0.5 transition-colors hover:text-primary">Все<ChevronRight className="size-3.5" /></Link> : undefined}>
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
      ) : <p className="text-body text-muted-foreground">Завершённых прогонов пока нет.</p>}
    </AsideBlock>
  )
}

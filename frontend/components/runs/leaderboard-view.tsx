'use client'

import Link from 'next/link'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { Skeleton } from '@/components/ui/empty-state'
import { Meta } from '@/components/ui/feed'
import { useT } from '@/lib/i18n-client'
import type { Agent, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar } from './bits'
import { CostChart } from './cost-chart'
import { rankAgents, scoredTasks, StandingsTable } from './standings'

// Every agent against every task, ranked by the average best score; agents with no score yet are listed in the aside.
// initialTasks and initialAgents come from the server render, so the table is in the HTML.
export function LeaderboardView({ initialTasks, initialAgents }: { initialTasks?: { items: TaskSummary[] } | null; initialAgents?: { items: Agent[] } | null }) {
  const t = useT()
  const tasks = usePoll<{ items: TaskSummary[] }>('/tasks', 15_000, undefined, initialTasks)
  const agents = usePoll<{ items: Agent[] }>('/agents', 30_000, undefined, initialAgents)
  const rows = tasks.data ? rankAgents(tasks.data.items) : null
  const ranked = new Set(rows?.map((r) => r.id))
  const unranked = rows && agents.data ? agents.data.items.filter((a) => !ranked.has(a.id)) : []
  const list = tasks.data ? scoredTasks(tasks.data.items) : undefined
  // The newest finished run that counts in the table.
  const updated = list?.flatMap((x) => x.leaderboard.map((r) => r.finished_at ?? '')).sort().at(-1) || null
  return (
    <Columns
      main={
        <section aria-labelledby="board-title">
          <h1 id="board-title" className="display text-[20px] leading-[30px] sm:text-page">{t('Лидерборд', 'Leaderboard')}</h1>
          <p className="mt-1 max-w-[70ch] text-title text-muted-foreground">
            {t('Агенты получают одно и то же ТЗ и с нуля пишут приложение. Оценка — сколько процентов автоматических проверок прошло их приложение.',
              'Agents get the same brief and build the app from scratch. The score is the share of automatic checks their app passed.')}
          </p>
          {list && rows && (
            <Meta className="mt-2" items={[
              t.plural(rows.length, ['{n} агент в рейтинге', '{n} агента в рейтинге', '{n} агентов в рейтинге'], ['{n} agent ranked', '{n} agents ranked']),
              t.plural(list.length, ['{n} задача', '{n} задачи', '{n} задач'], ['{n} task', '{n} tasks']),
              t.plural(list.reduce((s, x) => s + x.runs, 0), ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs']),
              updated && t(`обновлён ${t.date(updated, DAY)}`, `updated ${t.date(updated, DAY)}`),
            ]} />
          )}
          <div className="mt-6">
            {list && rows ? <StandingsTable tasks={list} rows={rows} /> : <Skeleton className="h-64" />}
          </div>
          {rows && <CostChart rows={rows} />}
        </section>
      }
      aside={
        <>
          <AsideBlock title={t('Как читать', 'How to read it')}>
            <dl className="space-y-3 text-body">
              <div>
                <dt className="font-semibold">{t('Оценка', 'Score')}</dt>
                <dd className="text-muted-foreground">{t('Лучший прогон агента в каждой задаче, среднее по всем задачам. Не решал задачу — она идёт как 0. Задачи «Изобрести» и «Стартап» сюда не входят: их решают голоса людей.', 'The agent’s best run at each task, averaged over every task. A task it didn’t do counts as 0. Invent and startup tasks aren’t in it: people’s votes rank those.')}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('Цвет', 'Colour')}</dt>
                <dd className="mt-1 space-y-1 text-muted-foreground">
                  <Legend className="bg-success">{t('75 и выше — почти всё работает', '75 and up: almost everything works')}</Legend>
                  <Legend className="bg-warning">{t('45–74 — работает наполовину', '45–74: half of it works')}</Legend>
                  <Legend className="bg-destructive">{t('ниже 45 — в основном не работает', 'under 45: mostly broken')}</Legend>
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('Цена и время', 'Cost and time')}</dt>
                <dd className="text-muted-foreground">{t('В среднем на один лучший прогон, по прейскуранту модели.', 'Per best run on average, at the model’s list price.')}</dd>
              </div>
            </dl>
            <p className="mt-3 text-body text-muted-foreground">
              {t('Нажмите на оценку в задаче, чтобы открыть прогон, а на заголовок колонки — чтобы отсортировать.', 'Click a task score to open the run, a column header to sort.')}{' '}
              <Link href="/how" className="font-medium text-primary hover:underline">{t('Как считаем', 'How we score')}</Link>
            </p>
          </AsideBlock>
          {unranked.length > 0 && (
            <AsideBlock title={t('Ещё без оценки', 'Not scored yet')} action={unranked.length}>
              <ul className="-mx-2">
                {unranked.map((a) => (
                  <li key={a.id}>
                    <Link href={`/agents/${a.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-body font-medium transition-colors hover:bg-secondary">
                      <AgentAvatar name={a.name} size="xs" /><span className="truncate">{a.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </AsideBlock>
          )}
        </>
      }
    />
  )
}

// UTC, so the server's and the browser's render agree.
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' }

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span aria-hidden className={`size-2.5 shrink-0 rounded-full ${className}`} />{children}</div>
}

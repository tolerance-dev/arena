'use client'

import Link from 'next/link'
import { Bot, CalendarDays, LayoutGrid, Play } from 'lucide-react'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { Skeleton } from '@/components/ui/empty-state'
import { useT } from '@/lib/i18n-client'
import type { Agent, TaskSummary } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { AgentAvatar } from './bits'
import { CostChart } from './cost-chart'
import { rankAgents, ScoreChip, scoredTasks, StandingsTable } from './standings'

// Every agent against every task, ranked by the average median score; agents with no score yet are listed in the aside.
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
          <p className="mt-1 text-title text-muted-foreground">{t('Одно ТЗ, разные агенты. Оценка — % пройденных проверок.', 'One brief, many agents. The score is the % of checks passed.')}</p>
          {list && rows && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {updated && <Stat icon={CalendarDays}>{t(`обновлён ${t.date(updated, DAY)}`, `updated ${t.date(updated, DAY)}`)}</Stat>}
              <Stat icon={Bot}>{t.plural(rows.length, ['{n} агент', '{n} агента', '{n} агентов'], ['{n} agent', '{n} agents'])}</Stat>
              <Stat icon={LayoutGrid}>{t.plural(list.length, ['{n} задача', '{n} задачи', '{n} задач'], ['{n} task', '{n} tasks'])}</Stat>
              <Stat icon={Play}>{t.plural(list.reduce((s, x) => s + x.runs, 0), ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}</Stat>
            </ul>
          )}
          <div className="mt-6">
            {list && rows ? <StandingsTable tasks={list} rows={rows} /> : <Skeleton className="h-64" />}
          </div>
          {rows && <CostChart rows={rows} />}
        </section>
      }
      aside={
        <>
          <AsideBlock title={t('Как читать', 'How to read it')} action={<Link href="/how" className="transition-colors hover:text-primary">{t('Как считаем', 'How we score')}</Link>}>
            <ul className="space-y-2 text-body">
              <Legend chip={<ScoreChip score={100} className="h-7 w-10 text-ui" />}>{t('почти всё работает', 'almost all works')}</Legend>
              <Legend chip={<ScoreChip score={60} className="h-7 w-10 text-ui" />}>{t('работает наполовину', 'half works')}</Legend>
              <Legend chip={<ScoreChip score={20} className="h-7 w-10 text-ui" />}>{t('в основном не работает', 'mostly broken')}</Legend>
              <Legend chip={<span className="inline-flex h-7 w-10 items-center justify-center rounded-lg border border-dashed border-border-strong text-ui text-faint">—</span>}>{t('не решал, считается за 0', 'not done, counts as 0')}</Legend>
            </ul>
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

function Legend({ chip, children }: { chip: React.ReactNode; children: React.ReactNode }) {
  return <li className="flex items-center gap-3 text-muted-foreground">{chip}<span>{children}</span></li>
}

function Stat({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <li className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-ui text-muted-foreground">
      <Icon className="size-3.5 text-faint" />{children}
    </li>
  )
}

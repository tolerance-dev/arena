import type { Metadata } from 'next'
import { LeaderboardView } from '@/components/runs/leaderboard-view'
import { serverApi } from '@/lib/server-api'
import type { Agent, TaskSummary } from '@/lib/types'

export const metadata: Metadata = { title: 'Лидерборд' }

// Rendered per request with the table in the HTML; the browser polls on.
export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const [tasks, agents] = await Promise.all([
    serverApi<{ items: TaskSummary[] }>('/tasks', { fresh: true }),
    serverApi<{ items: Agent[] }>('/agents', { fresh: true }),
  ])
  return <LeaderboardView initialTasks={tasks} initialAgents={agents} />
}

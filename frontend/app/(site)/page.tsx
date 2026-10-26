import { HomeView } from '@/components/runs/home-view'
import { RECENT_RUNS } from '@/lib/api'
import { serverApi } from '@/lib/server-api'
import type { Run, TaskSummary } from '@/lib/types'

// Rendered per request with the numbers in the HTML (search engines, link previews, slow JS); the browser polls on.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [tasks, runs] = await Promise.all([
    serverApi<{ items: TaskSummary[] }>('/tasks', { fresh: true }),
    serverApi<{ items: Run[] }>(RECENT_RUNS, { fresh: true }),
  ])
  return <HomeView initialTasks={tasks} initialRuns={runs} />
}

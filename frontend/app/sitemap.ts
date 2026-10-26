import type { MetadataRoute } from 'next'
import { serverApi, SITE_URL } from '@/lib/server-api'
import type { Agent, TaskSummary } from '@/lib/types'

// The public pages: the lists, every task and every agent. Runs are left out: there are many, and each is
// reachable from its task and agent.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [tasks, agents] = await Promise.all([
    serverApi<{ items: TaskSummary[] }>('/tasks'),
    serverApi<{ items: Agent[] }>('/agents'),
  ])
  const pages: MetadataRoute.Sitemap = ['', '/leaderboard', '/agents', '/how', '/privacy', '/terms'].map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: 'hourly' }))
  for (const t of tasks?.items ?? []) pages.push({ url: `${SITE_URL}/t/${t.slug}`, changeFrequency: 'hourly' })
  for (const a of agents?.items ?? []) pages.push({ url: `${SITE_URL}/agents/${a.id}`, lastModified: a.created_at, changeFrequency: 'daily' })
  return pages
}

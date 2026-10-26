import type { Metadata } from 'next'
import { TaskView } from '@/components/runs/task-view'
import { getT } from '@/lib/i18n-server'
import { serverApi } from '@/lib/server-api'
import type { TaskSummary } from '@/lib/types'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const task = await serverApi<TaskSummary>(`/tasks/${encodeURIComponent(slug)}`)
  if (!task) return {}
  const t = await getT()
  return { title: t.text(task.title), description: t.text(task.tagline) }
}

export default async function TaskPage({ params }: Props) {
  const { slug } = await params
  return <TaskView slug={slug} />
}

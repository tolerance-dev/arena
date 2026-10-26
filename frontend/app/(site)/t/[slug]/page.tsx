import type { Metadata } from 'next'
import { TaskView } from '@/components/runs/task-view'
import { serverApi } from '@/lib/server-api'
import type { TaskSummary } from '@/lib/types'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const task = await serverApi<TaskSummary>(`/tasks/${encodeURIComponent(slug)}`)
  if (!task) return {}
  return { title: task.title, description: task.tagline }
}

export default async function TaskPage({ params }: Props) {
  const { slug } = await params
  return <TaskView slug={slug} />
}

import type { Metadata } from 'next'
import { TaskView } from '@/components/runs/task-view'
import { serverApi } from '@/lib/server-api'
import { getLocale } from '@/lib/i18n/server'
import type { TaskSummary } from '@/lib/types'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const [task, locale] = await Promise.all([serverApi<TaskSummary>(`/tasks/${encodeURIComponent(slug)}`), getLocale()])
  if (!task) return {}
  return { title: task.title[locale], description: task.tagline[locale] }
}

export default async function TaskPage({ params }: Props) {
  const { slug } = await params
  return <TaskView slug={slug} />
}

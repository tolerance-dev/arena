import type { Metadata } from 'next'
import { RunView } from '@/components/runs/run-view'
import { serverApi } from '@/lib/server-api'
import type { Run } from '@/lib/types'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const run = await serverApi<Run>(`/runs/${encodeURIComponent(id)}`)
  if (!run) return {}
  return {
    title: `${run.agent.name} · ${run.task}${run.score != null ? ` · ${run.score}` : ''}`,
    openGraph: run.has_shot ? { images: [`/api/v1/runs/${run.id}/shot.jpg`] } : undefined,
  }
}

export default async function RunPage({ params }: Props) {
  const { id } = await params
  return <RunView id={id} />
}

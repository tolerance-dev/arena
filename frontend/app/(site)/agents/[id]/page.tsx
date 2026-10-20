import type { Metadata } from 'next'
import { AgentView } from '@/components/runs/agents-view'
import { serverApi } from '@/lib/server-api'
import type { Agent } from '@/lib/types'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const agent = await serverApi<Agent>(`/agents/${encodeURIComponent(id)}`)
  return agent ? { title: agent.name, description: agent.description || undefined } : {}
}

export default async function AgentPage({ params }: Props) {
  const { id } = await params
  return <AgentView id={id} />
}

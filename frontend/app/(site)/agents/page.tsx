import type { Metadata } from 'next'
import { AgentsView } from '@/components/runs/agents-view'

export const metadata: Metadata = { title: 'Агенты' }

export default function AgentsPage() {
  return <AgentsView />
}

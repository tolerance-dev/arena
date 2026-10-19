import type { Metadata } from 'next'
import { AgentsAdmin } from '@/components/runs/agents-admin'

export const metadata: Metadata = { title: 'Agents', robots: { index: false } }

export default function AdminPage() {
  return <AgentsAdmin />
}

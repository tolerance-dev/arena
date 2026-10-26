import type { Metadata } from 'next'
import { MyAgents } from '@/components/runs/my-agents'

export const metadata: Metadata = { title: 'Мои агенты', robots: { index: false } }

export default function MyAgentsPage() {
  return <MyAgents />
}

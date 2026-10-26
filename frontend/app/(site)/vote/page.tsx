import type { Metadata } from 'next'
import { VoteView } from '@/components/runs/vote-view'

export const metadata: Metadata = { title: 'Vote', robots: { index: false } }

export default function VotePage() {
  return <VoteView />
}

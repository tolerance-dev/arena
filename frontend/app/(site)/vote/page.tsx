import type { Metadata } from 'next'
import { VoteView } from '@/components/runs/vote-view'

export const metadata: Metadata = { title: 'Голосование', robots: { index: false } }

export default function VotePage() {
  return <VoteView />
}

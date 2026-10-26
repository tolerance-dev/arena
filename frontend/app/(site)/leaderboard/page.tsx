import type { Metadata } from 'next'
import { LeaderboardView } from '@/components/runs/leaderboard-view'

export const metadata: Metadata = { title: 'Лидерборд' }

export default function LeaderboardPage() {
  return <LeaderboardView />
}

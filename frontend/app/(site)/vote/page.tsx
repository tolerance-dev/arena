import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import { VoteView } from '@/components/runs/vote-view'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('Голосование', 'Vote'), robots: { index: false } }
}

export default function VotePage() {
  return <VoteView />
}

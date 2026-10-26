import type { Metadata } from 'next'
import { WatchView } from '@/components/runs/watch-view'
import { getT } from '@/lib/i18n-server'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('Агенты строят', 'Agents building') }
}

type Props = { searchParams: Promise<{ runs?: string }> }

// Runs side by side, each building live: /watch?runs=<id>,<id>.
export default async function WatchPage({ searchParams }: Props) {
  const { runs } = await searchParams
  const ids = (runs ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2)
  return <WatchView ids={ids} />
}

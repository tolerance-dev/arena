import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import { MyAgents } from '@/components/runs/my-agents'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('Мои агенты', 'My agents'), robots: { index: false } }
}

export default function MyAgentsPage() {
  return <MyAgents />
}

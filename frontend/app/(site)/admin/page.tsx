import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import { AdminView } from '@/components/admin/admin-view'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('Админка', 'Admin'), robots: { index: false } }
}

export default function AdminPage() {
  return <AdminView />
}

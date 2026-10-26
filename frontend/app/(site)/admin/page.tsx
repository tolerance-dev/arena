import type { Metadata } from 'next'
import { AdminView } from '@/components/admin/admin-view'

export const metadata: Metadata = { title: 'Админка', robots: { index: false } }

export default function AdminPage() {
  return <AdminView />
}

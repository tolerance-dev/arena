import type { Metadata } from 'next'
import { Markdown } from '@/components/markdown'
import { PageHeader } from '@/components/page-header'
import { getT } from '@/lib/i18n/server'
import { legalMessages } from '@/lib/i18n/messages/legal'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(legalMessages)
  return { title: t('privacyTitle') }
}

export default async function Page() {
  const t = await getT(legalMessages)
  return (
    <div className="space-y-8">
      <PageHeader title={t('privacyTitle')}>{t('updated')}</PageHeader>
      <Markdown>{t('privacyBody')}</Markdown>
    </div>
  )
}

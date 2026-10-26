import type { Metadata } from 'next'
import Link from 'next/link'
import { Markdown } from '@/components/markdown'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { compact } from '@/lib/format'
import { getT } from '@/lib/i18n/server'
import { howMessages } from '@/lib/i18n/messages/how'
import { serverApi } from '@/lib/server-api'
import type { TaskSummary } from '@/lib/types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(howMessages)
  return { title: t('title'), description: t('lead') }
}

export default async function Page() {
  const [t, tasks] = await Promise.all([getT(howMessages), serverApi<{ items: TaskSummary[] }>('/tasks')])
  const items = tasks?.items ?? []
  return (
    <div className="space-y-8">
      <PageHeader title={t('title')}>{t('lead')}</PageHeader>
      <Markdown>{t('body')}</Markdown>
      <section className="max-w-[75ch]">
        <SectionTitle>{t('tasksTitle')}</SectionTitle>
        {items.length === 0 ? <EmptyState>{t('noTasks')}</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border-2 border-border">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-muted-foreground">
                  <th className="h-11 px-4 font-medium">{t('colTask')}</th>
                  <th className="h-11 px-3 text-right font-medium">{t('colChecks')}</th>
                  <th className="h-11 px-3 text-right font-medium">{t('colTime')}</th>
                  <th className="h-11 px-4 text-right font-medium">{t('colBudget')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.slug} className="border-b border-border last:border-0">
                    <td className="h-12 px-4"><Link href={`/t/${x.slug}`} className="font-medium hover:text-primary">{t.locale === 'ru' ? x.title.ru : x.title.en}</Link></td>
                    <td className="px-3 text-right tnum">{x.check_count}</td>
                    <td className="px-3 text-right tnum whitespace-nowrap">{t('minutes', { n: Math.round(x.time_limit_s / 60) })}</td>
                    <td className="px-4 text-right tnum">{compact(x.token_budget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { PRODUCT } from '@/lib/brand'
import { SITE_URL } from '@/lib/server-api'
import { I18nProvider } from '@/lib/i18n/client'
import { getLocale, getT } from '@/lib/i18n/server'
import { shellMessages } from '@/lib/i18n/messages/shell'

// Inter, as on linear.app: one variable family for UI and headings.
const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' })
// Code, logs and file paths only.
const jetbrains = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(shellMessages)
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: PRODUCT, template: `%s · ${PRODUCT}` },
    description: t('siteDescription'),
    openGraph: { siteName: PRODUCT, type: 'website' },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  )
}

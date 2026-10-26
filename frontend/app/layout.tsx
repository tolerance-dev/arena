import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { PRODUCT } from '@/lib/brand'
import { SITE_URL } from '@/lib/server-api'
import { LocaleProvider } from '@/lib/i18n-client'
import { getLocale, getT } from '@/lib/i18n-server'

// Inter, as on linear.app: one variable family for UI and headings.
const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' })
// Code, logs and file paths only.
const jetbrains = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: PRODUCT, template: `%s · ${PRODUCT}` },
    description: t('Кодинг-агенты строят приложения целиком (бэкенд и фронтенд) в закрытой песочнице; платформа их проверяет, люди сравнивают.',
      'Coding agents build whole apps (backend and frontend) in a closed sandbox; the platform checks them, people compare them.'),
    openGraph: { siteName: PRODUCT, type: 'website' },
    twitter: { card: 'summary_large_image' },
  }
}

// The language comes from the `lang` cookie, else the browser's Accept-Language, so every page renders per request.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  )
}

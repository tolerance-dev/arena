import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { PRODUCT } from '@/lib/brand'
import { SITE_URL } from '@/lib/server-api'

// Inter, as on linear.app: one variable family for UI and headings.
const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' })
// Code, logs and file paths only.
const jetbrains = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains' })

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: PRODUCT, template: `%s · ${PRODUCT}` },
    description: 'Кодинг-агенты строят приложения целиком (бэкенд и фронтенд) в закрытой песочнице; платформа их проверяет, люди сравнивают.',
    openGraph: { siteName: PRODUCT, type: 'website' },
    twitter: { card: 'summary_large_image' },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}

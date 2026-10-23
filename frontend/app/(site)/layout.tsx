import { SignInProvider } from '@/components/auth/sign-in-dialog'
import { SiteFooter } from '@/components/public/site-footer'
import { SiteHeader } from '@/components/public/site-header'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignInProvider>
    <div className="site-shell flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="site-main mx-auto w-full max-w-page flex-1 px-4 pt-6 pb-12 md:pt-8">{children}</main>
      <SiteFooter />
    </div>
    </SignInProvider>
  )
}

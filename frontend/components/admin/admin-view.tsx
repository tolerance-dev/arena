'use client'

import { useState } from 'react'
import { Square } from 'lucide-react'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { AgentAvatar, Ago, providerLabel, usePoll } from '@/components/runs/bits'
import { LiveRuns } from '@/components/runs/live-runs'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/empty-state'
import { api, post, put } from '@/lib/api'
import { compact } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { adminMessages } from '@/lib/i18n/messages/admin'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { AdminOverview, AdminSettings, AdminSpend, AdminUser, Run } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

type AT = ReturnType<typeof useT<typeof adminMessages.en>>

// The platform owner's page: the switches first (they are why one comes here in a hurry), then spending, what is
// running and who spends what.
export function AdminView() {
  const t = useT(adminMessages)
  const rt = useT(runsMessages)
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const admin = !!me?.can_admin
  const overview = usePoll<AdminOverview>(admin ? '/admin/overview' : null, 10_000)
  const live = usePoll<{ items: Run[] }>(admin ? '/runs?active=1' : null, 3_000)
  const [err, setErr] = useState('')

  if (loading) return <Skeleton className="h-96" />
  if (!me || !admin) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="display text-page">{t('title')}</h1>
        <p className="text-muted-foreground">{me ? t('notAdmin') : t('signIn')}</p>
        {!me && signIn && <Button onClick={signIn}>{rt('signInButton')}</Button>}
      </div>
    )
  }
  const o = overview.data
  const reload = () => { void overview.reload(); void live.reload() }
  async function act(fn: () => Promise<unknown>) {
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(errorText(e, t.locale))
    }
    reload()
  }

  return (
    <div className="space-y-10">
      <PageHeader title={t('title')} actions={o && (
        <span className="text-ui text-muted-foreground tnum">{t('queuedRunning', { queued: o.queued, running: o.running })}</span>
      )}>{t('lead')}</PageHeader>
      {err && <p role="alert" className="text-body text-destructive">{err}</p>}
      {!o ? <Skeleton className="h-96" /> : (
        <Columns
          main={
            <div className="space-y-12">
              <Switches settings={o.settings} open={o.queued + o.running} t={t} act={act} />
              <SpendBlock spend={o.spend} t={t} />
              {live.data && <LiveRuns runs={live.data.items} t={rt} empty={t('liveEmpty')} />}
              <Users users={o.users} t={t} act={act} />
            </div>
          }
          aside={o.providers.length > 0 && (
            <AsideBlock title={t('providersTitle')}>
              <ul className="space-y-2">
                {o.providers.map((p) => (
                  <li key={p.provider} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="truncate">{providerLabel(p.provider)}</span>
                    <span className="text-muted-foreground tnum">{compact(p.used)} · {rt.plural('runs', p.runs)}</span>
                  </li>
                ))}
              </ul>
            </AsideBlock>
          )}
        />
      )}
    </div>
  )
}

function Switches({ settings, open, t, act }: { settings: AdminSettings; open: number; t: AT; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  const [stopped, setStopped] = useState<number | null>(null)
  const set = (patch: Partial<AdminSettings>) => act(() => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }))
  const rows: { key: keyof AdminSettings; label: string; on: boolean; hint: string }[] = [
    { key: 'runs_paused', label: t('runsPaused'), on: !settings.runs_paused, hint: settings.runs_paused ? t('runsPausedOff') : t('runsPausedOn') },
    { key: 'user_runs', label: t('userRuns'), on: settings.user_runs, hint: settings.user_runs ? t('userRunsOn') : t('userRunsOff') },
  ]
  async function stopAll() {
    if (!confirm) { setConfirm(true); return }
    setConfirm(false)
    await act(async () => setStopped((await post<{ cancelled: number }>('/admin/runs/cancel')).cancelled))
  }
  return (
    <section>
      <SectionTitle>{t('switchesTitle')}</SectionTitle>
      <ul className="divide-y divide-border rounded-xl border-2 border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-4 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.label}</span>
              <span className={cn('block text-ui', r.on ? 'text-muted-foreground' : 'text-destructive')}>{r.hint}</span>
            </span>
            {/* runs_paused is stored inverted: the switch shows "the queue works". */}
            <Toggle on={r.on} label={r.label} onChange={(on) => void set({ [r.key]: r.key === 'runs_paused' ? !on : on })} />
          </li>
        ))}
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('stopAll')}</span>
            <span className="block text-ui text-muted-foreground">{stopped != null ? t('stopped', { n: stopped }) : t('stopAllHint')}</span>
          </span>
          <Button variant="destructive" size="sm" disabled={open === 0} onClick={() => void stopAll()} onBlur={() => setConfirm(false)}>
            <Square /> {confirm ? t('stopAllConfirm', { n: open }) : t('stopAll')}
          </Button>
        </li>
      </ul>
    </section>
  )
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        on ? 'bg-primary' : 'bg-pending')}>
      <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow-sm transition-transform duration-150', on && 'translate-x-5')} />
    </button>
  )
}

function SpendBlock({ spend, t }: { spend: AdminSpend[]; t: AT }) {
  const [period, setPeriod] = useState<AdminSpend['period']>('7d')
  const s = spend.find((x) => x.period === period) ?? spend[0]
  if (!s) return null
  return (
    <section>
      <SectionTitle aside={
        <span className="inline-flex gap-1">
          {spend.map((x) => (
            <button key={x.period} type="button" onClick={() => setPeriod(x.period)} aria-pressed={x.period === period}
              className={cn('rounded-full px-2.5 py-0.5 text-ui font-semibold transition-colors',
                x.period === period ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t(`period.${x.period}`)}
            </button>
          ))}
        </span>
      }>{t('spendTitle')}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={t('agentTokens')} value={compact(s.in + s.cache_write + s.out)}
          note={t('breakdown', { in: compact(s.in), out: compact(s.out), cache: compact(s.cache_read + s.cache_write), req: compact(s.requests) })} />
        <Stat label={t('runsCount')} value={String(s.runs)} note={s.failed ? t('failed', { n: s.failed }) : undefined} />
      </div>
      <p className="mt-2 text-meta text-faint">{t('spendHint')}</p>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <div className="text-ui text-muted-foreground">{label}</div>
      <div className="mt-1 text-page font-semibold tnum">{value}</div>
      {note && <div className="mt-1 text-meta text-faint tnum">{note}</div>}
    </div>
  )
}

function Users({ users, t, act }: { users: AdminUser[]; t: AT; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  return (
    <section>
      <SectionTitle count={users.length}>{t('usersTitle')}</SectionTitle>
      <div className="overflow-x-auto rounded-xl border-2 border-border">
        <table className="w-full min-w-[640px] text-body">
          <thead className="text-left text-ui text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">{t('colUser')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('colAgents')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('colRuns')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('colTokens')}</th>
              <th className="px-3 py-2 font-medium">{t('colLast')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colAccess')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className={cn(u.blocked && 'bg-muted')}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <AgentAvatar name={u.handle} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {u.handle}
                        {u.role === 'admin' && <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-meta font-semibold">{t('adminRole')}</span>}
                        {u.blocked && <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-meta font-semibold text-destructive">{t('blocked')}</span>}
                      </span>
                      <span className="block truncate text-meta text-faint">{u.email}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tnum">{u.agents}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  {u.runs_30d}
                  {u.open_runs > 0 && <span className="block text-meta text-primary">{t('open', { n: u.open_runs })}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tnum">
                  {compact(u.used_30d)}
                </td>
                <td className="px-3 py-2.5 text-ui text-muted-foreground">{u.last_run_at ? <Ago iso={u.last_run_at} /> : t('never')}</td>
                <td className="px-4 py-2.5 text-right">
                  {u.role !== 'admin' && (
                    <Button variant={u.blocked ? 'outline' : 'ghost'} size="xs"
                      onClick={() => void act(() => put(`/admin/users/${u.id}/blocked`, { blocked: !u.blocked }))}>
                      {u.blocked ? t('unblock') : t('block')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

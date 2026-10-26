'use client'

import { useState } from 'react'
import { Play, Square } from 'lucide-react'
import Link from 'next/link'
import { useSignIn } from '@/components/auth/sign-in-dialog'
import { PageHeader, SectionTitle } from '@/components/page-header'
import { AgentAvatar, Ago } from '@/components/runs/bits'
import { providerLabel } from '@/lib/providers'
import { usePoll } from '@/lib/use-poll'
import { LiveRuns } from '@/components/runs/live-runs'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/empty-state'
import { api, del, post, put } from '@/lib/api'
import { compact, plural, usd } from '@/lib/format'
import { errorText } from '@/lib/errors'
import type { AdminOverview, AdminSettings, AdminSpend, AdminUser, Run, Tournament } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'


const PERIODS = { '24h': '24 часа', '7d': '7 дней', '30d': '30 дней', all: 'Всё время' }

// The platform owner's page: the switches first (they are why one comes here in a hurry), then spending, what is
// running and who spends what.
export function AdminView() {
  const { me, loading } = useMe()
  const signIn = useSignIn()
  const admin = !!me?.can_admin
  const overview = usePoll<AdminOverview>(admin ? '/admin/overview' : null, 10_000)
  const live = usePoll<{ items: Run[] }>(admin ? '/runs?active=1' : null, 3_000)
  const tournament = usePoll<Tournament>(admin ? '/admin/tournament' : null, 10_000)
  const [err, setErr] = useState('')

  if (loading) return <Skeleton className="h-96" />
  if (!me || !admin) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="display text-page">Админка</h1>
        <p className="text-muted-foreground">{me ? 'Эта страница только для админов.' : 'Войдите как админ, чтобы открыть эту страницу.'}</p>
        {!me && signIn && <Button onClick={() => signIn()}>Войти</Button>}
      </div>
    )
  }
  const o = overview.data
  const reload = () => { void overview.reload(); void live.reload(); void tournament.reload() }
  async function act(fn: () => Promise<unknown>) {
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(errorText(e))
    }
    reload()
  }

  return (
    <div className="space-y-10">
      <PageHeader title="Админка" actions={o && (
        <span className="text-ui text-muted-foreground tnum">{`${o.queued} в очереди · ${o.running} идёт`}</span>
      )}>Куда уходят токены, кто их тратит, и рубильники, чтобы это остановить.</PageHeader>
      {err && <p role="alert" className="text-body text-destructive">{err}</p>}
      {!o ? <Skeleton className="h-96" /> : (
        <Columns
          main={
            <div className="space-y-12">
              <Switches settings={o.settings} open={o.queued + o.running} act={act} />
              {tournament.data && <TournamentBlock t={tournament.data} act={act} />}
              <SpendBlock spend={o.spend} />
              {live.data && <LiveRuns runs={live.data.items} empty="Ничего не запущено." />}
              <Users users={o.users} act={act} />
            </div>
          }
          aside={o.providers.length > 0 && (
            <AsideBlock title="По провайдерам, 30 дней">
              <ul className="space-y-2">
                {o.providers.map((p) => (
                  <li key={p.provider} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="truncate">{providerLabel(p.provider)}</span>
                    <span className="text-muted-foreground tnum">{compact(p.used)} · {plural(p.runs, '{n} прогон', '{n} прогона', '{n} прогонов')}</span>
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

function Switches({ settings, open, act }: { settings: AdminSettings; open: number; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  const [stopped, setStopped] = useState<number | null>(null)
  const set = (patch: Partial<AdminSettings>) => act(() => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }))
  const rows: { key: keyof AdminSettings; label: string; on: boolean; hint: string }[] = [
    { key: 'runs_paused', label: 'Очередь', on: !settings.runs_paused, hint: settings.runs_paused ? 'Пауза: очередь ждёт, идущие запуски доработают.' : 'Воркер берёт запуски из очереди.' },
    { key: 'user_runs', label: 'Запуски для пользователей', on: settings.user_runs, hint: settings.user_runs ? 'Любой вошедший может загружать агентов и запускать их.' : 'Закрыто: загружают и запускают только админы.' },
  ]
  async function stopAll() {
    if (!confirm) { setConfirm(true); return }
    setConfirm(false)
    await act(async () => setStopped((await post<{ cancelled: number }>('/admin/runs/cancel')).cancelled))
  }
  return (
    <section>
      <SectionTitle>Рубильники</SectionTitle>
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
            <span className="block font-semibold">Остановить все запуски</span>
            <span className="block text-ui text-muted-foreground">{stopped != null ? `Отменено: ${stopped}` : 'Сразу отменяет всё, что в очереди и идёт.'}</span>
          </span>
          <Button variant="destructive" size="sm" disabled={open === 0} onClick={() => void stopAll()} onBlur={() => setConfirm(false)}>
            <Square /> {confirm ? `Отменить ${open}? Нажмите ещё раз` : 'Остановить все запуски'}
          </Button>
        </li>
      </ul>
    </section>
  )
}

const WHEN: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }

// The weekly tournament: the owner's ready agents at every task, a few runs each. Only the site owner switches it
// and starts one; other admins see it.
function TournamentBlock({ t, act }: { t: Tournament; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [queued, setQueued] = useState<number | null>(null)
  const total = t.players.length * t.tasks * t.rounds
  const running = t.recent.some((r) => r.open > 0)
  const size = `${plural(t.players.length, '{n} агент', '{n} агента', '{n} агентов')} × ${plural(t.tasks, '{n} задание', '{n} задания', '{n} заданий')} × ${plural(t.rounds, '{n} прогон', '{n} прогона', '{n} прогонов')} = ${total}`
  return (
    <section>
      <SectionTitle aside={!t.can_manage ? <span className="text-ui text-muted-foreground">Управляет владелец сайта</span> : undefined}>Турнир</SectionTitle>
      <ul className="divide-y divide-border rounded-xl border-2 border-border">
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Каждую неделю</span>
            <span className="block text-ui text-muted-foreground">
              {t.weekly && t.next_at
                ? `Следующий: ${new Date(t.next_at).toLocaleString('ru-RU', WHEN)}. Пока идёт прошлый, новый ждёт.`
                : 'Выключен. Включённый стартует по понедельникам в 03:00 UTC.'}
            </span>
          </span>
          {t.can_manage
            ? <Toggle on={t.weekly} label="Турнир каждую неделю" onChange={(on) => void act(() => put('/admin/tournament/weekly', { on }))} />
            : <span className="text-ui text-muted-foreground">{t.weekly ? 'Включён' : 'Выключен'}</span>}
        </li>
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Запустить сейчас</span>
            <span className="block text-ui text-muted-foreground tnum">
              {queued != null ? `В очереди: ${plural(queued, '{n} прогон', '{n} прогона', '{n} прогонов')}` : running ? 'Прошлый турнир ещё идёт.' : `${size} прогонов на ключах агентов.`}
            </span>
          </span>
          {t.can_manage && (
            <Button size="sm" disabled={running || t.players.length === 0}
              onClick={() => void act(async () => setQueued((await post<{ runs: number }>('/admin/tournament')).runs))}>
              <Play /> Запустить
            </Button>
          )}
        </li>
        <li className="px-4 py-3">
          <span className="block font-semibold">Участники</span>
          {t.players.length ? (
            <ul className="mt-2 space-y-2">
              {t.players.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 text-body">
                  <AgentAvatar name={p.name} size="sm" />
                  <span className="min-w-0">
                    <Link href={`/agents/${p.id}`} className="block truncate font-semibold transition-colors hover:text-primary">{p.name}</Link>
                    <span className="block truncate text-ui text-muted-foreground">{[p.model_name ?? p.model, providerLabel(p.provider)].join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-ui text-muted-foreground">Играют готовые агенты владельца сайта, а их пока нет. Добавьте их в <Link href="/my" className="font-medium text-primary hover:underline">«Мои агенты»</Link>.</p>
          )}
        </li>
        {t.recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-body">
            <span className="min-w-0 flex-1 basis-full sm:basis-0">
              <span className="font-semibold whitespace-nowrap">{new Date(r.created_at).toLocaleString('ru-RU', WHEN)}</span>
              <span className="ml-2 text-ui whitespace-nowrap text-muted-foreground">{r.week ? `по расписанию, ${r.week}` : 'вручную'}</span>
            </span>
            <span className="text-ui text-muted-foreground tnum">
              {[`готово ${r.done} из ${r.runs}`, r.open ? `идёт ${r.open}` : null, r.failed ? `ошибок ${r.failed}` : null, `${usd(r.cost_usd)} по прайсу`].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
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

function SpendBlock({ spend }: { spend: AdminSpend[] }) {
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
              {PERIODS[x.period as keyof typeof PERIODS] ?? x.period}
            </button>
          ))}
        </span>
      }>Траты</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Траты агентов" value={usd(s.cost_usd)} note={s.unpriced ? `не учтены: ${s.unpriced} прогонов загруженных агентов (модель неизвестна)` : 'по прайсу, с ключей самих агентов'} />
        <Stat label="Токены агентов" value={compact(s.in + s.cache_write + s.out)}
          note={`вход ${compact(s.in)} · выход ${compact(s.out)} · кэш ${compact(s.cache_read + s.cache_write)} · ${compact(s.requests)} запросов`} />
        <Stat label="Запуски" value={String(s.runs)} note={s.failed ? `ошибок платформы: ${s.failed}` : undefined} />
      </div>
      <p className="mt-2 text-meta text-faint">Токены агентов идут с ключа каждого агента. Токены бюджета = вход + запись в кэш + выход.</p>
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

function Users({ users, act }: { users: AdminUser[]; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  return (
    <section>
      <SectionTitle count={users.length}>Пользователи</SectionTitle>
      <div className="overflow-x-auto rounded-xl border-2 border-border">
        <table className="w-full min-w-[640px] text-body">
          <thead className="text-left text-ui text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Пользователь</th>
              <th className="px-3 py-2 text-right font-medium">Агенты</th>
              <th className="px-3 py-2 text-right font-medium">Запуски, 30 дн.</th>
              <th className="px-3 py-2 text-right font-medium">Токены, 30 дн.</th>
              <th className="px-3 py-2 text-right font-medium">Траты, 30 дн.</th>
              <th className="px-3 py-2 text-right font-medium">Голоса</th>
              <th className="px-3 py-2 font-medium">Последний запуск</th>
              <th className="px-4 py-2 text-right font-medium">Доступ</th>
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
                        {u.role === 'admin' && <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-meta font-semibold">админ</span>}
                        {u.blocked && <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-meta font-semibold text-destructive">Заблокирован</span>}
                      </span>
                      <span className="block truncate text-meta text-faint">{u.email}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tnum">{u.agents}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  {u.runs_30d}
                  {u.open_runs > 0 && <span className="block text-meta text-primary">{`идёт: ${u.open_runs}`}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tnum">
                  {compact(u.used_30d)}
                </td>
                <td className="px-3 py-2.5 text-right tnum">{u.cost_30d ? usd(u.cost_30d) : '—'}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  {u.votes}
                  {u.votes > 0 && (
                    <button type="button" className="block w-full text-right text-meta text-destructive hover:underline"
                      onClick={() => void act(() => del(`/admin/users/${u.id}/votes`))}>Удалить голоса</button>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ui text-muted-foreground">{u.last_run_at ? <Ago iso={u.last_run_at} /> : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {u.role !== 'admin' && (
                    <Button variant={u.blocked ? 'outline' : 'ghost'} size="xs"
                      onClick={() => void act(() => put(`/admin/users/${u.id}/blocked`, { blocked: !u.blocked }))}>
                      {u.blocked ? 'Разблокировать' : 'Заблокировать'}
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

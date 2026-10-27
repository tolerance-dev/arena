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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/empty-state'
import { api, del, post, put } from '@/lib/api'
import { compact, usd } from '@/lib/format'
import type { T } from '@/lib/i18n'
import { useT } from '@/lib/i18n-client'
import { errorText } from '@/lib/errors'
import type { AdminOverview, AdminSettings, AdminSpend, AdminUser, Run, Tournament } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'


function periodLabel(p: string, t: T) {
  switch (p) {
    case '24h': return t('24 часа', '24 hours')
    case '7d': return t('7 дней', '7 days')
    case '30d': return t('30 дней', '30 days')
    case 'all': return t('Всё время', 'All time')
    default: return p
  }
}

// The platform owner's page: the switches first (they are why one comes here in a hurry), then spending, what is
// running and who spends what.
export function AdminView() {
  const t = useT()
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
        <h1 className="display text-page">{t('Админка', 'Admin')}</h1>
        <p className="text-muted-foreground">{me ? t('Эта страница только для админов.', 'This page is for admins only.') : t('Войдите как админ, чтобы открыть эту страницу.', 'Sign in as an admin to open this page.')}</p>
        {!me && signIn && <Button onClick={() => signIn()}>{t('Войти', 'Sign in')}</Button>}
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
      setErr(errorText(e, t))
    }
    reload()
  }

  return (
    <div className="space-y-10">
      <PageHeader title={t('Админка', 'Admin')} actions={o && (
        <span className="text-ui text-muted-foreground tnum">{t(`${o.queued} в очереди · ${o.running} идёт`, `${o.queued} queued · ${o.running} running`)}</span>
      )}>{t('Куда уходят токены, кто их тратит, и рубильники, чтобы это остановить.', 'Where the tokens go, who spends them, and the switches to stop it.')}</PageHeader>
      {err && <p role="alert" className="text-body text-destructive">{err}</p>}
      {!o ? <Skeleton className="h-96" /> : (
        <Columns
          main={
            <div className="space-y-12">
              <Switches settings={o.settings} open={o.queued + o.running} act={act} />
              {tournament.data && <TournamentBlock tour={tournament.data} act={act} />}
              <SpendBlock spend={o.spend} />
              {live.data && <LiveRuns runs={live.data.items} empty={t('Ничего не запущено.', 'Nothing is running.')} onChange={reload} />}
              <Users users={o.users} act={act} />
            </div>
          }
          aside={o.providers.length > 0 && (
            <AsideBlock title={t('По провайдерам, 30 дней', 'By provider, 30 days')}>
              <ul className="space-y-2">
                {o.providers.map((p) => (
                  <li key={p.provider} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="truncate">{providerLabel(p.provider, t)}</span>
                    <span className="text-muted-foreground tnum">{compact(p.used)} · {t.plural(p.runs, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}</span>
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
  const t = useT()
  const [confirm, setConfirm] = useState(false)
  const [stopped, setStopped] = useState<number | null>(null)
  const set = (patch: Partial<AdminSettings>) => act(() => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }))
  const rows: { key: 'runs_paused' | 'user_runs'; label: string; on: boolean; hint: string }[] = [
    { key: 'runs_paused', label: t('Очередь', 'Queue'), on: !settings.runs_paused, hint: settings.runs_paused ? t('Пауза: очередь ждёт, идущие запуски доработают.', 'Paused: the queue waits, runs in progress finish.') : t('Воркер берёт запуски из очереди.', 'The worker takes runs from the queue.') },
    { key: 'user_runs', label: t('Запуски для пользователей', 'User runs'), on: settings.user_runs, hint: settings.user_runs ? t('Любой вошедший может загружать агентов и запускать их.', 'Anyone signed in may upload agents and run them.') : t('Закрыто: загружают и запускают только админы.', 'Closed: only admins upload and run.') },
  ]
  async function stopAll() {
    if (!confirm) { setConfirm(true); return }
    setConfirm(false)
    await act(async () => setStopped((await post<{ cancelled: number }>('/admin/runs/cancel')).cancelled))
  }
  return (
    <section>
      <SectionTitle>{t('Рубильники', 'Switches')}</SectionTitle>
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
        <Limit label={t('Запусков в сутки на пользователя', 'Runs a day per user')} hint={t('Админы без лимита.', 'Admins have no limit.')}
          value={settings.daily_runs_per_user} onSave={(n) => set({ daily_runs_per_user: n })} />
        <Limit label={t('Потолок очереди', 'Queue cap')} hint={t('Запусков пользователей в очереди, дальше «очередь полна». 0 — без потолка.', 'User runs waiting in the queue before “queue full”. 0 = no cap.')}
          value={settings.user_queue_cap} onSave={(n) => set({ user_queue_cap: n })} />
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('Остановить все запуски', 'Stop all runs')}</span>
            <span className="block text-ui text-muted-foreground">{stopped != null ? t(`Отменено: ${stopped}`, `Cancelled: ${stopped}`) : t('Сразу отменяет всё, что в очереди и идёт.', 'Cancels everything queued and running at once.')}</span>
          </span>
          <Button variant="destructive" size="sm" disabled={open === 0} onClick={() => void stopAll()} onBlur={() => setConfirm(false)}>
            <Square /> {confirm ? t(`Отменить ${open}? Нажмите ещё раз`, `Cancel ${open}? Press again`) : t('Остановить все запуски', 'Stop all runs')}
          </Button>
        </li>
      </ul>
    </section>
  )
}

// A number setting, saved on blur or Enter when it changed.
function Limit({ label, hint, value, onSave }: { label: string; hint: string; value: number; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const save = () => {
    const n = Number(draft)
    if (Number.isInteger(n) && n >= 0 && n !== value) onSave(n)
    else setDraft(String(value))
  }
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-ui text-muted-foreground">{hint}</span>
      </span>
      <Input type="number" min={0} inputMode="numeric" aria-label={label} className="w-20 text-right tnum" value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
    </li>
  )
}

const WHEN: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }

// The weekly tournament: the owner's ready agents at every task, a few runs each. Only the site owner switches it
// and starts one; other admins see it.
function TournamentBlock({ tour, act }: { tour: Tournament; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = useT()
  const [queued, setQueued] = useState<number | null>(null)
  const total = tour.players.length * tour.tasks * tour.rounds
  const running = tour.recent.some((r) => r.open > 0)
  const size = `${t.plural(tour.players.length, ['{n} агент', '{n} агента', '{n} агентов'], ['{n} agent', '{n} agents'])} × ${t.plural(tour.tasks, ['{n} задание', '{n} задания', '{n} заданий'], ['{n} task', '{n} tasks'])} × ${t.plural(tour.rounds, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])} = ${total}`
  return (
    <section>
      <SectionTitle aside={!tour.can_manage ? <span className="text-ui text-muted-foreground">{t('Управляет владелец сайта', 'Run by the site owner')}</span> : undefined}>{t('Турнир', 'Tournament')}</SectionTitle>
      <ul className="divide-y divide-border rounded-xl border-2 border-border">
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('Каждую неделю', 'Every week')}</span>
            <span className="block text-ui text-muted-foreground">
              {tour.weekly && tour.next_at
                ? t(`Следующий: ${t.date(tour.next_at, WHEN)}. Пока идёт прошлый, новый ждёт.`, `Next: ${t.date(tour.next_at, WHEN)}. While the last one runs, a new one waits.`)
                : t('Выключен. Включённый стартует по понедельникам в 03:00 UTC.', 'Off. When on, it starts on Mondays at 03:00 UTC.')}
            </span>
          </span>
          {tour.can_manage
            ? <Toggle on={tour.weekly} label={t('Турнир каждую неделю', 'Weekly tournament')} onChange={(on) => void act(() => put('/admin/tournament/weekly', { on }))} />
            : <span className="text-ui text-muted-foreground">{tour.weekly ? t('Включён', 'On') : t('Выключен', 'Off')}</span>}
        </li>
        <li className="flex items-center gap-4 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('Запустить сейчас', 'Start now')}</span>
            <span className="block text-ui text-muted-foreground tnum">
              {queued != null ? t(`В очереди: ${t.plural(queued, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}`, `Queued: ${t.plural(queued, ['{n} прогон', '{n} прогона', '{n} прогонов'], ['{n} run', '{n} runs'])}`) : running ? t('Прошлый турнир ещё идёт.', 'The last tournament is still going.') : t(`${size} прогонов на ключах агентов.`, `${size} runs on the agents’ keys.`)}
            </span>
          </span>
          {tour.can_manage && (
            <Button size="sm" disabled={running || tour.players.length === 0}
              onClick={() => void act(async () => setQueued((await post<{ runs: number }>('/admin/tournament')).runs))}>
              <Play /> {t('Запустить', 'Start')}
            </Button>
          )}
        </li>
        <li className="px-4 py-3">
          <span className="block font-semibold">{t('Участники', 'Players')}</span>
          {tour.players.length ? (
            <ul className="mt-2 space-y-2">
              {tour.players.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 text-body">
                  <AgentAvatar name={p.name} size="sm" />
                  <span className="min-w-0">
                    <Link href={`/agents/${p.id}`} className="block truncate font-semibold transition-colors hover:text-primary">{p.name}</Link>
                    <span className="block truncate text-ui text-muted-foreground">{[p.model_name ?? p.model, providerLabel(p.provider, t)].join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-ui text-muted-foreground">{t('Играют готовые агенты владельца сайта, а их пока нет. Добавьте их в ', 'The site owner’s ready agents play, and there are none yet. Add them in ')}<Link href="/my" className="font-medium text-primary hover:underline">{t('«Мои агенты»', '“My agents”')}</Link>.</p>
          )}
        </li>
        {tour.recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-body">
            <span className="min-w-0 flex-1 basis-full sm:basis-0">
              <span className="font-semibold whitespace-nowrap">{t.date(r.created_at, WHEN)}</span>
              <span className="ml-2 text-ui whitespace-nowrap text-muted-foreground">{r.week ? t(`по расписанию, ${r.week}`, `scheduled, ${r.week}`) : t('вручную', 'by hand')}</span>
            </span>
            <span className="text-ui text-muted-foreground tnum">
              {[t(`готово ${r.done} из ${r.runs}`, `${r.done} of ${r.runs} done`), r.open ? t(`идёт ${r.open}`, `${r.open} running`) : null, r.failed ? t(`ошибок ${r.failed}`, `${r.failed} errors`) : null, t(`${usd(r.cost_usd)} по прайсу`, `${usd(r.cost_usd)} at list price`)].filter(Boolean).join(' · ')}
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
  const t = useT()
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
              {periodLabel(x.period, t)}
            </button>
          ))}
        </span>
      }>{t('Траты', 'Spending')}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('Траты агентов', 'Agent spending')} value={usd(s.cost_usd)} note={s.unpriced ? t(`не учтены: ${s.unpriced} прогонов загруженных агентов (модель неизвестна)`, `not counted: ${s.unpriced} runs of uploaded agents (unknown model)`) : t('по прайсу, с ключей самих агентов', 'at list price, on the agents’ own keys')} />
        <Stat label={t('Токены агентов', 'Agent tokens')} value={compact(s.in + s.cache_write + s.out)}
          note={t(`вход ${compact(s.in)} · выход ${compact(s.out)} · кэш ${compact(s.cache_read + s.cache_write)} · ${compact(s.requests)} запросов`, `in ${compact(s.in)} · out ${compact(s.out)} · cache ${compact(s.cache_read + s.cache_write)} · ${compact(s.requests)} requests`)} />
        <Stat label={t('Запуски', 'Runs')} value={String(s.runs)} note={s.failed ? t(`ошибок платформы: ${s.failed}`, `${s.failed} platform errors`) : undefined} />
      </div>
      <p className="mt-2 text-meta text-faint">{t('Токены агентов идут с ключа каждого агента. Токены бюджета = вход + запись в кэш + выход.', 'Agent tokens come from each agent’s own key. Budget tokens = input + cache writes + output.')}</p>
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
  const t = useT()
  return (
    <section>
      <SectionTitle count={users.length}>{t('Пользователи', 'Users')}</SectionTitle>
      <div className="overflow-x-auto rounded-xl border-2 border-border">
        <table className="w-full min-w-[640px] text-body">
          <thead className="text-left text-ui text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">{t('Пользователь', 'User')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Агенты', 'Agents')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Запуски, 30 дн.', 'Runs, 30 d')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Токены, 30 дн.', 'Tokens, 30 d')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Траты, 30 дн.', 'Spent, 30 d')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Голоса', 'Votes')}</th>
              <th className="px-3 py-2 font-medium">{t('Последний запуск', 'Last run')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('Доступ', 'Access')}</th>
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
                        {u.role === 'admin' && <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-meta font-semibold">{t('админ', 'admin')}</span>}
                        {u.blocked && <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-meta font-semibold text-destructive">{t('Заблокирован', 'Blocked')}</span>}
                      </span>
                      <span className="block truncate text-meta text-faint">{u.email}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tnum">{u.agents}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  {u.runs_30d}
                  {u.open_runs > 0 && <span className="block text-meta text-primary">{t(`идёт: ${u.open_runs}`, `running: ${u.open_runs}`)}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tnum">
                  {compact(u.used_30d)}
                </td>
                <td className="px-3 py-2.5 text-right tnum">{u.cost_30d ? usd(u.cost_30d) : '—'}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  {u.votes}
                  {u.votes > 0 && (
                    <button type="button" className="block w-full text-right text-meta text-destructive hover:underline"
                      onClick={() => void act(() => del(`/admin/users/${u.id}/votes`))}>{t('Удалить голоса', 'Delete votes')}</button>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ui text-muted-foreground">{u.last_run_at ? <Ago iso={u.last_run_at} /> : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {u.role !== 'admin' && (
                    <Button variant={u.blocked ? 'outline' : 'ghost'} size="xs"
                      onClick={() => void act(() => put(`/admin/users/${u.id}/blocked`, { blocked: !u.blocked }))}>
                      {u.blocked ? t('Разблокировать', 'Unblock') : t('Заблокировать', 'Block')}
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

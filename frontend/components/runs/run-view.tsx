'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Download, ExternalLink, Maximize2, Minus, Monitor, RotateCw, Smartphone, X } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { LoadError, StaleNote } from '@/components/ui/load-state'
import { Meta } from '@/components/ui/feed'
import { Segmented } from '@/components/ui/segmented'
import { del, post } from '@/lib/api'
import { compact, duration, usd, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import { errorText } from '@/lib/errors'
import type { T } from '@/lib/i18n'
import { isVoted, type Check as CheckResult, type Run } from '@/lib/types'
import { providerLabel } from '@/lib/providers'
import { useMe } from '@/lib/use-me'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, exitLabel, isActive, phase, queueLine, RatingValue, Scenarios, scoreTone, Stack, StatusPill, taskTitle } from './bits'
import { TaskGlyph } from './task-glyph'
import { LiveBuild } from './live-build'
import { agentElapsed, useNow } from './live-runs'

// One submission, laid out like a Product Hunt product page: what the agent built is the centrepiece, the verdict and
// the run's numbers sit in the aside.
export function RunView({ id }: { id: string }) {
  const t = useT()
  const poll = usePoll<Run>(`/runs/${encodeURIComponent(id)}`, 3_000, isActive)
  const run = poll.data
  if (poll.error?.status === 404) return <EmptyState>{t('Такого прогона нет. Возможно, его удалили.', 'There’s no such run. It may have been deleted.')}</EmptyState>
  if (!run) {
    if (poll.error) return <LoadError poll={poll} what={t('прогон', 'run')} />
    return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-[28rem]" /></div>
  }
  const done = run.status === 'done'
  const platformFailed = run.status === 'infra_error' && run.failure_reason !== 'cancelled'
  const keyRejected = run.agent_exit === 'key_rejected'

  return (
    <div>
      <Breadcrumbs items={[
        { label: t('Задачи', 'Tasks'), href: '/' },
        { label: <><TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run, t)}</>, href: `/t/${run.task}` },
        { label: run.agent.name },
      ]} />
      <StaleNote poll={poll} what={t('прогон', 'run')} className="mt-4" />
      <Columns className="mt-6"
        main={
          <div className="space-y-10">
            <Header run={run} />
            {/* What the agent built comes first; below 1280px the aside drops under the page, so the verdict follows. */}
            {done && !keyRejected && <Preview run={run} />}
            {isVoted(run.task_kind) && !!run.task_scenarios?.length && (
              <section>
                <SectionTitle aside={<Link href={`/vote?task=${run.task}`} className="hover:text-primary">{t('Голосовать за эту задачу', 'Vote on this task')}</Link>}>{t('Что пробуют голосующие', 'What voters try')}</SectionTitle>
                <Scenarios items={run.task_scenarios} />
              </section>
            )}
            {keyRejected && (
              <p role="alert" className="rounded-xl border-2 border-destructive/20 bg-destructive/5 px-4 py-3 text-body text-destructive">
                {t('Провайдер отклонил ключ агента (неверный ключ, у ключа нет доступа к API или кончились деньги на счёте), поэтому агент не получил ни одного ответа модели. Причина есть в логе агента. Прогон не оценивался и не засчитан в лимит. Если агент ваш, замените ключ на странице',
                  'The provider rejected the agent’s key (a wrong key, a key without API access, or no money left on the account), so the agent got no model responses at all. The reason is in the agent log. The run wasn’t scored and doesn’t count toward the limit. If the agent is yours, replace the key on the')}{' '}
                <Link href="/my" className="font-semibold underline underline-offset-2">{t('«Мои агенты»', '“My agents” page')}</Link>{t(' и запустите снова.', ' and run it again.')}
              </p>
            )}
            <div className="xl:hidden"><Verdict run={run} /></div>
            {!done && <Timeline run={run} />}
            {run.status === 'agent' && <LiveBuild run={run} />}
            {platformFailed && (
              <p role="alert" className="rounded-xl border-2 border-destructive/20 bg-destructive/5 px-4 py-3 text-body text-destructive">{t(`Прогон сорвался по вине платформы: ${run.failure_reason ?? '?'}`, `The run failed through the platform’s fault: ${run.failure_reason ?? '?'}`)}</p>
            )}
            {run.checks.length > 0 && <Checks run={run} />}
            {run.status !== 'queued' && run.status !== 'agent' && <LiveBuild run={run} mode="code" />}
            <Logs run={run} />
          </div>
        }
        aside={
          <>
            <div className="max-xl:hidden"><Verdict run={run} /></div>
            <Numbers run={run} />
            <Actions run={run} onChange={poll.reload} />
          </>
        }
      />
    </div>
  )
}

function Header({ run }: { run: Run }) {
  const t = useT()
  return (
    <header className="flex items-start gap-4">
      <AgentAvatar name={run.agent.name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="display text-page break-words">{run.agent.name}</h1>
        <p className="text-subtitle text-muted-foreground">
          <Link href={`/t/${run.task}`} className="transition-colors hover:text-primary">{taskTitle(run, t)}</Link>
        </p>
        <Meta className="mt-1" items={[
          <StatusPill key="s" run={run} className="align-middle" />,
          t(`от ${run.agent.owner}`, `by ${run.agent.owner}`),
          providerLabel(run.agent.provider, t),
          <Stack key="st" run={run} pill />,
          <Ago key="a" iso={run.created_at} />,
        ]} />
        {run.agent.description && <p className="mt-3 max-w-[70ch] text-title text-muted-foreground">{run.agent.description}</p>}
      </div>
    </header>
  )
}

// Where the run is now. Shown only until it finishes; the verdict takes over after that.
function Timeline({ run }: { run: Run }) {
  const t = useT()
  const now = useNow()
  const order = ['queued', 'agent', 'checking', 'done']
  const at = run.status === 'infra_error' ? -1 : order.indexOf(run.status)
  const labels = [t('В очереди', 'Queued'), t('Агент строит', 'Agent builds'), t('Проверки', 'Checks'), t('Результат', 'Result')]
  return (
    <div>
    <ol className="grid grid-cols-4 gap-1.5" aria-label={t('Ход прогона', 'Run progress')}>
      {labels.map((label, i) => {
        const state = at === -1 ? 'off' : i < at ? 'past' : i === at ? 'now' : 'next'
        return (
          <li key={label} className="min-w-0" aria-current={state === 'now' ? 'step' : undefined}>
            <div className={cn('h-1 rounded-full bg-pending', state === 'past' && 'bg-foreground', state === 'now' && 'animate-status-pulse bg-primary')} />
            <div className={cn('mt-2 truncate text-ui', state === 'now' ? 'font-semibold text-foreground' : 'text-faint')}>{label}</div>
          </li>
        )
      })}
    </ol>
    {isActive(run) && (
      <p className="mt-3 text-body">
        <span className="font-semibold">{phase(run.status, t)}</span>
        {run.status === 'agent' && <span className="text-muted-foreground tnum"> · {t(`${duration(agentElapsed(run, now))} из ${duration(run.time_limit_s)}`, `${duration(agentElapsed(run, now))} of ${duration(run.time_limit_s)}`)}</span>}
        {queueLine(run, t) && <span className="text-muted-foreground tnum"> · {queueLine(run, t)}</span>}
      </p>
    )}
    </div>
  )
}

// The live app, or its screenshots once the snapshot is gone, as a computer or a 390px phone sees it.
function Preview({ run }: { run: Run }) {
  const t = useT()
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const frame = useRef<HTMLDivElement>(null)
  const live = run.preview_url
  const shot = device === 'desktop' ? run.has_shot : run.has_shot_mobile
  if (!live && !run.has_shot && !run.has_shot_mobile) return <EmptyState>{t('Превью нет: приложение не запустилось.', 'No preview: the app didn’t start.')}</EmptyState>
  return (
    <section aria-label={t('Что построил агент', 'What the agent built')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented label={t('Устройство', 'Device')} value={device} onChange={setDevice} options={[
            { value: 'desktop', label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />{t('Компьютер', 'Desktop')}</span> },
            { value: 'mobile', label: <span className="inline-flex items-center gap-1.5"><Smartphone className="size-3.5" />{t('Телефон (390px)', 'Phone (390px)')}</span> },
          ]} />
          <span className="text-ui text-faint">{live ? t('Живое превью', 'Live preview') : t('Скриншоты', 'Screenshots')}</span>
        </div>
        {live && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void frame.current?.requestFullscreen?.()}>
              <Maximize2 /> {t('На весь экран', 'Full screen')}
            </Button>
            <Button variant="outline" size="sm" render={<a href={live} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
              <ExternalLink /> {t('Открыть в новой вкладке', 'Open in a new tab')}
            </Button>
          </div>
        )}
      </div>
      {live ? (
        <>
          <div ref={frame} className={cn('overflow-hidden rounded-xl border-2 border-border bg-card', device === 'mobile' && 'mx-auto w-[394px] max-w-full')}>
            <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
              <span aria-hidden className="flex gap-1.5"><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /></span>
              <span className="truncate font-mono text-meta text-faint">{live}</span>
            </div>
            <iframe src={live} title={t('Живое превью', 'Live preview')}
              className={cn('block w-full bg-white', device === 'desktop' ? 'h-[72vh] min-h-[460px] [:fullscreen_&]:h-[calc(100vh-37px)]' : 'mx-auto h-[780px] max-h-[80vh] max-w-[390px] [:fullscreen_&]:h-[calc(100vh-37px)] [:fullscreen_&]:max-h-none')}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          </div>
          <p className="mt-2 text-ui text-faint">{t('Приложение агента, запущенное из снапшота. Первое открытие поднимает его за несколько секунд.', 'The agent’s app, started from its snapshot. The first visit brings it up in a few seconds.')}</p>
        </>
      ) : shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/${device === 'desktop' ? 'shot.jpg' : 'shot-mobile.jpg'}`} alt={device === 'desktop' ? t('Десктоп', 'Desktop') : t('Телефон', 'Phone')}
          className={cn('rounded-xl border-2 border-border', device === 'desktop' ? 'w-full' : 'mx-auto w-full max-w-[390px]')} />
      ) : <EmptyState>{t('Нет скриншота', 'No screenshot')}</EmptyState>}
    </section>
  )
}

// The result in one place: the score and how many checks it took. The checks themselves are in the main column.
function Verdict({ run }: { run: Run }) {
  const t = useT()
  const done = run.status === 'done'
  const passed = run.checks.filter((c) => c.passed).length
  const failed = run.checks.length - passed
  if (isVoted(run.task_kind)) return <VoteVerdict run={run} />
  return (
    <section aria-label={t('Оценка', 'Score')} className="rounded-xl border-2 border-border p-5">
      <div className="text-body text-muted-foreground">{t('Оценка', 'Score')}</div>
      <div className={cn('numeral mt-2 text-[56px]', done && run.score != null ? scoreTone(run.score) : 'text-pending')}>
        {done && run.score != null ? run.score : '—'}
      </div>
      <p className="mt-1 text-body text-muted-foreground">
        {!done ? t('Появится, когда закончатся проверки.', 'Appears once the checks finish.')
          : run.agent_exit === 'key_rejected' ? t('Не оценивался: провайдер отклонил ключ.', 'Not scored: the provider rejected the key.')
          : !run.app_started ? t('Приложение не запустилось, проверять было нечего.', 'The app didn’t start, so there was nothing to check.')
          : run.checks.length > 0 ? t.plural(run.checks.length, [`Пройдено ${passed} из {n} проверки`, `Пройдено ${passed} из {n} проверок`, `Пройдено ${passed} из {n} проверок`], [`${passed} of {n} check passed`, `${passed} of {n} checks passed`])
          : t('Проверки не запускались.', 'The checks didn’t run.')}
      </p>
      {done && run.app_started && run.checks.length > 0 && (
        <>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-destructive">
            <div className="bg-success" style={{ width: `${(100 * passed) / run.checks.length}%` }} />
          </div>
          {failed > 0 && <a href="#checks" className="mt-2 inline-block text-ui font-medium text-destructive hover:underline">{t.plural(failed, ['{n} проверка не прошла', '{n} проверки не прошли', '{n} проверок не прошли'], ['{n} check failed', '{n} checks failed'])} ↓</a>}
        </>
      )}
      {run.checks_version && !run.checks_current && (
        <p className="mt-3 text-ui text-faint">{t('Проверки задачи с тех пор изменились: прогон не в рейтинге.', 'The task’s checks have changed since: the run isn’t ranked.')}</p>
      )}
      {run.agent_rating && <p className="mt-3 border-t border-border pt-3 text-ui text-muted-foreground"><Elo run={run} /></p>}
    </section>
  )
}

// A voted task (invent, startup) has no score: the checks only admit the run, and people's blind votes rank the agent.
function VoteVerdict({ run }: { run: Run }) {
  const t = useT()
  const done = run.status === 'done'
  const failed = run.checks.filter((c) => !c.passed).length
  const r = run.agent_rating
  const gate = !done ? { tone: 'text-faint', text: t('Входные проверки пройдут, когда агент закончит.', 'The entry checks run once the agent finishes.') }
    : run.agent_exit === 'key_rejected' ? { tone: 'text-destructive', text: t('Провайдер отклонил ключ: в голосование не попадает.', 'The provider rejected the key: not in the votes.') }
    : !run.app_started ? { tone: 'text-destructive', text: t('Приложение не запустилось: в голосование не попадает.', 'The app didn’t start: not in the votes.') }
    : failed > 0 ? { tone: 'text-destructive', text: t.plural(failed, ['{n} входная проверка не прошла', '{n} входные проверки не прошли', '{n} входных проверок не прошли'], ['{n} entry check failed', '{n} entry checks failed']) }
    : { tone: 'text-success', text: t('Входные проверки пройдены', 'Entry checks passed') }
  return (
    <section aria-label={t('Голосование', 'Votes')} className="rounded-xl border-2 border-border p-5">
      <div className="text-body text-muted-foreground">{t('Рейтинг по голосам', 'Rating by votes')}</div>
      <div className={cn('numeral mt-2 text-[56px]', r && !r.provisional ? 'text-foreground' : 'text-pending')}>{r ? r.elo : '—'}{r && <span className="ml-2 text-section text-faint">±{r.ci}</span>}</div>
      <p className="mt-1 text-body text-muted-foreground">{r ? <Elo run={run} bare /> : t('Голосов за агента пока нет.', 'No votes for the agent yet.')}</p>
      <p className={cn('mt-3 flex items-center gap-1.5 text-ui font-medium', gate.tone)}>
        {done && run.app_started && failed === 0 && run.agent_exit !== 'key_rejected' && <Check className="size-4" />}{gate.text}
      </p>
      <p className="mt-3 border-t border-border pt-3 text-ui text-faint">
        {t('Здесь нет балла: люди сравнивают приложения двух агентов вслепую, в паре участвует медианный прогон агента.', 'There’s no score here: people compare two agents’ apps blind, each with its median run.')}{' '}
        <Link href={`/vote?task=${run.task}`} className="font-medium text-primary hover:underline">{t('Голосовать', 'Vote')}</Link>
      </p>
    </section>
  )
}

// The agent's rating at the task from people's blind votes, with its record.
function Elo({ run, bare }: { run: Run; bare?: boolean }) {
  const t = useT()
  const r = run.agent_rating
  if (!r) return null
  const record = t(`${r.wins} побед, ${r.losses} поражений, ${r.ties} ничьих`, `${r.wins} won, ${r.losses} lost, ${r.ties} tied`)
  const votes = t.plural(r.votes, ['{n} голос', '{n} голоса', '{n} голосов'], ['{n} vote', '{n} votes']) + (r.provisional ? t(', пока мало', ', too few yet') : '')
  return bare ? <>{votes}: {record}</> : <>{t('В голосовании', 'In the votes')}: <RatingValue r={r} /> · {votes}</>
}

// The run's numbers as label/value lines, like Product Hunt's "Company info".
function Numbers({ run }: { run: Run }) {
  const t = useT()
  const now = useNow()
  const used = usedTokens(run.tokens)
  const pct = Math.min(999, Math.round((100 * used) / Math.max(1, run.token_budget)))
  const done = run.status === 'done'
  const called = Object.entries(run.models ?? {}).sort((a, b) => b[1] - a[1])
  const model = run.agent.model_name || run.manifest.model_id || (called.length === 1 ? called[0][0] : '')
  return (
    <AsideBlock title={t('Прогон', 'Run')}>
      <dl className="space-y-3">
        <Line label={t('Модель', 'Model')} value={<span className="text-body">{model || t('выбирает агент', 'the agent picks')}</span>}
          sub={called.length > 1 ? called.map(([id, n]) => `${id} ×${n}`).join(', ') : undefined} />
        <Line label={t('Время агента', 'Agent time')} value={duration(agentElapsed(run, now))}
          sub={[t(`из ${duration(run.time_limit_s)}`, `of ${duration(run.time_limit_s)}`), run.agent_exit && exitLabel(run.agent_exit, t)].filter(Boolean).join(', ')} />
        <Line label={t('Токены', 'Tokens')} value={compact(used)}
          sub={used > run.token_budget
            ? <span className="text-destructive">{t('Больше бюджета: прогон не идёт в рейтинг', 'Over budget: the run isn’t ranked')}</span>
            : t(`${pct}% бюджета`, `${pct}% of the budget`)} />
        <Line label={t('Стоимость', 'Cost')} value={run.cost_usd == null ? '—' : usd(run.cost_usd)}
          sub={run.cost_usd == null ? t('модель неизвестна', 'unknown model') : run.agent.provider.endsWith('-sub') ? t('подписка, по прайсу', 'subscription, at list price') : undefined} />
        {done && run.stats.loc > 0 && (
          <Line label={t('Код', 'Code')} value={t.plural(run.stats.loc, ['{n} строка', '{n} строки', '{n} строк'], ['{n} line', '{n} lines'])}
            sub={t.plural(run.stats.files, ['{n} файл', '{n} файла', '{n} файлов'], ['{n} file', '{n} files'])} />
        )}
      </dl>
    </AsideBlock>
  )
}

function Line({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-body text-muted-foreground">{label}</dt>
        <dd className="text-title font-semibold tnum">{value}</dd>
      </div>
      {sub && <dd className="text-ui text-faint">{sub}</dd>}
    </div>
  )
}

// Source download for everyone; cancel and delete for the agent's owner (and admins).
function Actions({ run, onChange }: { run: Run; onChange: () => void }) {
  const t = useT()
  const { me } = useMe()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      after()
    } catch (e) {
      setErr(errorText(e, t))
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }
  const mine = !!me && (me.can_admin || me.user.handle === run.agent.owner)
  if (!run.has_source && !mine) return null
  return (
    <div className="space-y-2">
      {run.has_source && (
        <Button variant="outline" className="w-full" render={<a href={`/api/v1/runs/${run.id}/source.zip`} />} nativeButton={false}>
          <Download /> {t('Скачать исходники (.zip)', 'Download sources (.zip)')}
        </Button>
      )}
      {mine && isActive(run) && (
        <Button variant="destructive" className="w-full" disabled={busy} onClick={() => void act(() => post(`/my/runs/${run.id}/cancel`), onChange)}>{t('Отменить прогон', 'Cancel run')}</Button>
      )}
      {me?.can_admin && !isActive(run) && run.has_snapshot && (
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => void act(() => post(`/admin/runs/${run.id}/recheck`), onChange)}>
          <RotateCw /> {t('Проверить заново', 'Check again')}
        </Button>
      )}
      {mine && !isActive(run) && (
        <Button variant="destructive" className="w-full" disabled={busy} onBlur={() => setArmed(false)}
          onClick={() => armed ? void act(() => del(`/my/runs/${run.id}`), () => router.push(`/t/${run.task}`)) : setArmed(true)}>
          {armed ? t('Нажмите ещё раз для подтверждения', 'Press again to confirm') : t('Удалить прогон', 'Delete run')}
        </Button>
      )}
      {err && <p role="alert" className="text-ui text-destructive">{err}</p>}
    </div>
  )
}

type CheckGroup = { key: string; label: string; hidden: boolean; items: { check: CheckResult; n: number; label: string }[] }

// The checks by what they test: a name "cart: add two" goes to "Cart"; the start and the page checks have no prefix,
// hidden checks ("hidden check 3") show no details. Groups come in the order their first check ran.
function groupChecks(checks: CheckResult[], t: T): CheckGroup[] {
  const groups = new Map<string, CheckGroup>()
  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  checks.forEach((check, i) => {
    const hidden = /^hidden check \d+$/.test(check.name)
    const m = hidden ? null : /^([^:]{1,40}):\s*(.+)$/.exec(check.name)
    const key = hidden ? '~hidden' : m ? m[1].toLowerCase() : '~app'
    let g = groups.get(key)
    if (!g) {
      g = { key, hidden, items: [], label: hidden ? t('Скрытые проверки', 'Hidden checks') : m ? upper(m[1]) : t('Запуск и страницы', 'Start and pages') }
      groups.set(key, g)
    }
    g.items.push({ check, n: i + 1, label: hidden ? `#${g.items.length + 1}` : upper(m ? m[2] : check.name) })
  })
  return [...groups.values()]
}

// A check that never ran its request: it needed a value (a user's token, an order id) an earlier failed check
// should have given. It still counts as failed, but the cause is above it.
const cascade = /^needs \w+, which an earlier check didn't get$/

// What the platform checked in the app, a line per group; a group with a failed check is open, with the reasons.
function Checks({ run }: { run: Run }) {
  const t = useT()
  const groups = groupChecks(run.checks, t)
  const passed = run.checks.filter((c) => c.passed).length
  const skipped = run.checks.filter((c) => !c.passed && cascade.test(c.detail ?? '')).length
  const voted = isVoted(run.task_kind)
  return (
    <section id="checks" className="scroll-mt-20">
      <SectionTitle count={`${passed}/${run.checks.length}`} aside={run.rechecks > 0
        ? t.plural(run.rechecks, ['Проверено заново {n} раз: тот же код, текущие проверки', 'Проверено заново {n} раза: тот же код, текущие проверки', 'Проверено заново {n} раз: тот же код, текущие проверки'], ['Checked again once: the same code, the current checks', 'Checked again {n} times: the same code, the current checks'])
        : <Link href="/how" className="hover:text-primary">{t('Как считаем', 'How we score')}</Link>}>{voted ? t('Входные проверки', 'Entry checks') : t('Проверки', 'Checks')}</SectionTitle>
      <p className="mb-4 max-w-[70ch] text-body text-muted-foreground">
        {voted
          ? t('Платформа запустила приложение на чистом сервере и посмотрела, что оно открывается и показывает данные. Эти проверки только допускают прогон в голосование и на место не влияют.',
            'The platform started the app on a fresh server and saw that it opens and shows the data. These checks only admit the run to the votes and don’t affect its rank.')
          : t('Платформа запустила приложение на чистом сервере, проверила его API и страницы, а потом прошла главные сценарии в браузере, как человек. Балл — половина доли пройденных проверок API и страниц плюс половина доли пройденных шагов в браузере.',
            'The platform started the app on a fresh server, checked its API and pages, then went through the main flows in a browser like a person. The score is half the share of API and page checks passed plus half the share of browser steps passed.')}
      </p>
      {skipped > 0 && (
        <p className="mb-3 flex items-start gap-2 text-ui text-faint">
          <Minus aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.plural(skipped, ['{n} проверка не дошла до запроса: ей нужен результат более ранней, которая не прошла (вход, корзина). Считается непройденной.', '{n} проверки не дошли до запроса: им нужен результат более ранней, которая не прошла (вход, корзина). Считаются непройденными.', '{n} проверок не дошли до запроса: им нужен результат более ранней, которая не прошла (вход, корзина). Считаются непройденными.'],
            ['{n} check was not reached: it needs the result of an earlier one that failed (sign-in, a cart). It counts as failed.', '{n} checks were not reached: they need the result of an earlier one that failed (sign-in, a cart). They count as failed.'])}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border-2 border-border">
        {groups.map((g) => {
          const ok = g.items.filter((it) => it.check.passed).length
          const all = ok === g.items.length
          return (
            <details key={g.key} open={!all} className="group not-first:border-t not-first:border-border">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden className="size-4 shrink-0 text-faint transition-transform group-open:rotate-90" />
                <span className="min-w-0 flex-1 truncate text-title">{g.label}</span>
                <span aria-hidden className="flex gap-[3px] max-sm:hidden">
                  {g.items.map((it) => <span key={it.n} className={cn('h-3 w-[5px] rounded-[1px]', it.check.passed ? 'bg-success' : 'bg-destructive')} />)}
                </span>
                <span className={cn('w-12 text-right text-body font-semibold tnum', all ? 'text-success' : 'text-destructive')}>{ok}/{g.items.length}</span>
              </summary>
              <ol className="pb-2">
                {g.items.map(({ check, n, label }) => {
                  const notReached = !check.passed && cascade.test(check.detail ?? '')
                  return (
                    <li key={n} className="flex items-start gap-3 py-1 pr-4 pl-11 text-body">
                      {check.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label={t('Пройдена', 'Passed')} />
                        : notReached ? <Minus className="mt-0.5 size-4 shrink-0 text-faint" aria-label={t('Не пройдена', 'Failed')} />
                        : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t('Не пройдена', 'Failed')} />}
                      <div className="min-w-0 flex-1">
                        <div className={cn(check.passed || notReached ? 'text-muted-foreground' : 'font-medium')}>
                          {label}{notReached && <span className="ml-2 text-ui text-faint">{t('не дошла', 'not reached')}</span>}
                        </div>
                        {!check.passed && !notReached && (g.hidden ? <div className="text-ui text-faint">{t('Подробности скрытых проверок не показываем', 'Hidden checks show no details')}</div>
                          : check.detail && <div className="font-mono text-meta break-words text-muted-foreground">{check.detail}</div>)}
                      </div>
                      <span className="shrink-0 text-meta text-faint tnum" title={t('Порядковый номер проверки в прогоне', 'The check’s place in the run')}>{n}</span>
                    </li>
                  )
                })}
              </ol>
            </details>
          )
        })}
      </div>
    </section>
  )
}

function Logs({ run }: { run: Run }) {
  const t = useT()
  return (
    <section className="space-y-2">
      {([['agent', t('Лог агента', 'Agent log'), run.agent_log], ['check', t('Лог проверки', 'Check log'), run.check_log]] as const).map(([k, title, text]) => (
        <details key={k} className="group overflow-hidden rounded-xl border-2 border-border" open={k === 'agent' && isActive(run)}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-title font-semibold transition-colors duration-150 hover:bg-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 text-faint transition-transform group-open:rotate-90" />
            {title}
          </summary>
          <pre className="max-h-[32rem] overflow-auto bg-terminal p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-terminal-foreground [overflow-wrap:anywhere]">
            {text || t('Пока пусто.', 'Empty so far.')}
          </pre>
        </details>
      ))}
    </section>
  )
}

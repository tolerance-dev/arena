'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Download, ExternalLink, Maximize2, Monitor, RotateCw, Smartphone, X } from 'lucide-react'
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
import type { Run } from '@/lib/types'
import { providerLabel } from '@/lib/providers'
import { useMe } from '@/lib/use-me'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, CheckStrip, exitLabel, isActive, phase, queueLine, scoreTone, Stack, StatusPill, taskTitle } from './bits'
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
            <Conditions run={run} />
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

// The result in one place: the score and every check as a cell.
function Verdict({ run }: { run: Run }) {
  const t = useT()
  const done = run.status === 'done'
  const passed = run.checks.filter((c) => c.passed).length
  const failed = run.checks.length - passed
  return (
    <section aria-label={t('Оценка', 'Score')} className="rounded-xl border-2 border-border p-5">
      <div className="text-body text-muted-foreground">{t('Оценка', 'Score')}</div>
      <div className={cn('numeral mt-2 text-[56px]', done && run.score != null ? scoreTone(run.score) : 'text-pending')}>
        {done && run.score != null ? run.score : '—'}
      </div>
      <p className="mt-2 text-ui text-faint">
        {!done ? t('Оценка появится, когда закончатся проверки.', 'The score appears once the checks finish.') : run.agent_exit === 'key_rejected' ? t('не оценивался: провайдер отклонил ключ', 'not scored: the provider rejected the key') : !run.app_started ? t('приложение не запустилось', 'the app didn’t start') : t('доля пройденных автопроверок', 'share of automatic checks passed')}
      </p>
      <div className="mt-5 border-t border-border pt-4">
        <div className="text-body font-semibold">
          {run.checks.length ? t.plural(run.checks.length, [`Пройдено ${passed} из {n} проверки`, `Пройдено ${passed} из {n} проверок`, `Пройдено ${passed} из {n} проверок`], [`${passed} of {n} check passed`, `${passed} of {n} checks passed`]) : done ? t('Проверки не запускались', 'The checks didn’t run') : t('Проверки начнутся, когда агент закончит', 'The checks start when the agent finishes')}
        </div>
        {failed > 0 && <p className="text-ui text-destructive">{t.plural(failed, ['{n} проверка не прошла', '{n} проверки не прошли', '{n} проверок не прошли'], ['{n} check failed', '{n} checks failed'])}</p>}
        <CheckStrip checks={run.checks} size="lg" className="mt-3" />
      </div>
    </section>
  )
}

// The run's numbers as label/value lines, like Product Hunt's "Company info".
function Numbers({ run }: { run: Run }) {
  const t = useT()
  const now = useNow()
  const used = usedTokens(run.tokens)
  const pct = Math.min(999, Math.round((100 * used) / Math.max(1, run.token_budget)))
  const done = run.status === 'done'
  const langs = Object.entries(run.stats.languages ?? {}).sort((a, b) => b[1] - a[1])
  const total = langs.reduce((s, [, n]) => s + n, 0)
  return (
    <AsideBlock title={t('Прогон', 'Run')}>
      <dl className="space-y-3">
        <Line label={t('Время агента', 'Agent time')} value={duration(agentElapsed(run, now))}
          sub={[t(`из ${duration(run.time_limit_s)}`, `of ${duration(run.time_limit_s)}`), run.agent_exit && exitLabel(run.agent_exit, t)].filter(Boolean).join(', ')} />
        <Line label={t('Токены', 'Tokens')} value={compact(used)}
          sub={<>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-pending">
              <span className={cn('block h-full', pct >= 100 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="mt-1 block">{t(`${pct}% бюджета, запросов к LLM: ${run.tokens.requests}`, `${pct}% of the budget, ${run.tokens.requests} LLM requests`)}</span>
            {used > run.token_budget && <span className="block text-destructive">{t('Больше бюджета: прогон не идёт в рейтинг', 'Over budget: the run isn’t ranked')}</span>}
            {used > 0 && <span className="block">{t(`${compact(run.tokens.in + run.tokens.cache_write)} вход · ${compact(run.tokens.out)} выход · ${compact(run.tokens.cache_read)} из кэша`, `${compact(run.tokens.in + run.tokens.cache_write)} in · ${compact(run.tokens.out)} out · ${compact(run.tokens.cache_read)} cached`)}</span>}
          </>} />
        <Line label={t('Стоимость', 'Cost')} value={run.cost_usd == null ? '—' : usd(run.cost_usd)}
          sub={run.cost_usd == null ? t('модель неизвестна', 'unknown model') : run.agent.provider.endsWith('-sub') ? t('подписка, по прайсу', 'subscription, at list price') : undefined} />
        <Line label={t('Строк кода', 'Lines of code')} value={done ? t.num(run.stats.loc) : '—'} sub={done ? t(`файлов: ${run.stats.files}`, `${run.stats.files} files`) : undefined} />
        <Line label={t('Старт за', 'Started in')} value={run.stats.start_seconds ? `${run.stats.start_seconds} s` : '—'} />
      </dl>
      {total > 0 && (
        <div className="mt-4">
          <div className="text-ui text-faint">{t('Языки', 'Languages')}</div>
          <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full">
            {langs.map(([l, n], i) => <div key={l} style={{ width: `${(100 * n) / total}%`, background: `var(--series-${(i % 4) + 1})` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui">
            {langs.map(([l, n], i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: `var(--series-${(i % 4) + 1})` }} />
                <span className="font-medium">{l}</span><span className="text-faint tnum">{t.num(n)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </AsideBlock>
  )
}

// What the run was fixed to at creation (its manifest), so results are compared under the same conditions.
function Conditions({ run }: { run: Run }) {
  const t = useT()
  const m = run.manifest
  const short = (h?: string) => (h ?? '').replace(/^sha256:/, '').slice(0, 8)
  const models = Object.entries(run.models ?? {}).sort((a, b) => b[1] - a[1])
  const versions = Object.entries(m.runtime?.versions ?? {})
  const checks = run.checks_version ?? m.checks_version
  return (
    <AsideBlock title={t('Условия прогона', 'Run conditions')}>
      <dl className="space-y-2 text-ui">
        <Fixed label={t('Агент', 'Agent')} value={short(m.bundle_sha256)} />
        <Fixed label={t('Ключ', 'Key')} value={providerLabel(m.provider, t)} mono={false} sub={t('ключ можно сменить на ключ того же провайдера', 'the key can be swapped for another key of the same provider')} />
        <Fixed label={t('Модель', 'Model')} value={m.model_id || t('выбирает агент', 'the agent picks')} mono={!!m.model_id} />
        {models.length > 0 && (
          <Fixed label={t('Вызывал', 'Called')} value={models.length === 1 ? models[0][0] : t.plural(models.length, ['{n} модель', '{n} модели', '{n} моделей'], ['{n} model', '{n} models'])}
            sub={models.length > 1 ? models.map(([id, n]) => `${id} ×${n}`).join(', ') : t(`запросов: ${models[0][1]}`, `${models[0][1]} requests`)} />
        )}
        <Fixed label={t('Задание', 'Task')} value={short(m.task_md_sha256)} sub={t(`данные ${short(m.data_sha256)}`, `data ${short(m.data_sha256)}`)} />
        <Fixed label={t('Проверки', 'Checks')} value={checks} sub={[
          checks !== m.checks_version && t(`при создании ${m.checks_version}`, `at creation ${m.checks_version}`),
          run.checks_version && !run.checks_current && t('устарели: прогон не в рейтинге', 'outdated: the run isn’t ranked'),
          t(`оценка v${m.scoring_version}`, `scoring v${m.scoring_version}`),
        ].filter(Boolean).join(', ')} />
        <Fixed label={t('Среда', 'Runtime')} value={m.runtime ? short(m.runtime.image) : '—'} sub={versions.map(([k, v]) => `${k} ${v}`).join(', ') || undefined} />
      </dl>
    </AsideBlock>
  )
}

function Fixed({ label, value, sub, mono = true }: { label: string; value: React.ReactNode; sub?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="shrink-0 text-muted-foreground">{label}</dt>
        <dd className={cn('min-w-0 truncate text-right font-medium', mono && 'font-mono text-meta')}>{value}</dd>
      </div>
      {sub && <dd className="text-faint break-words">{sub}</dd>}
    </div>
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

// Every check in the order it ran, numbered like the cells of the strip in the aside.
function Checks({ run }: { run: Run }) {
  const t = useT()
  return (
    <section>
      <SectionTitle aside={run.rechecks > 0
        ? t.plural(run.rechecks, ['Проверено заново {n} раз: тот же код, текущие проверки', 'Проверено заново {n} раза: тот же код, текущие проверки', 'Проверено заново {n} раз: тот же код, текущие проверки'], ['Checked again once: the same code, the current checks', 'Checked again {n} times: the same code, the current checks'])
        : t('В том порядке, в каком шли на одном свежем сервере', 'In the order they ran on one fresh server')}>{t('Автоматические проверки', 'Automatic checks')}</SectionTitle>
      <ol className="overflow-hidden rounded-xl border-2 border-border">
        {run.checks.map((c, i) => (
          <li key={`${i}-${c.name}`} className={cn('flex items-start gap-3 px-4 py-2.5 text-title not-first:border-t not-first:border-border', !c.passed && 'bg-destructive/5')}>
            <span className="w-5 shrink-0 text-right text-faint tnum">{i + 1}</span>
            {c.passed ? <Check className="mt-1 size-4 shrink-0 text-success" aria-label={t('Пройдена', 'Passed')} /> : <X className="mt-1 size-4 shrink-0 text-destructive" aria-label={t('Не пройдена', 'Failed')} />}
            <div className="min-w-0">
              <div className={cn(!c.passed && 'font-semibold')}>{c.name}</div>
              {!c.passed && c.detail && <div className="mt-0.5 font-mono text-meta break-words text-muted-foreground">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
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

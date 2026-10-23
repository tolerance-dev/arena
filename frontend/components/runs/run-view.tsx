'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Download, ExternalLink, Maximize2, X } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Button } from '@/components/ui/button'
import { AsideBlock, Columns } from '@/components/ui/columns'
import { EmptyState, Skeleton } from '@/components/ui/empty-state'
import { Meta } from '@/components/ui/feed'
import { PillTabs } from '@/components/ui/pill-tabs'
import { del, post } from '@/lib/api'
import { compact, duration, grouped, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { AgentAvatar, Ago, CheckStrip, exitLabel, isActive, providerLabel, scoreTone, StatusPill, taskTitle, usePoll, type RT } from './bits'
import { TaskGlyph } from './task-glyph'
import { agentElapsed, useNow } from './live-runs'

// One submission, laid out like a Product Hunt product page: what the agent built is the centrepiece, the verdict and
// the run's numbers sit in the aside.
export function RunView({ id }: { id: string }) {
  const t = useT(runsMessages)
  const { data: run, error, reload } = usePoll<Run>(`/runs/${encodeURIComponent(id)}`, 3_000, isActive)
  if (error?.status === 404) return <EmptyState>{t('runMissing')}</EmptyState>
  if (!run) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-[28rem]" /></div>
  const done = run.status === 'done'
  const platformFailed = run.status === 'infra_error' && run.failure_reason !== 'cancelled'

  return (
    <div>
      <Breadcrumbs items={[
        { label: t('challengesTitle'), href: '/' },
        { label: <><TaskGlyph slug={run.task} className="size-3.5" />{taskTitle(run.task, t.locale)}</>, href: `/t/${run.task}` },
        { label: run.agent.name },
      ]} />
      <Columns className="mt-6"
        main={
          <div className="space-y-10">
            <Header run={run} t={t} />
            {/* Below 1280px the aside drops under the page; the verdict stays up here so it is seen first. */}
            <div className="xl:hidden"><Verdict run={run} t={t} /></div>
            {!done && <Timeline run={run} t={t} />}
            {platformFailed && (
              <p role="alert" className="rounded-xl border-2 border-destructive/20 bg-destructive/5 px-4 py-3 text-body text-destructive">{t('failure', { reason: run.failure_reason ?? '?' })}</p>
            )}
            {done && <Preview run={run} t={t} />}
            {done && run.judge && run.judge.status !== 'off' && <JudgeCard run={run} t={t} />}
            {run.checks.length > 0 && <Checks run={run} t={t} />}
            <Logs run={run} t={t} />
          </div>
        }
        aside={
          <>
            <div className="max-xl:hidden"><Verdict run={run} t={t} /></div>
            <Numbers run={run} t={t} />
            <Actions run={run} t={t} onChange={() => void reload()} />
          </>
        }
      />
    </div>
  )
}

function Header({ run, t }: { run: Run; t: RT }) {
  return (
    <header className="flex items-start gap-4">
      <AgentAvatar name={run.agent.name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="display text-page break-words">{run.agent.name}</h1>
        <p className="text-subtitle text-muted-foreground">
          <Link href={`/t/${run.task}`} className="transition-colors hover:text-primary">{taskTitle(run.task, t.locale)}</Link>
        </p>
        <Meta className="mt-1" items={[
          <StatusPill key="s" run={run} className="align-middle" />,
          t('by', { owner: run.agent.owner }),
          providerLabel(run.agent.provider),
          <Ago key="a" iso={run.created_at} />,
        ]} />
        {run.agent.description && <p className="mt-3 max-w-[70ch] text-title text-muted-foreground">{run.agent.description}</p>}
      </div>
    </header>
  )
}

// Where the run is now. Shown only until it finishes; the verdict takes over after that.
function Timeline({ run, t }: { run: Run; t: RT }) {
  const now = useNow()
  const order = ['queued', 'agent', 'checking', 'done']
  const at = run.status === 'infra_error' ? -1 : order.indexOf(run.status)
  const labels = [t('step1'), t('step2'), t('step3'), t('step4')]
  return (
    <div>
    <ol className="grid grid-cols-4 gap-1.5" aria-label={t('timeline')}>
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
        <span className="font-semibold">{t(`phase.${run.status}` as 'phase.agent')}</span>
        {run.status === 'agent' && <span className="text-muted-foreground tnum"> · {t('elapsedOf', { t: duration(agentElapsed(run, now)), limit: duration(run.time_limit_s) })}</span>}
      </p>
    )}
    </div>
  )
}

// The live app (or its screenshots once the snapshot is gone), as large as the column allows.
function Preview({ run, t }: { run: Run; t: RT }) {
  const [view, setView] = useState<'live' | 'desktop' | 'mobile'>(run.preview_url ? 'live' : 'desktop')
  const frame = useRef<HTMLDivElement>(null)
  const tabs = [
    { value: 'live' as const, label: t('livePreview'), show: !!run.preview_url },
    { value: 'desktop' as const, label: t('desktop'), show: run.has_shot },
    { value: 'mobile' as const, label: t('mobile'), show: run.has_shot_mobile },
  ].filter((x) => x.show)
  if (tabs.length === 0) return <EmptyState>{t('noPreview')}</EmptyState>
  return (
    <section aria-label={t('whatItBuilt')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PillTabs value={view} onChange={setView} options={tabs} />
        {view === 'live' && run.preview_url && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void frame.current?.requestFullscreen?.()}>
              <Maximize2 /> {t('fullscreen')}
            </Button>
            <Button variant="outline" size="sm" render={<a href={run.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
              <ExternalLink /> {t('openPreview')}
            </Button>
          </div>
        )}
      </div>
      {view === 'live' && run.preview_url && (
        <>
          <div ref={frame} className="overflow-hidden rounded-xl border-2 border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
              <span aria-hidden className="flex gap-1.5"><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /></span>
              <span className="truncate font-mono text-meta text-faint">{run.preview_url}</span>
            </div>
            <iframe src={run.preview_url} title={t('livePreview')} className="block h-[72vh] min-h-[460px] w-full bg-white [:fullscreen_&]:h-[calc(100vh-37px)]"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          </div>
          <p className="mt-2 text-ui text-faint">{t('previewHint')}</p>
        </>
      )}
      {view === 'desktop' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot.jpg`} alt={t('desktop')} className="w-full rounded-xl border-2 border-border" />
      )}
      {view === 'mobile' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot-mobile.jpg`} alt={t('mobile')} className="mx-auto w-full max-w-[390px] rounded-xl border-2 border-border" />
      )}
    </section>
  )
}

// The result in one place: the score and every check as a cell.
function Verdict({ run, t }: { run: Run; t: RT }) {
  const done = run.status === 'done'
  const passed = run.checks.filter((c) => c.passed).length
  const judged = run.judge?.status === 'ok'
  const failed = run.checks.length - passed
  return (
    <section aria-label={t('score')} className="rounded-xl border-2 border-border p-5">
      <div className="text-body text-muted-foreground">{t('score')}</div>
      <div className={cn('numeral mt-2 text-[56px]', done && run.score != null ? scoreTone(run.score) : 'text-pending')}>
        {done && run.score != null ? run.score : '—'}
      </div>
      <p className="mt-2 text-ui text-faint">
        {!done ? t('scorePending') : !run.app_started ? t('scoreNoStart') : judged ? (run.judge?.manipulation ? t('scoreManipulation') : t('scoreFormula'))
          : run.score == null ? t('scoreNoVerdict') : t('scoreChecksOnly')}
      </p>
      <div className="mt-5 border-t border-border pt-4">
        <div className="text-body font-semibold">
          {run.checks.length ? t.plural('checksPassed', run.checks.length, { ok: passed }) : done ? t('noChecks') : t('checksPending')}
        </div>
        {failed > 0 && <p className="text-ui text-destructive">{t.plural('failedChecks', failed)}</p>}
        <CheckStrip checks={run.checks} size="lg" className="mt-3" />
      </div>
    </section>
  )
}

// The run's numbers as label/value lines, like Product Hunt's "Company info".
function Numbers({ run, t }: { run: Run; t: RT }) {
  const now = useNow()
  const used = usedTokens(run.tokens)
  const pct = Math.min(999, Math.round((100 * used) / Math.max(1, run.token_budget)))
  const done = run.status === 'done'
  const langs = Object.entries(run.stats.languages ?? {}).sort((a, b) => b[1] - a[1])
  const total = langs.reduce((s, [, n]) => s + n, 0)
  return (
    <AsideBlock title={t('runInfoTitle')}>
      <dl className="space-y-3">
        <Line label={t('metricTime')} value={duration(agentElapsed(run, now))}
          sub={[t('metricOf', { limit: duration(run.time_limit_s) }), run.agent_exit && exitLabel(t, run.agent_exit)].filter(Boolean).join(', ')} />
        <Line label={t('metricTokens')} value={compact(used)}
          sub={<>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-pending">
              <span className={cn('block h-full', pct >= 100 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="mt-1 block">{t('metricBudget', { pct })}, {t('metricRequests', { n: run.tokens.requests })}</span>
            {used > 0 && <span className="block">{t('metricTokensDetail', { in: compact(run.tokens.in + run.tokens.cache_write), out: compact(run.tokens.out), cached: compact(run.tokens.cache_read) })}</span>}
          </>} />
        <Line label={t('metricLoc')} value={done ? grouped(run.stats.loc, t.locale) : '—'} sub={done ? t('metricFiles', { n: run.stats.files }) : undefined} />
        <Line label={t('metricStart')} value={run.stats.start_seconds ? `${run.stats.start_seconds} s` : '—'} />
      </dl>
      {total > 0 && (
        <div className="mt-4">
          <div className="text-ui text-faint">{t('languages')}</div>
          <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full">
            {langs.map(([l, n], i) => <div key={l} style={{ width: `${(100 * n) / total}%`, background: `var(--series-${(i % 4) + 1})` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui">
            {langs.map(([l, n], i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: `var(--series-${(i % 4) + 1})` }} />
                <span className="font-medium">{l}</span><span className="text-faint tnum">{grouped(n, t.locale)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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
function Actions({ run, t, onChange }: { run: Run; t: RT; onChange: () => void }) {
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
      setErr(errorText(e, t.locale))
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
          <Download /> {t('downloadSource')}
        </Button>
      )}
      {mine && isActive(run) && (
        <Button variant="destructive" className="w-full" disabled={busy} onClick={() => void act(() => post(`/my/runs/${run.id}/cancel`), onChange)}>{t('cancelRun')}</Button>
      )}
      {mine && !isActive(run) && (
        <Button variant="destructive" className="w-full" disabled={busy} onBlur={() => setArmed(false)}
          onClick={() => armed ? void act(() => del(`/my/runs/${run.id}`), () => router.push(`/t/${run.task}`)) : setArmed(true)}>
          {armed ? t('confirmAgain') : t('deleteRun')}
        </Button>
      )}
      {err && <p role="alert" className="text-ui text-destructive">{err}</p>}
    </div>
  )
}

function JudgeCard({ run, t }: { run: Run; t: RT }) {
  const j = run.judge!
  return (
    <section>
      <SectionTitle>{t('judgeTitle')}</SectionTitle>
      {j.status !== 'ok' ? (
        <p className="rounded-xl border-2 border-border px-4 py-3 text-body text-muted-foreground">
          {j.status === 'skipped' ? t('judgeSkipped', { reason: j.error ?? '' }) : t('judgeError', { reason: j.error ?? '' })}
        </p>
      ) : (
        <div className="rounded-xl border-2 border-border">
          {j.manipulation && (
            <p className="border-b border-destructive/30 bg-destructive/8 px-5 py-3 text-body text-destructive">{t('judgeManipulation', { what: j.manipulation })}</p>
          )}
          <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-start sm:gap-6">
            <div className={cn('numeral text-[40px]', scoreTone(j.score))}>{j.score}</div>
            <div className="min-w-0">
              <p className="text-title leading-relaxed">{j.summary}</p>
              <p className="mt-2 text-ui text-faint">
                {t('judgeMeta', { model: j.model ?? '', steps: j.steps ?? 0, tokens: compact(run.judge_tokens.in + run.judge_tokens.out) })}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {(j.criteria ?? []).map((c) => (
              <li key={c.title} className="grid gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <div className="flex items-baseline justify-between gap-2 font-semibold">
                    <span>{c.title}</span>
                    <span className="text-body tnum">{c.points}/{c.max}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pending">
                    <div className={cn('h-full', c.points >= c.max * 0.75 ? 'bg-success' : c.points >= c.max * 0.4 ? 'bg-warning' : 'bg-destructive')}
                      style={{ width: `${(100 * c.points) / Math.max(1, c.max)}%` }} />
                  </div>
                </div>
                <p className="text-body leading-relaxed text-muted-foreground">{c.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Every check in the order it ran, numbered like the cells of the strip in the aside.
function Checks({ run, t }: { run: Run; t: RT }) {
  return (
    <section>
      <SectionTitle aside={t('checksOrderHint')}>{t('checksTitle')}</SectionTitle>
      <ol className="overflow-hidden rounded-xl border-2 border-border">
        {run.checks.map((c, i) => (
          <li key={`${i}-${c.name}`} className={cn('flex items-start gap-3 px-4 py-2.5 text-title not-first:border-t not-first:border-border', !c.passed && 'bg-destructive/5')}>
            <span className="w-5 shrink-0 text-right text-faint tnum">{i + 1}</span>
            {c.passed ? <Check className="mt-1 size-4 shrink-0 text-success" aria-label={t('passed')} /> : <X className="mt-1 size-4 shrink-0 text-destructive" aria-label={t('failed')} />}
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

function Logs({ run, t }: { run: Run; t: RT }) {
  return (
    <section className="space-y-2">
      {([['agentLog', run.agent_log], ['checkLog', run.check_log]] as const).map(([k, text]) => (
        <details key={k} className="group overflow-hidden rounded-xl border-2 border-border" open={k === 'agentLog' && isActive(run)}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-title font-semibold transition-colors duration-150 hover:bg-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 text-faint transition-transform group-open:rotate-90" />
            {t(k)}
          </summary>
          <pre className="max-h-[32rem] overflow-auto bg-terminal p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-terminal-foreground [overflow-wrap:anywhere]">
            {text || t('emptyLog')}
          </pre>
        </details>
      ))}
    </section>
  )
}

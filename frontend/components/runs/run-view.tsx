'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Download, ExternalLink, X } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { del, post } from '@/lib/api'
import { compact, duration, grouped, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { Ago, CheckStrip, exitLabel, isActive, scoreTone, StatusPill, taskTitle, usePoll, type RT } from './bits'
import { TaskGlyph } from './task-glyph'

export function RunView({ id }: { id: string }) {
  const t = useT(runsMessages)
  const { data: run, error, reload } = usePoll<Run>(`/runs/${encodeURIComponent(id)}`, 3_000, isActive)
  if (error?.status === 404) return <p className="text-muted-foreground">{t('runMissing')}</p>
  if (!run) return <div className="h-96 animate-pulse rounded-lg bg-muted" />
  const done = run.status === 'done'
  const platformFailed = run.status === 'infra_error' && run.failure_reason !== 'cancelled'

  return (
    <div className="space-y-10">
      <Header run={run} t={t} onChange={() => void reload()} />
      {!done && <Timeline run={run} t={t} />}
      {platformFailed && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">{t('failure', { reason: run.failure_reason ?? '?' })}</p>
      )}
      <Verdict run={run} t={t} />
      {/* What the agent built, right under the verdict: the live app, or its screenshots once the snapshot is gone. */}
      {done && (run.preview_url || run.has_shot) && <Preview run={run} t={t} />}
      <Specs run={run} t={t} />
      {done && run.judge && run.judge.status !== 'off' && <JudgeCard run={run} t={t} />}
      {run.checks.length > 0 && <Checks run={run} t={t} />}
      <Logs run={run} t={t} />
    </div>
  )
}

function Header({ run, t, onChange }: { run: Run; t: RT; onChange: () => void }) {
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
  return (
    <header>
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">{t('tasksTitle')}</Link>
        <span aria-hidden>/</span>
        <Link href={`/t/${run.task}`} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
          <TaskGlyph slug={run.task} className="size-4" />{taskTitle(run.task, t.locale)}
        </Link>
      </nav>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="display text-[2.1rem] break-words sm:text-[2.75rem]">{run.agent.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <StatusPill run={run} />
            <span>{t('by', { owner: run.agent.owner })}</span>
            <span>{run.agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</span>
            <span><Ago iso={run.created_at} /></span>
          </div>
          {run.agent.description && <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{run.agent.description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {run.has_source && (
            <Button variant="outline" render={<a href={`/api/v1/runs/${run.id}/source.zip`} />} nativeButton={false}>
              <Download /> {t('downloadSource')}
            </Button>
          )}
          {me?.can_admin && isActive(run) && (
            <Button variant="destructive" disabled={busy} onClick={() => void act(() => post(`/admin/runs/${run.id}/cancel`), onChange)}>{t('cancelRun')}</Button>
          )}
          {me?.can_admin && !isActive(run) && (
            <Button variant="destructive" disabled={busy} onBlur={() => setArmed(false)}
              onClick={() => armed ? void act(() => del(`/admin/runs/${run.id}`), () => router.push(`/t/${run.task}`)) : setArmed(true)}>
              {armed ? t('confirmAgain') : t('deleteRun')}
            </Button>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
    </header>
  )
}

// Where the run is now. Shown only until it finishes; the verdict takes over after that.
function Timeline({ run, t }: { run: Run; t: RT }) {
  const order = ['queued', 'agent', 'checking', 'done']
  const at = run.status === 'infra_error' ? -1 : order.indexOf(run.status)
  const labels = [t('step1'), t('step2'), t('step3'), t('step4')]
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={t('timeline')}>
      {labels.map((label, i) => {
        const state = at === -1 ? 'off' : i < at ? 'past' : i === at ? 'now' : 'next'
        return (
          <li key={label} className="min-w-0" aria-current={state === 'now' ? 'step' : undefined}>
            <div className={cn('h-1 bg-pending', state === 'past' && 'bg-foreground', state === 'now' && 'animate-status-pulse bg-primary')} />
            <div className={cn('mt-2 truncate text-xs', state === 'now' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{label}</div>
          </li>
        )
      })}
    </ol>
  )
}

// The result in one place: the score and every check as a cell.
function Verdict({ run, t }: { run: Run; t: RT }) {
  const done = run.status === 'done'
  const passed = run.checks.filter((c) => c.passed).length
  const judged = run.judge?.status === 'ok'
  const failed = run.checks.length - passed
  return (
    <section aria-label={t('score')} className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-[minmax(12rem,auto)_minmax(0,1fr)]">
      <div className="border-border p-6 max-sm:border-b sm:border-r sm:px-8">
        <div className="text-sm text-muted-foreground">{t('score')}</div>
        <div className={cn('numeral mt-3 text-[5.5rem]', done && run.score != null ? scoreTone(run.score) : 'text-pending')}>
          {done && run.score != null ? run.score : '—'}
        </div>
        <p className="mt-3 max-w-[22ch] text-xs leading-relaxed text-muted-foreground">
          {!done ? t('scorePending') : !run.app_started ? t('scoreNoStart') : judged ? t('scoreFormula') : t('scoreChecksOnly')}
        </p>
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-6 p-6 sm:px-8">
        <div>
          <div className="text-sm text-muted-foreground">{t('checksTitle')}</div>
          <div className="heading mt-2 text-[1.35rem]">
            {run.checks.length ? t.plural('checksPassed', run.checks.length, { ok: passed }) : done ? t('noChecks') : t('checksPending')}
          </div>
          {failed > 0 && <p className="mt-1 text-sm text-destructive">{t.plural('failedChecks', failed)}</p>}
        </div>
        <CheckStrip checks={run.checks} size="lg" />
      </div>
    </section>
  )
}

function Specs({ run, t }: { run: Run; t: RT }) {
  const used = usedTokens(run.tokens)
  const pct = Math.min(999, Math.round((100 * used) / Math.max(1, run.token_budget)))
  const done = run.status === 'done'
  const langs = Object.entries(run.stats.languages ?? {}).sort((a, b) => b[1] - a[1])
  const total = langs.reduce((s, [, n]) => s + n, 0)
  return (
    <section className="border-y border-border">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 py-5 lg:grid-cols-4">
        <Spec label={t('metricLoc')} value={done ? grouped(run.stats.loc, t.locale) : '—'} sub={done ? t('metricFiles', { n: run.stats.files }) : undefined} />
        <Spec label={t('metricTime')} value={duration(run.agent_seconds)}
          sub={[t('metricOf', { limit: duration(run.time_limit_s) }), run.agent_exit && exitLabel(t, run.agent_exit)].filter(Boolean).join(', ')} />
        <Spec label={t('metricTokens')} value={compact(used)}
          sub={
            <>
              <span className="mt-2 block h-1 overflow-hidden bg-pending">
                <span className={cn('block h-full', pct >= 100 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
              </span>
              <span className="mt-1.5 block">{t('metricBudget', { pct })}, {t('metricRequests', { n: run.tokens.requests })}</span>
            </>
          } />
        <Spec label={t('metricStart')} value={run.stats.start_seconds ? `${run.stats.start_seconds} s` : '—'}
          sub={used > 0 ? t('metricTokensDetail', { in: compact(run.tokens.in + run.tokens.cache_write), out: compact(run.tokens.out), cached: compact(run.tokens.cache_read) }) : undefined} />
      </dl>
      {total > 0 && (
        <div className="border-t border-border py-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="text-xs text-muted-foreground">{t('languages')}</div>
          </div>
          <div className="mt-2 flex h-1.5 gap-px overflow-hidden">
            {langs.map(([l, n], i) => <div key={l} style={{ width: `${(100 * n) / total}%`, background: `var(--series-${(i % 4) + 1})` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {langs.map(([l, n], i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2" style={{ background: `var(--series-${(i % 4) + 1})` }} />
                <span className="font-medium">{l}</span><span className="text-muted-foreground tnum">{grouped(n, t.locale)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Spec({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[1.6rem] leading-none font-medium tracking-[-0.02em] tnum">{value}</dd>
      {sub && <dd className="mt-1.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  )
}

function Preview({ run, t }: { run: Run; t: RT }) {
  const [view, setView] = useState<'live' | 'desktop' | 'mobile'>(run.preview_url ? 'live' : 'desktop')
  const tabs: { k: typeof view; label: string; show: boolean }[] = [
    { k: 'live', label: t('preview'), show: !!run.preview_url },
    { k: 'desktop', label: t('desktop'), show: run.has_shot },
    { k: 'mobile', label: t('mobile'), show: run.has_shot_mobile },
  ]
  if (!tabs.some((x) => x.show)) return <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noPreview')}</p>
  return (
    <section aria-label={t('whatItBuilt')}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" className="flex gap-4 text-sm">
          {tabs.filter((x) => x.show).map((x) => (
            <button key={x.k} role="tab" aria-selected={view === x.k} onClick={() => setView(x.k)}
              className={cn('border-b-2 pb-1 font-medium', view === x.k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{x.label}</button>
          ))}
        </div>
        {run.preview_url && (
          <Button variant="outline" size="sm" render={<a href={run.preview_url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> {t('openPreview')}
          </Button>
        )}
      </div>
      {view === 'live' && run.preview_url && (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted px-3 py-2">
              <span className="truncate font-mono text-xs text-muted-foreground">{run.preview_url}</span>
            </div>
            <iframe src={run.preview_url} title={t('preview')} className="block h-[70vh] min-h-[420px] w-full bg-white"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('previewHint')}</p>
        </>
      )}
      {view === 'desktop' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot.jpg`} alt={t('desktop')} className="w-full rounded-lg border border-border" />
      )}
      {view === 'mobile' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot-mobile.jpg`} alt={t('mobile')} className="mx-auto w-full max-w-[390px] rounded-[1.5rem] border-8 border-ink" />
      )}
    </section>
  )
}

function JudgeCard({ run, t }: { run: Run; t: RT }) {
  const j = run.judge!
  return (
    <section>
      <SectionTitle>{t('judgeTitle')}</SectionTitle>
      {j.status !== 'ok' ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {j.status === 'skipped' ? t('judgeSkipped', { reason: j.error ?? '' }) : t('judgeError', { reason: j.error ?? '' })}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-start sm:gap-6">
            <div className={cn('numeral text-[3rem]', scoreTone(j.score))}>{j.score}</div>
            <div className="min-w-0">
              <p className="leading-relaxed">{j.summary}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('judgeMeta', { model: j.model ?? '', steps: j.steps ?? 0, tokens: compact(run.judge_tokens.in + run.judge_tokens.out) })}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {(j.criteria ?? []).map((c) => (
              <li key={c.title} className="grid gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <div className="flex items-baseline justify-between gap-2 font-medium">
                    <span>{c.title}</span>
                    <span className="text-sm tnum">{c.points}/{c.max}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden bg-pending">
                    <div className={cn('h-full', c.points >= c.max * 0.75 ? 'bg-success' : c.points >= c.max * 0.4 ? 'bg-warning' : 'bg-destructive')}
                      style={{ width: `${(100 * c.points) / Math.max(1, c.max)}%` }} />
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{c.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Every check in the order it ran, numbered like the cells of the strip above.
function Checks({ run, t }: { run: Run; t: RT }) {
  return (
    <section>
      <SectionTitle aside={t('checksOrderHint')}>{t('checksTitle')}</SectionTitle>
      <ol className="grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2">
        {run.checks.map((c, i) => (
          <li key={`${i}-${c.name}`}
            className={cn('flex items-start gap-3 border-border px-4 py-2.5 text-sm max-md:not-first:border-t md:nth-[n+3]:border-t md:even:border-l',
              !c.passed && 'bg-destructive/6')}>
            <span className="w-5 shrink-0 text-right text-muted-foreground tnum">{i + 1}</span>
            {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label={t('passed')} /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t('failed')} />}
            <div className="min-w-0">
              <div className={cn(!c.passed && 'font-medium')}>{c.name}</div>
              {!c.passed && c.detail && <div className="mt-0.5 font-mono text-xs break-words text-muted-foreground">{c.detail}</div>}
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
        <details key={k} className="group overflow-hidden rounded-lg border border-border bg-card" open={k === 'agentLog' && isActive(run)}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
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

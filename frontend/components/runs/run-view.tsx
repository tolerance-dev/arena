'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Download, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { del, post } from '@/lib/api'
import { compact, duration, grouped, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n/client'
import { errorText } from '@/lib/i18n/messages/errors'
import { runsMessages } from '@/lib/i18n/messages/runs'
import type { Run } from '@/lib/types'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { exitLabel, isActive, ScoreBadge, StatusPill, TASK_ACCENT, taskTitle, usePoll, type RT } from './bits'

export function RunView({ id }: { id: string }) {
  const t = useT(runsMessages)
  const { data: run, error, reload } = usePoll<Run>(`/runs/${encodeURIComponent(id)}`, 3_000, isActive)
  if (error?.status === 404) return <p className="text-muted-foreground">404</p>
  if (!run) return <div className="h-96 animate-pulse rounded-2xl bg-muted" />
  const done = run.status === 'done'

  return (
    <div className="space-y-10">
      <Header run={run} t={t} onChange={() => void reload()} />
      <Timeline run={run} t={t} />
      {run.status === 'infra_error' && run.failure_reason !== 'cancelled' && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{t('failure', { reason: run.failure_reason ?? '?' })}</p>
      )}
      <Metrics run={run} t={t} />
      {done && <Preview run={run} t={t} />}
      {done && run.judge && run.judge.status !== 'off' && <JudgeCard run={run} t={t} />}
      {done && <Checks run={run} t={t} />}
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
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <Link href={`/t/${run.task}`} className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <span className="size-2.5 rounded-full" style={{ background: TASK_ACCENT[run.task] }} />
          {t('runKicker', { task: taskTitle(run.task, t.locale) })}
        </Link>
        <h1 className="display text-[2.1rem] break-words sm:text-[2.75rem]">{run.agent.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <StatusPill run={run} />
          <span>{t('by', { owner: run.agent.owner })}</span>
          {run.agent.description && <span>· {run.agent.description}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {me?.can_admin && isActive(run) && (
          <Button variant="destructive" disabled={busy} onClick={() => void act(() => post(`/admin/runs/${run.id}/cancel`), onChange)}>{t('cancelRun')}</Button>
        )}
        {me?.can_admin && !isActive(run) && (
          <Button variant="destructive" disabled={busy}
            onClick={() => armed ? void act(() => del(`/admin/runs/${run.id}`), () => router.push(`/t/${run.task}`)) : setArmed(true)}>
            {armed ? t('confirmAgain') : t('deleteRun')}
          </Button>
        )}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </header>
  )
}

function Timeline({ run, t }: { run: Run; t: RT }) {
  const order = ['queued', 'agent', 'checking', 'done']
  const at = run.status === 'infra_error' ? -1 : order.indexOf(run.status)
  const labels = [t('step1'), t('step2'), t('step3'), t('step4')]
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={t('timeline')}>
      {labels.map((label, i) => {
        const state = at === -1 ? 'off' : i < at || run.status === 'done' ? 'past' : i === at ? 'now' : 'next'
        return (
          <li key={label} className="min-w-0">
            <div className={cn('h-1.5 rounded-full bg-muted', state === 'past' && 'bg-success', state === 'now' && 'animate-status-pulse bg-primary')} />
            <div className={cn('mt-2 truncate text-xs font-semibold', state === 'now' ? 'text-foreground' : 'text-muted-foreground')}>{label}</div>
          </li>
        )
      })}
    </ol>
  )
}

function Tile({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Metrics({ run, t }: { run: Run; t: RT }) {
  const used = usedTokens(run.tokens)
  const pct = Math.min(999, Math.round((100 * used) / Math.max(1, run.token_budget)))
  const passed = run.checks.filter((c) => c.passed).length
  const done = run.status === 'done'
  const judged = run.judge?.status === 'ok'
  const langs = Object.entries(run.stats.languages ?? {}).sort((a, b) => b[1] - a[1])
  const total = langs.reduce((s, [, n]) => s + n, 0)
  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 sm:col-span-2 lg:col-span-1">
          <ScoreBadge score={done ? run.score : null} size="lg" />
          <div>
            <div className="text-xs font-semibold text-muted-foreground">{t('score')}</div>
            <div className="mt-1 text-sm">{!done ? '—' : !run.app_started ? t('scoreNoStart') : judged ? t('scoreFormula') : t('scoreChecksOnly')}</div>
          </div>
        </div>
        <Tile label={t('metricLoc')} value={done ? grouped(run.stats.loc, t.locale) : '—'} sub={done ? t('metricFiles', { n: run.stats.files }) : undefined} />
        <Tile label={t('metricTime')} value={duration(run.agent_seconds)}
          sub={<>{t('metricOf', { limit: duration(run.time_limit_s) })}{run.agent_exit ? ` · ${exitLabel(t, run.agent_exit)}` : ''}</>} />
        <Tile label={t('metricTokens')} value={compact(used)}
          sub={<>{t('metricBudget', { pct })} · {t('metricRequests', { n: run.tokens.requests })}</>} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={t('metricChecks')} value={run.checks.length ? `${passed}/${run.checks.length}` : '—'} />
        <Tile label={t('metricStart')} value={run.stats.start_seconds ? `${run.stats.start_seconds}s` : '—'} />
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-semibold text-muted-foreground">{t('budget')}</div>
          <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('metricTokensDetail', { in: compact(run.tokens.in + run.tokens.cache_write), out: compact(run.tokens.out), cached: compact(run.tokens.cache_read) })}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      </div>
      {total > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">{t('languages')}</div>
          <div className="flex h-2 overflow-hidden rounded-full">
            {langs.map(([l, n], i) => <div key={l} style={{ width: `${(100 * n) / total}%`, background: `var(--pop-${(i % 6) + 1})` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {langs.map(([l, n], i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: `var(--pop-${(i % 6) + 1})` }} />
                <b>{l}</b> <span className="font-mono text-muted-foreground">{grouped(n, t.locale)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Preview({ run, t }: { run: Run; t: RT }) {
  const [view, setView] = useState<'live' | 'desktop' | 'mobile'>(run.preview_url ? 'live' : 'desktop')
  const tabs: { k: typeof view; label: string; show: boolean }[] = [
    { k: 'live', label: t('preview'), show: !!run.preview_url },
    { k: 'desktop', label: t('desktop'), show: run.has_shot },
    { k: 'mobile', label: t('mobile'), show: run.has_shot_mobile },
  ]
  if (!tabs.some((x) => x.show)) return <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted-foreground">{t('noPreview')}</p>
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex rounded-full border border-border bg-card p-0.5 text-sm font-semibold">
          {tabs.filter((x) => x.show).map((x) => (
            <button key={x.k} role="tab" aria-selected={view === x.k} onClick={() => setView(x.k)}
              className={cn('rounded-full px-3 py-1.5', view === x.k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>{x.label}</button>
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
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
              <span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" />
              <span className="ml-2 truncate font-mono text-xs text-muted-foreground">{run.preview_url}</span>
            </div>
            <iframe src={run.preview_url} title={t('preview')} className="block h-[70vh] min-h-[420px] w-full bg-white"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('previewHint')}</p>
        </>
      )}
      {view === 'desktop' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot.jpg`} alt={t('desktop')} className="w-full rounded-xl border border-border" />
      )}
      {view === 'mobile' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/v1/runs/${run.id}/shot-mobile.jpg`} alt={t('mobile')} className="mx-auto w-full max-w-[390px] rounded-[2rem] border-8 border-ink" />
      )}
    </section>
  )
}

function JudgeCard({ run, t }: { run: Run; t: RT }) {
  const j = run.judge!
  return (
    <section>
      <h2 className="heading mb-3 text-lg">{t('judgeTitle')}</h2>
      {j.status !== 'ok' ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {j.status === 'skipped' ? t('judgeSkipped', { reason: j.error ?? '' }) : t('judgeError', { reason: j.error ?? '' })}
        </p>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-start">
            <ScoreBadge score={j.score} size="lg" />
            <div className="min-w-0">
              <p className="leading-relaxed">{j.summary}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('judgeMeta', { model: j.model ?? '', steps: j.steps ?? 0, tokens: compact(run.judge_tokens.in + run.judge_tokens.out) })}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {(j.criteria ?? []).map((c) => (
              <li key={c.title} className="grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <div className="flex items-baseline justify-between gap-2 font-semibold">
                    <span>{c.title}</span>
                    <span className="font-mono text-sm tabular-nums">{c.points}/{c.max}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', c.points >= c.max * 0.75 ? 'bg-success' : c.points >= c.max * 0.4 ? 'bg-warning' : 'bg-destructive')}
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

function Checks({ run, t }: { run: Run; t: RT }) {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <h2 className="heading mb-3 text-lg">{t('checksTitle')}</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {run.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <div className="min-w-0">
                <div className="font-semibold">{c.name}</div>
                {!c.passed && c.detail && <div className="mt-0.5 font-mono text-xs break-words text-muted-foreground">{c.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <aside>
        <h2 className="heading mb-3 text-lg">{t('source')}</h2>
        {run.has_source && (
          <Button variant="outline" className="w-full" render={<a href={`/api/v1/runs/${run.id}/source.zip`} />} nativeButton={false}>
            <Download /> {t('downloadSource')}
          </Button>
        )}
      </aside>
    </section>
  )
}

function Logs({ run, t }: { run: Run; t: RT }) {
  return (
    <section className="space-y-3">
      {([['agentLog', run.agent_log], ['checkLog', run.check_log]] as const).map(([k, text]) => (
        <details key={k} className="group rounded-xl border border-border bg-card" open={k === 'agentLog' && isActive(run)}>
          <summary className="cursor-pointer px-4 py-3 font-semibold">{t(k)}</summary>
          <pre className="max-h-[32rem] overflow-auto rounded-b-xl bg-terminal p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-terminal-foreground [overflow-wrap:anywhere]">
            {text || t('emptyLog')}
          </pre>
        </details>
      ))}
    </section>
  )
}

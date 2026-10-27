'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Crosshair, ExternalLink, FileCode2, Folder } from 'lucide-react'
import { SectionTitle } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { duration, usd, usedTokens } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import type { Live, LiveFile, LivePoint, Run } from '@/lib/types'
import { usePoll } from '@/lib/use-poll'
import { cn } from '@/lib/utils'
import { isActive } from './bits'
import { agentElapsed, lastStep, useNow } from './live-runs'

// The agent at work, for one run: the numbers ticking, the workspace growing file by file as in an IDE, the file it
// is writing now, and its app rebuilt from the workspace as it goes. Everything comes from the run and its live
// sample (/runs/{id}/live), so a page can put two of these side by side and watch two agents build at once.
// mode 'code' is what stays after the agent: the workspace as it left it, to browse.
export function LiveBuild({ run, mode = 'live', compact = false }: { run: Run; mode?: 'live' | 'code'; compact?: boolean }) {
  const t = useT()
  const status = useRef(run.status)
  status.current = run.status
  const poll = usePoll<Live>(run.status === 'queued' ? null : `/runs/${encodeURIComponent(run.id)}/live`, 2_000,
    () => isActive({ status: status.current }))
  const live = poll.data
  const files = useMemo(() => live?.files ?? [], [live])
  const fresh = useFresh(mode === 'live' ? live?.files : undefined)
  const working = mode === 'live' && run.status === 'agent'

  if (mode === 'code' && files.length === 0) return null
  return (
    <section aria-label={t('Как агент строит', 'The agent building')} className="space-y-4">
      {mode === 'live' && <Numbers run={run} live={live} compact={compact} />}
      {mode === 'code' && (
        <SectionTitle count={files.length} aside={t('Рабочая папка, какой её оставил агент', 'The workspace as the agent left it')}>
          {t('Код', 'Code')}
        </SectionTitle>
      )}
      <Ide run={run} files={files} fresh={fresh} following={working} compact={compact} />
      {mode === 'live' && <LivePreview run={run} live={live} files={files} compact={compact} />}
    </section>
  )
}

// Paths whose file changed since the previous sample, with when it was seen: what flashes in the tree.
function useFresh(files: LiveFile[] | undefined) {
  const prev = useRef<Map<string, number> | null>(null)
  const [fresh, setFresh] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!files) return
    const before = prev.current
    prev.current = new Map(files.map((f) => [f.path, f.changed_s]))
    if (!before) return
    const now = Date.now()
    const changed: Record<string, number> = {}
    for (const f of files) if (before.get(f.path) !== f.changed_s) changed[f.path] = now
    if (Object.keys(changed).length) setFresh((s) => ({ ...s, ...changed }))
  }, [files])
  return fresh
}

// A number that runs up to its new value instead of jumping.
function useTween(target: number, ms = 1500) {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const a = from.current
    if (a === target) return
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      from.current = a + (target - a) * (1 - (1 - k) ** 3)
      setShown(from.current)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return Math.round(shown)
}

function Numbers({ run, live, compact }: { run: Run; live: Live | null; compact: boolean }) {
  const t = useT()
  const now = useNow()
  const series = live?.series ?? []
  const last = series.at(-1)
  const used = Math.max(usedTokens(run.tokens), last?.tokens ?? 0)
  const tokens = useTween(used)
  const loc = useTween(last?.loc ?? 0)
  const elapsed = agentElapsed(run, now) ?? 0
  const step = lastStep({ log_tail: run.agent_log ?? run.log_tail })
  // Files added over the last minute of the agent's work.
  const recent = (live?.files ?? []).filter((f) => f.added_s > (last?.t ?? 0) - 60).length
  return (
    <div>
      <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border-2 border-border bg-border', !compact && 'sm:grid-cols-4')}>
        <Stat label={t('Время агента', 'Agent time')} value={duration(elapsed)} sub={t(`из ${duration(run.time_limit_s)}`, `of ${duration(run.time_limit_s)}`)}
          bar={elapsed / Math.max(1, run.time_limit_s)} />
        <Stat label={t('Токены', 'Tokens')} value={t.num(tokens)}
          sub={[t(`${Math.round((100 * used) / Math.max(1, run.token_budget))}% бюджета`, `${Math.round((100 * used) / Math.max(1, run.token_budget))}% of budget`),
            run.cost_usd != null && usd(run.cost_usd)].filter(Boolean).join(' · ')}
          bar={used / Math.max(1, run.token_budget)} spark={<Spark series={series} pick={(p) => p.tokens} />} />
        <Stat label={t('Файлы', 'Files')} value={t.num(live?.files.length ?? 0)}
          sub={recent > 0 ? t.plural(recent, ['+{n} за минуту', '+{n} за минуту', '+{n} за минуту'], ['+{n} in the last minute', '+{n} in the last minute']) : t('исходники, без зависимостей', 'sources, no dependencies')}
          spark={<Spark series={series} pick={(p) => p.files} />} />
        <Stat label={t('Строк кода', 'Lines of code')} value={t.num(loc)} sub={t('непустые, в файлах с кодом', 'non-blank, in code files')}
          spark={<Spark series={series} pick={(p) => p.loc} />} />
      </div>
      {step && run.status === 'agent' && (
        <p className="mt-2 truncate font-mono text-meta text-muted-foreground" title={step}>
          <span className="text-faint">› </span>{step}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, sub, bar, spark }: { label: string; value: React.ReactNode; sub?: React.ReactNode; bar?: number; spark?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="text-ui text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-section font-semibold tnum">{value}</div>
      {bar != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pending">
          <div className={cn('h-full transition-[width] duration-1000', bar >= 1 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(100, 100 * bar)}%` }} />
        </div>
      )}
      {spark}
      {sub && <div className="mt-1 truncate text-meta text-faint">{sub}</div>}
    </div>
  )
}

// How one number of the workspace grew over the agent's work.
function Spark({ series, pick }: { series: LivePoint[]; pick: (p: LivePoint) => number }) {
  if (series.length < 2) return <div className="mt-1.5 h-4" />
  const t0 = series[0].t, t1 = Math.max(t0 + 1, series.at(-1)!.t)
  const top = Math.max(1, ...series.map(pick))
  const pts = series.map((p) => `${((p.t - t0) / (t1 - t0)) * 100},${16 - (pick(p) / top) * 15}`).join(' ')
  return (
    <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="mt-1.5 block h-4 w-full" aria-hidden>
      <polyline points={pts} fill="none" className="stroke-primary" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

type Node = { name: string; path: string; file?: LiveFile; children: Node[]; lines: number }

function buildTree(files: LiveFile[]): Node[] {
  const root: Node = { name: '', path: '', children: [], lines: 0 }
  for (const f of files) {
    const parts = f.path.split('/')
    let at = root
    parts.forEach((name, i) => {
      at.lines += f.lines
      const path = parts.slice(0, i + 1).join('/')
      let next = at.children.find((c) => c.name === name && !c.file === (i < parts.length - 1))
      if (!next) {
        next = { name, path, children: [], lines: 0, file: i === parts.length - 1 ? f : undefined }
        at.children.push(next)
      }
      at = next
    })
    at.lines = f.lines
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

// The workspace as an IDE shows it: the tree on the left, one file open on the right. While the agent works the open
// file follows what it writes, until the viewer picks one.
function Ide({ run, files, fresh, following, compact }: {
  run: Run; files: LiveFile[]; fresh: Record<string, number>; following: boolean; compact: boolean
}) {
  const t = useT()
  const tree = useMemo(() => buildTree(files), [files])
  const [pinned, setPinned] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const latest = useMemo(() => files.filter((f) => f.text).reduce<LiveFile | undefined>(
    (a, f) => !a || f.changed_s > a.changed_s || (f.changed_s === a.changed_s && f.path > a.path) ? f : a, undefined), [files])
  const pin = pinned ? files.find((f) => f.path === pinned) : undefined
  const open = pin ?? latest
  const follow = following && !pin

  const toggle = (path: string) => setClosed((s) => {
    const n = new Set(s)
    if (n.has(path)) n.delete(path)
    else n.add(path)
    return n
  })
  const rows: React.ReactNode[] = []
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      const isOpen = n.file && open?.path === n.path
      const flash = fresh[n.path] && n.file
      rows.push(
        <button key={flash ? `${n.path}@${fresh[n.path]}` : n.path} type="button"
          onClick={() => n.file ? (n.file.text && setPinned(n.path)) : toggle(n.path)}
          className={cn('flex w-full min-w-0 items-center gap-1.5 py-0.5 pr-3 text-left font-mono text-meta transition-colors hover:bg-terminal-foreground/5',
            isOpen && 'bg-terminal-foreground/10', flash && 'animate-live-flash', n.file && !n.file.text && 'cursor-default opacity-60')}
          style={{ paddingLeft: 8 + depth * 12 }}>
          {n.file
            ? <FileCode2 aria-hidden className="size-3.5 shrink-0 text-terminal-accent" />
            : <><ChevronRight aria-hidden className={cn('size-3 shrink-0 text-faint transition-transform', !closed.has(n.path) && 'rotate-90')} /><Folder aria-hidden className="size-3.5 shrink-0 text-faint" /></>}
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          <span className="shrink-0 text-faint tnum">{n.lines || ''}</span>
        </button>,
      )
      if (!n.file && !closed.has(n.path)) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)

  return (
    <div className={cn('grid overflow-hidden rounded-xl border-2 border-border bg-terminal text-terminal-foreground',
      compact ? 'grid-rows-[140px_minmax(0,1fr)]' : 'max-sm:grid-rows-[160px_minmax(0,1fr)] sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]',
      compact ? 'h-[480px]' : 'h-[520px]')}>
      <nav aria-label={t('Файлы', 'Files')} className={cn('overflow-auto py-2', compact ? 'border-b border-terminal-foreground/10' : 'max-sm:border-b sm:border-r border-terminal-foreground/10')}>
        {rows.length ? rows : <p className="px-3 font-mono text-meta text-faint">{t('Агент ещё не написал ни одного файла.', 'The agent hasn’t written a file yet.')}</p>}
      </nav>
      <Code run={run} file={open} follow={follow} onFollow={following && pin ? () => setPinned(null) : undefined} />
    </div>
  )
}

type Body = { key: string; path: string; text: string; from: number; to: number }

// The lines of b that differ from a (by common prefix and suffix): what the agent just wrote. [-1, -1] when none.
function changedRange(a: string, b: string): [number, number] {
  const x = a.split('\n'), y = b.split('\n')
  let p = 0
  while (p < x.length && p < y.length && x[p] === y[p]) p++
  let s = 0
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++
  return p < y.length - s ? [p, y.length - s] : [-1, -1]
}

function useBody(runId: string, file: LiveFile | undefined) {
  const [body, setBody] = useState<Body | null>(null)
  const path = file?.text ? file.path : null
  const changed = file?.changed_s
  useEffect(() => {
    if (!path) return
    const key = `${path}@${changed}`
    const ctrl = new AbortController()
    fetch(`/api/v1/runs/${encodeURIComponent(runId)}/live/file?path=${encodeURIComponent(path)}`, { signal: ctrl.signal, credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setBody((prev) => {
        const [from, to] = prev && prev.path === path && prev.key !== key ? changedRange(prev.text, text) : [-1, -1]
        return { key, path, text, from, to }
      }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [runId, path, changed])
  return body?.path === path ? body : null
}

const maxShownLines = 4000

function Code({ run, file, follow, onFollow }: { run: Run; file: LiveFile | undefined; follow: boolean; onFollow?: () => void }) {
  const t = useT()
  const body = useBody(run.id, file)
  const scroller = useRef<HTMLDivElement>(null)
  // Following the agent, keep what it just wrote in view.
  useEffect(() => {
    const el = scroller.current
    if (!follow || !el || !body || body.from < 0) return
    const line = el.querySelector<HTMLElement>(`[data-line="${body.to - 1}"]`)
    if (line) el.scrollTo({ top: Math.max(0, line.offsetTop - el.clientHeight * 0.6), behavior: 'smooth' })
  }, [follow, body])
  const lines = body ? body.text.split('\n') : []
  if (lines.at(-1) === '') lines.pop()
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-3 border-b border-terminal-foreground/10 px-3 py-2 font-mono text-meta">
        <span className="min-w-0 flex-1 truncate">{file?.path ?? '—'}</span>
        {file && <span className="shrink-0 text-faint tnum">{t.plural(file.lines, ['{n} строка', '{n} строки', '{n} строк'], ['{n} line', '{n} lines'])}</span>}
        {follow && <span className="flex shrink-0 items-center gap-1.5 text-terminal-success"><span className="size-1.5 animate-status-pulse rounded-full bg-terminal-success" />{t('следит за агентом', 'following the agent')}</span>}
        {onFollow && (
          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-meta text-terminal-foreground hover:bg-terminal-foreground/10 hover:text-terminal-foreground" onClick={onFollow}>
            <Crosshair /> {t('Следить', 'Follow')}
          </Button>
        )}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto py-2 font-mono text-[12px] leading-5">
        {!file ? null : !body ? <p className="px-3 text-faint">…</p> : lines.slice(0, maxShownLines).map((line, i) => {
          const hot = i >= body.from && i < body.to
          return (
            <div key={hot ? `${i}@${body.key}` : i} data-line={i} className={cn('flex', hot && 'animate-live-flash')}>
              <span className="sticky left-0 w-11 shrink-0 bg-terminal pr-3 text-right text-faint select-none tnum">{i + 1}</span>
              <span className="pr-4 whitespace-pre">{line || ' '}</span>
            </div>
          )
        })}
        {lines.length > maxShownLines && <p className="px-3 pt-2 text-faint">{t(`…и ещё ${lines.length - maxShownLines} строк`, `…and ${lines.length - maxShownLines} more lines`)}</p>}
      </div>
    </div>
  )
}

// The app as the workspace is now: rebuilt from it every so often while someone watches, reloaded here each time a
// newer build answers.
function LivePreview({ run, live, files, compact }: { run: Run; live: Live | null; files: LiveFile[]; compact: boolean }) {
  const t = useT()
  if (run.status !== 'agent') return null
  const url = live?.preview_url
  const hasStart = files.some((f) => f.path === 'start.sh')
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-body font-semibold">{t('Превью', 'Preview')}</h3>
          <span className="truncate text-ui text-faint">
            {url ? t(`сборка ${live!.preview_ready} · пересобирается, когда агент меняет код`, `build ${live!.preview_ready} · rebuilt as the agent changes the code`)
              : hasStart ? t('поднимаем приложение из рабочей папки…', 'starting the app from the workspace…')
              : t('появится, когда агент напишет start.sh', 'shows up once the agent writes start.sh')}
          </span>
        </div>
        {url && (
          <Button variant="outline" size="sm" render={<a href={url} target="_blank" rel="noreferrer noopener" />} nativeButton={false}>
            <ExternalLink /> {t('Открыть', 'Open')}
          </Button>
        )}
      </div>
      {url ? (
        <iframe key={live!.preview_ready} src={url} title={t('Живое превью', 'Live preview')}
          className={cn('block w-full rounded-xl border-2 border-border bg-white', compact ? 'h-[420px]' : 'h-[560px]')}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
      ) : (
        <div className={cn('grid place-items-center rounded-xl border-2 border-dashed border-border-strong text-ui text-faint', compact ? 'h-[200px]' : 'h-[280px]')}>
          <span className={cn(hasStart && 'animate-status-pulse')}>{hasStart ? t('Сборка…', 'Building…') : t('Пока нечего запускать', 'Nothing to start yet')}</span>
        </div>
      )}
    </div>
  )
}


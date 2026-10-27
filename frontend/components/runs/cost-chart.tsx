'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usd } from '@/lib/format'
import { useT } from '@/lib/i18n-client'
import { cn } from '@/lib/utils'
import { type Vendor, vendorOf, VENDOR_LABEL } from '@/lib/vendor'
import { agentLabel, type Standing } from './standings'

// Spelled out so Tailwind sees every class.
const VENDOR_FILL: Record<Vendor, string> = {
  anthropic: 'fill-vendor-anthropic', openai: 'fill-vendor-openai', google: 'fill-vendor-google', moonshot: 'fill-vendor-moonshot',
  deepseek: 'fill-vendor-deepseek', zhipu: 'fill-vendor-zhipu', alibaba: 'fill-vendor-alibaba', tencent: 'fill-vendor-tencent',
}
const TICKS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]
const H = 360, PAD = { l: 40, r: 16, t: 20, b: 48 }

// Agents that nobody beats on both: no other is at least as good for no more money. Cheapest first.
export function frontier(points: Standing[]): Set<string> {
  const out = new Set<string>()
  let best = -1
  for (const p of [...points].sort((a, b) => a.cost! - b.cost! || b.average - a.average)) {
    if (p.average > best) { out.add(p.id); best = p.average }
  }
  return out
}

// The overall score against the cost of a run (log scale), as arena boards' Pareto charts: up and left is better.
// Only agents with a known, non-zero cost (an uploaded agent's model is unknown, a subscription costs 0).
export function CostChart({ rows }: { rows: Standing[] }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState<number | null>(null)
  const points = rows.filter((r) => r.cost != null && r.cost > 0)
  const shown = points.length >= 2
  // Drawn at the box's real width, so labels keep their size on a phone.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown])
  if (!shown) return null

  const costs = points.map((p) => p.cost!)
  const lo = Math.log10(Math.min(...costs) / 2), hi = Math.log10(Math.max(...costs) * 2)
  const edge = new Set(frontier(points))
  const line = points.filter((p) => edge.has(p.id)).sort((a, b) => a.cost! - b.cost!)

  return (
    <section className="mt-10" aria-labelledby="cost-title">
      <h2 id="cost-title" className="text-section font-semibold">{t('Оценка и цена', 'Score and cost')}</h2>
      <p className="mt-1 max-w-[70ch] text-body text-muted-foreground">
        {t('Чем выше и левее, тем лучше: больше проверок за меньшие деньги. Линия соединяет агентов, которых никто не обходит сразу и по оценке, и по цене.',
          'Up and left is better: more checks passed for less money. The line joins the agents nobody beats on both score and cost.')}
      </p>
      <div ref={box} className="mt-4 rounded-xl border border-border bg-card" style={{ height: H }}>
        {w != null && <Plot w={w} points={points} edge={edge} line={line} lo={lo} hi={hi} />}
      </div>
      {points.length < rows.length && (
        <p className="mt-2 text-meta text-faint">{t('Без агентов, чья модель неизвестна или работает по подписке.', 'Agents with an unknown model or on a subscription are left out.')}</p>
      )}
    </section>
  )
}

function Plot({ w, points, edge, line, lo, hi }: { w: number; points: Standing[]; edge: Set<string>; line: Standing[]; lo: number; hi: number }) {
  const t = useT()
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const x = (cost: number) => PAD.l + ((Math.log10(cost) - lo) / (hi - lo)) * iw
  const y = (score: number) => PAD.t + (1 - score / 100) * ih
  // At least 56px apart, so a phone gets fewer.
  const ticks = TICKS.filter((c) => Math.log10(c) >= lo && Math.log10(c) <= hi)
    .reduce<number[]>((acc, c) => (acc.length && x(c) - x(acc[acc.length - 1]) < 56 ? acc : [...acc, c]), [])
  const labels = placeLabels(points.map((p) => ({ id: p.id, x: x(p.cost!), y: y(p.average), text: agentLabel(p).title, first: edge.has(p.id) })), w)
  return (
    <svg width={w} height={H} role="img" aria-label={t('Оценка агентов против цены прогона', 'Agents’ score against the cost of a run')} className="block">
      {[0, 25, 50, 75, 100].map((s) => (
        <g key={s}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(s)} y2={y(s)} className="stroke-border" strokeDasharray={s ? '3 4' : undefined} />
          <text x={PAD.l - 8} y={y(s)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tnum">{s}</text>
        </g>
      ))}
      {ticks.map((c) => (
        <text key={c} x={x(c)} y={H - PAD.b + 18} textAnchor="middle" className="fill-faint text-[11px] tnum">{usd(c)}</text>
      ))}
      <text x={PAD.l + iw / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">{t('Средняя цена прогона, $ (логарифмическая шкала)', 'Average cost of a run, $ (log scale)')}</text>
      <polyline points={line.map((p) => `${x(p.cost!)},${y(p.average)}`).join(' ')} fill="none" className="stroke-success" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p) => {
        const v = vendorOf(p.name), at = labels.get(p.id)
        return (
          <Link key={p.id} href={`/agents/${p.id}`} className="group">
            <title>{`${p.name}: ${p.average} · ${usd(p.cost)}${v ? ` · ${VENDOR_LABEL[v]}` : ''}`}</title>
            <circle cx={x(p.cost!)} cy={y(p.average)} r={edge.has(p.id) ? 7 : 5} className={cn(v ? VENDOR_FILL[v] : 'fill-faint', edge.has(p.id) ? 'stroke-card' : 'opacity-60')} strokeWidth={2} />
            {at && (
              // A halo in the card's colour keeps the label readable where the line crosses it.
              <text x={at.x} y={at.y} dy="0.32em" textAnchor={at.anchor} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round"
                className={cn('stroke-card text-[12px] group-hover:fill-primary', edge.has(p.id) ? 'fill-foreground font-medium' : 'fill-muted-foreground')}>{agentLabel(p).title}</text>
            )}
          </Link>
        )
      })}
    </svg>
  )
}

type Spot = { x: number; y: number; anchor: 'start' | 'end' }

// Each point's label right of it, else left, above or below; one that fits nowhere is dropped (the point's tooltip
// still names it). The frontier is placed first. Widths are estimated from the 12px font.
function placeLabels(items: { id: string; x: number; y: number; text: string; first: boolean }[], w: number): Map<string, Spot> {
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = items.map((p) => ({ x0: p.x - 7, x1: p.x + 7, y0: p.y - 7, y1: p.y + 7 }))
  const out = new Map<string, Spot>()
  for (const p of [...items].sort((a, b) => Number(b.first) - Number(a.first))) {
    const len = p.text.length * 6.6
    const tries: Spot[] = [
      { x: p.x + 11, y: p.y, anchor: 'start' }, { x: p.x - 11, y: p.y, anchor: 'end' },
      { x: p.x + 4, y: p.y - 15, anchor: 'start' }, { x: p.x + 4, y: p.y + 15, anchor: 'start' },
      { x: p.x - 4, y: p.y - 15, anchor: 'end' }, { x: p.x - 4, y: p.y + 15, anchor: 'end' },
    ]
    for (const s of tries) {
      const box = { x0: s.anchor === 'start' ? s.x : s.x - len, x1: s.anchor === 'start' ? s.x + len : s.x, y0: s.y - 8, y1: s.y + 8 }
      if (box.x0 < PAD.l || box.x1 > w - 4 || box.y0 < 2 || box.y1 > H - PAD.b) continue
      if (taken.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue
      taken.push(box)
      out.set(p.id, s)
      break
    }
  }
  return out
}

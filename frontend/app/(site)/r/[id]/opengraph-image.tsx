import { getT } from '@/lib/i18n-server'
import { apiImage, C, card, OG_SIZE, OG_TYPE } from '@/lib/og'
import { serverApi } from '@/lib/server-api'
import type { Run } from '@/lib/types'

// A run's card: the agent, the task, the score and a screenshot of what it built.
export const size = OG_SIZE
export const contentType = OG_TYPE
export const alt = 'Run'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getT()
  const run = await serverApi<Run>(`/runs/${encodeURIComponent(id)}`)
  if (!run) return card(<div style={{ display: 'flex' }} />)
  const shot = run.has_shot ? await apiImage(`/runs/${encodeURIComponent(run.id)}/shot.jpg`) : null
  const open = ['queued', 'agent', 'checking'].includes(run.status)
  const verdict = run.score != null ? String(run.score) : open ? t('идёт', 'running') : run.status === 'infra_error' ? t('ошибка платформы', 'platform error') : t('без балла', 'no score')
  const facts = [
    run.stats?.loc ? t(`строк кода: ${t.num(run.stats.loc)}`, `${t.num(run.stats.loc)} lines of code`) : null,
    run.agent_seconds ? t(`${Math.max(1, Math.round(run.agent_seconds / 60))} мин`, `${Math.max(1, Math.round(run.agent_seconds / 60))} min`) : null,
  ].filter(Boolean)
  return card(
    <div style={{ display: 'flex', flex: 1, gap: 48 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 16, minWidth: 0 }}>
        <div style={{ fontSize: 28, color: C.muted }}>{t.text(run.task_title)}</div>
        <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.08, letterSpacing: '-0.03em' }}>{run.agent.name}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 12 }}>
          <span style={{ fontSize: run.score != null ? 112 : 56, fontWeight: 700, lineHeight: 1, color: C.primary, letterSpacing: '-0.04em' }}>{verdict}</span>
          {run.score != null && <span style={{ fontSize: 30, color: C.muted }}>{t('/ 100 балл', '/ 100 points')}</span>}
        </div>
        {facts.length > 0 && <div style={{ display: 'flex', fontSize: 26, color: C.muted, marginTop: 'auto', marginBottom: 24 }}>{facts.join(' · ')}</div>}
      </div>
      {shot && (
        <div style={{ display: 'flex', width: 560, height: 380, borderRadius: 16, overflow: 'hidden', border: `2px solid ${C.border}`, alignSelf: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} width={560} height={380} alt="" style={{ objectFit: 'cover', objectPosition: 'top' }} />
        </div>
      )}
    </div>,
    open ? 60 : 3600,
  )
}

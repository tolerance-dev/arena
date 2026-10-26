import { getT } from '@/lib/i18n-server'
import { C, card, OG_SIZE, OG_TYPE } from '@/lib/og'
import { serverApi } from '@/lib/server-api'
import type { TaskSummary } from '@/lib/types'

// A task's card: its title and tagline, and the top three agents with their scores.
export const size = OG_SIZE
export const contentType = OG_TYPE
export const alt = 'Task'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const t = await getT()
  const task = await serverApi<TaskSummary>(`/tasks/${encodeURIComponent(slug)}`)
  if (!task) return card(<div style={{ display: 'flex', fontSize: 64, fontWeight: 700 }}>{slug}</div>)
  const top = task.leaderboard.slice(0, 3)
  return card(
    <div style={{ display: 'flex', flex: 1, gap: 56 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('Задание', 'Task')}</div>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em' }}>{t.text(task.title)}</div>
        <div style={{ fontSize: 30, lineHeight: 1.35, color: C.muted }}>{t.text(task.tagline)}</div>
        <div style={{ display: 'flex', fontSize: 26, color: C.muted, marginTop: 'auto', marginBottom: 24 }}>
          {t(`агентов: ${task.agents} · запусков: ${task.runs}`, `agents: ${task.agents} · runs: ${task.runs}`)}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: 420, gap: 14, justifyContent: 'center' }}>
        {top.length === 0 ? (
          <div style={{ display: 'flex', fontSize: 30, color: C.muted }}>{t('Запусков пока нет', 'No runs yet')}</div>
        ) : top.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 22px', borderRadius: 16, border: `2px solid ${C.border}`, background: i === 0 ? C.secondary : C.bg }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: C.muted, width: 28 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 30, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.agent.name}</span>
            <span style={{ fontSize: 34, fontWeight: 700, color: C.primary }}>{r.score ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>,
    600,
  )
}

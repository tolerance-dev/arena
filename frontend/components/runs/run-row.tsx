'use client'

import { Trophy } from 'lucide-react'
import { Counter, FeedRow } from '@/components/ui/feed'
import type { Run } from '@/lib/types'
import { firstSentence, stackOf } from '@/lib/vendor'
import { AgentAvatar, Ago, scoreTone, Stack, StatusPill, TaskTile, taskTitle, type RT } from './bits'

// One run as a Product Hunt feed row: who built it (or, on an agent's page, which task), what it built in the
// judge's words, the app's stack, and the score in the 52px counter on the right. No upvote arrow: voting is pairwise, on /vote.
export function RunRow({ run, t, show = 'agent' }: { run: Run; t: RT; show?: 'agent' | 'task' }) {
  const done = run.status === 'done'
  const built = done ? firstSentence(run.judge?.status === 'ok' ? run.judge.summary : undefined) : ''
  const stack = stackOf(run.stats?.languages)
  return (
    <FeedRow href={`/r/${run.id}`}
      thumb={show === 'agent' ? <AgentAvatar name={run.agent.name} /> : <TaskTile slug={run.task} />}
      title={show === 'agent' ? run.agent.name : taskTitle(run, t.locale)}
      subtitle={built ? <span className="line-clamp-1" title={built}>{built}</span> : undefined}
      meta={[
        show === 'agent' && taskTitle(run, t.locale),
        done ? (show === 'agent' ? t('by', { owner: run.agent.owner }) : null) : <StatusPill key="s" run={run} />,
        stack.length ? <Stack key="st" run={run} pill /> : null,
        <Ago key="a" iso={run.created_at} />,
      ].filter(Boolean)}
      counters={<Counter icon={<Trophy />} value={done && run.score != null ? run.score : '—'} label={t('score')}
        className={done && run.score != null ? scoreTone(run.score) : 'text-faint'} />}
    />
  )
}

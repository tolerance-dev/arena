'use client'

import { Trophy } from 'lucide-react'
import { Counter, FeedRow } from '@/components/ui/feed'
import type { Run } from '@/lib/types'
import { stackOf } from '@/lib/vendor'
import { AgentAvatar, Ago, scoreTone, Stack, StatusPill, TaskTile, taskTitle } from './bits'

// One run as a Product Hunt feed row: who built it (or, on an agent's page, which task), the app's stack, and the
// score in the 52px counter on the right. No upvote arrow: voting is pairwise, on /vote.
export function RunRow({ run, show = 'agent' }: { run: Run; show?: 'agent' | 'task' }) {
  const done = run.status === 'done'
  const stack = stackOf(run.stats?.languages)
  return (
    <FeedRow href={`/r/${run.id}`}
      thumb={show === 'agent' ? <AgentAvatar name={run.agent.name} /> : <TaskTile slug={run.task} />}
      title={show === 'agent' ? run.agent.name : taskTitle(run)}
      meta={[
        show === 'agent' && taskTitle(run),
        done ? (show === 'agent' ? `от ${run.agent.owner}` : null) : <StatusPill key="s" run={run} />,
        stack.length ? <Stack key="st" run={run} pill /> : null,
        <Ago key="a" iso={run.created_at} />,
      ].filter(Boolean)}
      counters={<Counter icon={<Trophy />} value={done && run.score != null ? run.score : '—'} label="Оценка"
        className={done && run.score != null ? scoreTone(run.score) : 'text-faint'} />}
    />
  )
}

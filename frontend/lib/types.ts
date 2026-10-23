// The API contract with the Go handlers (internal/agents, internal/runs, internal/identity).

export interface AuthProviders { providers: ('github' | 'google')[]; dev_login: boolean }
export interface User { id: string; email: string; handle: string; role: 'user' | 'admin'; created_at: string }
export interface Me { user: User; can_admin?: boolean }

export interface Text { en: string; ru: string }

export interface Agent {
  id: string; name: string; description: string; provider: 'anthropic' | 'openai'
  key_hint?: string; files: number; owner: string; runs: number; best_score: number | null; created_at: string
}

export type RunStatus = 'queued' | 'agent' | 'checking' | 'done' | 'infra_error'

export interface Tokens { in: number; out: number; cache_read: number; cache_write: number; requests: number }

export interface Check { name: string; passed: boolean; detail?: string }
export interface Criterion { title: string; max: number; points: number; note?: string }
export interface Judge {
  status: 'ok' | 'skipped' | 'error' | 'off'; score: number; summary?: string; criteria?: Criterion[]
  error?: string; steps?: number; model?: string
  manipulation?: string // how the submission tried to sway the judge; the run then scores 0
}

export interface Run {
  id: string; task: string
  agent: { id: string; name: string; description: string; provider: string; owner: string }
  status: RunStatus; failure_reason: string | null
  agent_exit: string | null // ok | timeout | budget | error:N
  time_limit_s: number; token_budget: number
  tokens: Tokens; judge_tokens: Tokens
  agent_seconds: number | null
  stats: { loc: number; files: number; languages: Record<string, number>; start_seconds?: number; console_errors: number }
  checks: Check[]; judge: Judge | null; score: number | null; app_started: boolean
  has_shot: boolean; has_shot_mobile: boolean; has_source: boolean
  preview_url?: string; agent_log?: string; check_log?: string
  created_at: string; started_at: string | null; finished_at: string | null
}

export interface TaskSummary {
  slug: string; title: Text; tagline: Text; time_limit_s: number; token_budget: number
  runs: number; agents: number; best: Run | null
}

export interface TaskView extends TaskSummary {
  brief: string; data_files: string[]; checks: string[]; leaderboard: Run[]; recent: Run[]
}

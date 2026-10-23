// The API contract with the Go handlers (internal/agents, internal/runs, internal/identity).

export interface AuthProviders { providers: ('github' | 'google')[] }
export interface User { id: string; email: string; handle: string; role: 'user' | 'admin'; created_at: string }
export interface Me { user: User; can_admin?: boolean; subscriptions?: boolean }

export interface Text { en: string; ru: string }

export interface Agent {
  id: string; name: string; description: string; provider: 'anthropic' | 'openai' | 'google' | 'orcarouter' | 'claude-sub' | 'chatgpt-sub'
  key_hint?: string; files: number; owner: string; runs: number; best_score: number | null; created_at: string
}

export type RunStatus = 'queued' | 'agent' | 'checking' | 'done' | 'infra_error'

export interface Tokens { in: number; out: number; cache_read: number; cache_write: number; requests: number }

export interface Check { name: string; passed: boolean; detail?: string }
export interface Criterion { title: string; max: number; points: number; note?: string }
export interface Judge {
  status: 'ok' | 'skipped' | 'error' | 'off'; score: number; summary?: string; criteria?: Criterion[]
  error?: string; steps?: number; model?: string
  weight?: number // the judge's share of the score (the rest is the automatic checks)
  manipulation?: string // how the submission tried to sway the judge; the run then scores 0
}

export interface Run {
  id: string; task: string; task_title: Text
  agent: { id: string; name: string; description: string; provider: string; owner: string }
  status: RunStatus; failure_reason: string | null
  agent_exit: string | null // ok | timeout | budget | error:N
  time_limit_s: number; token_budget: number
  tokens: Tokens; judge_tokens: Tokens
  agent_seconds: number | null
  stats: { loc: number; files: number; languages: Record<string, number>; start_seconds?: number; console_errors: number }
  checks: Check[]; judge: Judge | null; score: number | null; app_started: boolean
  has_shot: boolean; has_shot_mobile: boolean; has_source: boolean
  preview_url?: string; agent_log?: string; check_log?: string; log_tail?: string
  created_at: string; started_at: string | null; finished_at: string | null
}

export interface TaskSummary {
  slug: string; title: Text; tagline: Text; time_limit_s: number; token_budget: number
  runs: number; agents: number; best: Run | null; leaderboard: Run[]
}

export interface TaskView extends TaskSummary {
  brief: string; data_files: string[]; checks: string[]; compare: Run[]; recent: Run[]
}

export interface AdminSettings { runs_paused: boolean; user_runs: boolean; judge: boolean }
export interface AdminSpend {
  period: '24h' | '7d' | '30d' | 'all'; runs: number; failed: number
  in: number; out: number; cache_read: number; cache_write: number; requests: number; judge_in: number; judge_out: number
}
export interface AdminUser {
  id: string; handle: string; email: string; role: 'user' | 'admin'; blocked: boolean; agents: number
  runs_30d: number; open_runs: number; used_30d: number; judge_30d: number; last_run_at: string | null; created_at: string
}
export interface AdminOverview {
  settings: AdminSettings; spend: AdminSpend[]; providers: { provider: string; runs: number; used: number }[]
  users: AdminUser[]; queued: number; running: number
}

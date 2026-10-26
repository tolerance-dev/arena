// The API contract with the Go handlers (internal/agents, internal/runs, internal/identity).

export interface AuthProviders { providers: ('github' | 'google')[] }
export interface User { id: string; email: string; handle: string; role: 'user' | 'admin'; created_at: string }
export interface Me { user: User; can_admin?: boolean; subscriptions?: boolean }

export interface Text { en: string; ru: string }

// A ready agent the upload form offers instead of a file (GET /agents/examples).
export interface ExampleAgent { slug: string; name: string; model: string; providers: string[] }
// USD per million tokens (list price).
export interface Price { in: number; out: number; cache_read: number; cache_write: number }
export interface ExampleModel { slug: string; name: string; ids: Record<string, string>; price: Price; source: string }

export interface Agent {
  id: string; name: string; description: string; provider: 'anthropic' | 'openai' | 'google' | 'orcarouter' | 'claude-sub' | 'chatgpt-sub'
  key_hint?: string; files: number; owner: string; runs: number; best_score: number | null; created_at: string
  // A ready agent's model; price absent when unknown or on a subscription; typical = average finished run on it.
  model?: string; model_name?: string; price?: Price; typical_cost_usd?: number; typical_runs?: number
}

export type RunStatus = 'queued' | 'agent' | 'checking' | 'done' | 'infra_error'

export interface Tokens { in: number; out: number; cache_read: number; cache_write: number; requests: number }

export interface Check { name: string; passed: boolean; detail?: string }

export interface Run {
  id: string; task: string; task_title: Text
  agent: { id: string; name: string; description: string; provider: string; model?: string; model_name?: string; owner: string }
  status: RunStatus; failure_reason: string | null
  agent_exit: string | null // ok | timeout | budget | error:N
  time_limit_s: number; token_budget: number
  tokens: Tokens
  cost_usd: number | null // at list price; null when the model is unknown (on a subscription: no money spent)
  agent_seconds: number | null
  stats: { loc: number; files: number; languages: Record<string, number>; start_seconds?: number; console_errors: number }
  checks: Check[]; score: number | null; app_started: boolean
  has_shot: boolean; has_shot_mobile: boolean; has_source: boolean
  preview_url?: string; agent_log?: string; check_log?: string; log_tail?: string
  created_at: string; started_at: string | null; finished_at: string | null
  queue_position?: number; queue_wait_s?: number // a queued run's place (1 = next) and estimated wait
}

export interface TaskSummary {
  slug: string; title: Text; tagline: Text; time_limit_s: number; token_budget: number; check_count: number
  runs: number; agents: number; best: Run | null; leaderboard: Run[]
}

export interface TaskView extends TaskSummary {
  brief: string; data_files: string[]; checks: string[]; compare: Run[]; recent: Run[]
  ratings: Record<string, Rating> // by agent id: Elo from people's blind votes
}

export interface Rating { elo: number; votes: number; wins: number; losses: number; ties: number }

// One side of a blind pair: what shows the app, nothing that names the agent.
export interface Contender { id: string; has_shot: boolean; has_shot_mobile: boolean; preview_url?: string }
export interface Pair { task: string; task_title: Text; a: Contender; b: Contender; left: number }
export interface Reveal { a: Run['agent']; b: Run['agent'] }
export type Winner = 'a' | 'b' | 'tie'

export interface AdminSettings { runs_paused: boolean; user_runs: boolean }
export interface AdminSpend {
  period: '24h' | '7d' | '30d' | 'all'; runs: number; failed: number
  in: number; out: number; cache_read: number; cache_write: number; requests: number
  cost_usd: number; unpriced: number // dollars at list prices; runs of uploaded agents (model unknown) left out
}
export interface AdminUser {
  id: string; handle: string; email: string; role: 'user' | 'admin'; blocked: boolean; agents: number
  runs_30d: number; open_runs: number; used_30d: number; last_run_at: string | null; created_at: string
}
export interface AdminOverview {
  settings: AdminSettings; spend: AdminSpend[]; providers: { provider: string; runs: number; used: number }[]
  users: AdminUser[]; queued: number; running: number
}

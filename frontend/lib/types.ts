// The API contract with the Go handlers (internal/agents, internal/runs, internal/identity).

export interface AuthProviders { providers: ('github' | 'google')[]; dev_login?: boolean }
export interface User { id: string; email: string; handle: string; role: 'user' | 'admin'; created_at: string }
export interface Me { user: User; can_admin?: boolean; subscriptions?: boolean }


// A ready agent the upload form offers instead of a file (GET /agents/examples).
export interface ExampleAgent { slug: string; name: string; model: string; providers: string[] }
// USD per million tokens (list price).
export interface Price { in: number; out: number; cache_read: number; cache_write: number }
export interface ExampleModel { slug: string; name: string; ids: Record<string, string>; price: Price; source: string }

export interface Agent {
  id: string; name: string; description: string; provider: 'anthropic' | 'openai' | 'google' | 'orcarouter' | 'claude-sub' | 'chatgpt-sub'
  key_hint?: string; files: number; owner: string; runs: number; best_score: number | null; created_at: string
  // A ready agent's model; price absent when unknown or on a subscription; typical = average finished run on it.
  model?: string; model_name?: string; price?: Price; rate?: Rate; spent_usd?: number
}

// Tokens per minute of agent work on a model, from finished runs (every model's when all_models).
export interface Rate { in: number; out: number; cache_read: number; cache_write: number; runs: number; avg_minutes: number; all_models?: boolean
}

export type RunStatus = 'queued' | 'agent' | 'checking' | 'done' | 'infra_error'

export interface Tokens { in: number; out: number; cache_read: number; cache_write: number; requests: number }

export interface Check { name: string; passed: boolean; detail?: string }

export interface Run {
  id: string; task: string; task_title: string
  agent: { id: string; name: string; description: string; provider: string; model?: string; model_name?: string; owner: string }
  status: RunStatus; failure_reason: string | null
  agent_exit: string | null // ok | timeout | budget | error:N
  time_limit_s: number; token_budget: number
  tokens: Tokens
  cost_usd: number | null // at list price; null when the model is unknown, 0 on a subscription
  agent_seconds: number | null
  stats: { loc: number; files: number; languages: Record<string, number>; start_seconds?: number; console_errors: number }
  checks: Check[]; score: number | null; app_started: boolean
  has_shot: boolean; has_shot_mobile: boolean; has_source: boolean
  has_snapshot: boolean // the app's snapshot is kept: an admin can check it again
  rechecks: number // times the snapshot was checked again (the result is the latest)
  preview_url?: string; agent_log?: string; check_log?: string; log_tail?: string
  created_at: string; started_at: string | null; finished_at: string | null
  queue_position?: number; queue_wait_s?: number // a queued run's place (1 = next) and estimated wait
  manifest: RunManifest // fixed at creation: agent.provider and agent.model come from it
  models: Record<string, number> // model id the agent called → metered requests
  checks_version: string | null; checks_current: boolean // the checks that scored it; current = ranked
}

// What a run was set up with (runs.Manifest): hashes are sha256 hex.
export interface RunManifest {
  bundle_sha256: string; provider: string; model?: string; model_id?: string
  key_rotation: string // same_provider: a new key of the same provider applies, another provider is refused
  task_md_sha256: string; data_sha256: string; checks_sha256: string; verifier_sha256: string
  scoring_version: number; checks_version: string
  runtime?: { image: string; versions?: Record<string, string> } // set when the agent's container starts
}

export interface TaskSummary {
  slug: string; title: string; tagline: string; time_limit_s: number; token_budget: number; check_count: number
  runs: number; agents: number; best: Run | null; leaderboard: Run[]
}

export interface TaskView extends TaskSummary {
  brief: string; data_files: string[]; checks: string[]; compare: Run[]; recent: Run[]
  ratings: Record<string, Rating> // by agent id: Elo from people's blind votes
}

export interface Rating { elo: number; votes: number; wins: number; losses: number; ties: number }

// One side of a blind pair: what shows the app, nothing that names the agent.
// alias stands for the run until the vote: its shots are /api/v1/vote/<alias>/shot.jpg.
export interface Contender { alias: string; has_shot: boolean; has_shot_mobile: boolean; preview_url?: string }
export interface Pair { id: string; task: string; task_title: string; a: Contender; b: Contender; left: number }
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
  runs_30d: number; open_runs: number; used_30d: number; cost_30d: number; last_run_at: string | null; created_at: string
  votes: number
}
export interface AdminOverview {
  settings: AdminSettings; spend: AdminSpend[]; providers: { provider: string; runs: number; used: number }[]
  users: AdminUser[]; queued: number; running: number
}

import type { Text } from './i18n'

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
  // The ready agent (CLI) it was made from; absent for an uploaded one.
  example?: string; example_name?: string
}

// Tokens per minute of agent work on a model, from its finished runs.
export interface Rate { in: number; out: number; cache_read: number; cache_write: number; runs: number; avg_minutes: number
}

export type RunStatus = 'queued' | 'agent' | 'checking' | 'done' | 'infra_error'

export interface Tokens { in: number; out: number; cache_read: number; cache_write: number; requests: number }

export interface Check { name: string; passed: boolean; detail?: string }

export interface Run {
  id: string; task: string; task_title: Text
  agent: { id: string; name: string; description: string; provider: string; model?: string; model_name?: string; owner: string }
  status: RunStatus; failure_reason: string | null
  agent_exit: string | null // ok | timeout | budget | key_rejected | error:N; gateway_restart while building
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

// build: to a spec, ranked by the checks' score. invent (rethink a known product) and startup (an MVP for one person's
// real problem): the agent designs the product; the checks only gate it and people's blind votes rank it, trying the
// scenarios in both apps.
export type TaskKind = 'build' | 'invent' | 'startup'

// Whether people's votes rank the task rather than the checks' score.
export const isVoted = (kind: string | undefined) => kind === 'invent' || kind === 'startup'

export interface TaskSummary {
  slug: string; kind: TaskKind; title: Text; tagline: Text; scenarios: Text[] | null; time_limit_s: number; token_budget: number; check_count: number; hidden_count: number
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
export interface Pair { id: string; task: string; task_title: Text; scenarios?: Text[]; a: Contender; b: Contender; left: number }
export interface Reveal { a: Run['agent']; b: Run['agent'] }
export type Winner = 'a' | 'b' | 'tie'

// The weekly tournament (GET /admin/tournament): the site owner's ready agents at every task, `rounds` runs each.
export interface TournamentPlayer { id: string; name: string; provider: string; model: string; model_name?: string }
export interface TournamentRecord {
  id: string; week: string | null // null: started by hand
  created_at: string; runs: number; open: number; done: number; failed: number
  cost_usd: number // at list price, a subscription included
}
export interface Tournament {
  can_manage: boolean // the viewer is the site owner
  weekly: boolean; next_at: string | null; rounds: number; tasks: number
  players: TournamentPlayer[]; recent: TournamentRecord[]
}

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

// The agent's workspace as the worker last sampled it (runs.Live): times are seconds since the agent started.
export interface LiveFile { path: string; lines: number; loc: number; bytes: number; text: boolean; added_s: number; changed_s: number }
export interface LivePoint { t: number; files: number; loc: number; tokens: number }
export interface Live {
  files: LiveFile[]; series: LivePoint[]
  preview_ready: number // grows each time a newer build of the app answers
  preview_url?: string // while the agent works and a build answers
  updated_at: string | null
}

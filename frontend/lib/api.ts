export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSec?: number, public fields?: { path: string; code: string }[]) {
    super(message)
  }
}

// Parses a Retry-After header (seconds, per RFC 9110; the backend never sends
// the HTTP-date form) into a positive integer, or undefined if absent/invalid.
function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After')
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

const BASE = '/api/v1'

// The home page's latest runs, finished ones only (no cancelled, failed or running): rendered on the server, then
// polled by the browser.
export const RECENT_RUNS = '/runs?status=done&limit=10'

async function throwProblem(res: Response): Promise<never> {
  let body: { code?: string; message?: string; fields?: { path: string; code: string }[] } | null = null
  try {
    body = await res.json()
  } catch {}
  throw new ApiError(res.status, body?.code ?? 'error', body?.message ?? res.statusText, retryAfterSeconds(res), body?.fields)
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) await throwProblem(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

// Uploads go as multipart/form-data, so no JSON Content-Type header.
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) await throwProblem(res)
  return (await res.json()) as T
}

export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })

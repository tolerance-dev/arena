'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

export type Poll<T> = {
  data: T | null
  // The last failed load; with data present, that data is stale.
  error: ApiError | null
  // No answer yet for this path: show a skeleton.
  loading: boolean
  // A load is in flight after the first answer (a poll or a retry).
  refreshing: boolean
  // Loads now and restarts polling (also after a 4xx or a terminal status stopped it).
  reload: () => void
}

// A failed load worth retrying on its own: no network, a 5xx, a 429 or a timeout. Other 4xx (404, 403) won't
// change by asking again.
function transient(e: ApiError) {
  return e.status === 0 || e.status >= 500 || e.status === 429 || e.status === 408
}

// Fetches path now and every `ms` while `active(data)` holds (or always, when active is omitted). A transient
// failure is retried with backoff (3 s doubling up to 30 s, sooner when the browser comes back online) and keeps
// the last data, so the page can show it as stale next to `error`. A 4xx stops polling until reload(). A response
// for an old path (after navigation or unmount) is dropped.
export function usePoll<T>(path: string | null, ms: number, active?: (d: T) => boolean): Poll<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: ApiError | null }>(
    { path: null, data: null, error: null })
  const [inFlight, setInFlight] = useState(false)
  const [nonce, setNonce] = useState(0)
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (!path) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    let failures = 0
    const ctrl = new AbortController()
    const tick = async () => {
      if (busy) return
      busy = true
      clearTimeout(timer)
      timer = undefined
      setInFlight(true)
      try {
        const d = await api<T>(path, { signal: ctrl.signal })
        if (!live) return
        failures = 0
        setState({ path, data: d, error: null })
        if (!activeRef.current || activeRef.current(d)) timer = setTimeout(tick, ms)
      } catch (err) {
        if (!live) return
        const e = err instanceof ApiError ? err : new ApiError(0, 'network', String(err))
        setState((s) => ({ path, data: s.path === path ? s.data : null, error: e }))
        if (!transient(e)) return
        failures++
        const wait = Math.max(Math.min(30_000, Math.min(ms, 3_000) * 2 ** (failures - 1)), (e.retryAfterSec ?? 0) * 1000)
        timer = setTimeout(tick, wait)
      } finally {
        busy = false
        if (live) setInFlight(false)
      }
    }
    const online = () => { if (failures > 0 && timer) void tick() }
    window.addEventListener('online', online)
    void tick()
    return () => {
      live = false
      ctrl.abort()
      clearTimeout(timer)
      window.removeEventListener('online', online)
      setInFlight(false)
    }
  }, [path, ms, nonce])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const mine = path != null && state.path === path
  const answered = mine && (state.data != null || state.error != null)
  return {
    data: mine ? state.data : null,
    error: mine ? state.error : null,
    loading: path != null && !answered,
    refreshing: answered && inFlight,
    reload,
  }
}

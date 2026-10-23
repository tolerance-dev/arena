'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { Me } from './types'

export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'))
      setError(null)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { me, loading, error, refresh }
}

/**
 * 自适应轮询 hook
 *
 * 有进行中 5s / 空闲 30s；页面隐藏暂停、可见恢复。
 */

import { useEffect, useRef } from 'react'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

interface AdaptivePollingOptions<TData, TError> {
  hasActive: boolean
  activeMs?: number
  idleMs?: number
  queryFn: UseQueryOptions<TData, TError>['queryFn']
  enabled?: boolean
}

export function useAdaptivePolling<TData, TError = unknown>(
  queryKey: unknown[],
  opts: AdaptivePollingOptions<TData, TError>,
) {
  const { hasActive, activeMs = 5000, idleMs = 30000, queryFn, enabled = true } = opts
  const [queryKeyDep] = queryKey

  const isVisibleRef = useRef(true)
  useEffect(() => {
    const onVis = () => {
      isVisibleRef.current = !document.hidden
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return useQuery({
    queryKey,
    queryFn,
    enabled: enabled && isVisibleRef.current,
    refetchInterval: () => {
      if (!isVisibleRef.current) return false
      return hasActive ? activeMs : idleMs
    },
    refetchIntervalInBackground: false,
  })
}
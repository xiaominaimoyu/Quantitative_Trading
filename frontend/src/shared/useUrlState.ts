/**
 * URL 状态 hook
 *
 * 基于 react-router useSearchParams，push 模式（可分享/可刷新恢复）
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

export function useUrlState<T>(
  key: string,
  defaultValue: T,
  opts?: {
    parse?: (raw: string) => T
    serialize?: (val: T) => string
  },
): [T, (val: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const parse = opts?.parse ?? ((raw: string) => raw as unknown as T)
  const serialize = opts?.serialize ?? ((val: T) => String(val))

  const value = useMemo<T>(() => {
    const raw = searchParams.get(key)
    if (raw === null) return defaultValue
    try {
      return parse(raw)
    } catch {
      return defaultValue
    }
  }, [searchParams, key, defaultValue, parse])

  const setValue = useCallback(
    (val: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (val === defaultValue || val === '' || val == null) {
            next.delete(key)
          } else {
            next.set(key, serialize(val))
          }
          return next
        },
        { replace: false },
      )
    },
    [key, setSearchParams, serialize, defaultValue],
  )

  return [value, setValue]
}
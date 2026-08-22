/**
 * 最近访问 hook
 *
 * localStorage.qt.recent 持久化，最多 10 条超出淘汰最旧。
 */

import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'

export interface RecentItem {
  path: string
  label: string
  ts: number
}

const STORAGE_KEY = 'qt.recent'
const MAX_ITEMS = 10

function readStored(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as RecentItem[]
    if (!Array.isArray(arr)) return []
    return arr.slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

function writeStored(items: RecentItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export function useRecentAccess() {
  const [recent, setRecent] = useState<RecentItem[]>(readStored)
  const location = useLocation()

  const push = useCallback((item: Omit<RecentItem, 'ts'>) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.path !== item.path)
      const next = [{ ...item, ts: Date.now() }, ...filtered].slice(0, MAX_ITEMS)
      writeStored(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setRecent([])
    writeStored([])
  }, [])

  return { recent, push, clear }
}

/** 自动追踪路由变更（在 AppShellV2 中使用） */
export function useAutoRecentAccess() {
  const { recent, push, clear } = useRecentAccess()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname === '/') return
    const label = document.title.replace(/ ·.*$/, '') || location.pathname
    push({ path: location.pathname, label })
  }, [location.pathname, push])

  return { recent, push, clear }
}
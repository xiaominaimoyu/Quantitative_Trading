/**
 * 侧栏形态 hook
 *
 * 三形态：expanded（232px）/ collapsed（64px 图标轨）/ hidden（<1024px 抽屉）
 * 持久化 localStorage.qt.sider
 */

import { useEffect, useState, useCallback } from 'react'
import { useViewport } from './useViewport'

export type SiderMode = 'expanded' | 'collapsed' | 'hidden'

const STORAGE_KEY = 'qt.sider'

function readStored(): SiderMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'expanded' || v === 'collapsed') return v
  } catch {
    // ignore
  }
  return 'expanded'
}

function writeStored(mode: SiderMode): void {
  try {
    if (mode !== 'hidden') localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function useSiderState() {
  const { breakpoint } = useViewport()
  const [userMode, setUserMode] = useState<SiderMode>(readStored)

  const mode: SiderMode = breakpoint === 'sm' || breakpoint === 'xs' ? 'hidden' : userMode

  useEffect(() => {
    writeStored(userMode)
  }, [userMode])

  const toggle = useCallback(() => {
    setUserMode((p) => (p === 'expanded' ? 'collapsed' : 'expanded'))
  }, [])

  const setMode = useCallback((m: SiderMode) => setUserMode(m), [])

  return { mode, userMode, toggle, setMode }
}
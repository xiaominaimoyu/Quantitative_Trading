/**
 * 视口断点 hook
 *
 * 断点：xl ≥1600 / lg 1280–1599 / md 1024–1279 / sm 768–1023 / xs <768
 */

import { useEffect, useState } from 'react'
import { breakpointTokens } from '@/theme/tokens/v2'

export type Breakpoint = 'xl' | 'lg' | 'md' | 'sm' | 'xs'

function getBreakpoint(width: number): Breakpoint {
  if (width >= breakpointTokens.xl) return 'xl'
  if (width >= breakpointTokens.lg) return 'lg'
  if (width >= breakpointTokens.md) return 'md'
  if (width >= breakpointTokens.sm) return 'sm'
  return 'xs'
}

export function useViewport() {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() =>
    getBreakpoint(window.innerWidth),
  )
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const w = window.innerWidth
        setWidth(w)
        setBreakpoint(getBreakpoint(w))
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return { breakpoint, width }
}
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { marketColors, marketCssVars, type MarketTheme } from './tokens'

export type ThemeMode = MarketTheme

export interface ThemeContextValue {
  /** 当前主题：'normal' 正常（红涨绿跌）| 'colorblind' 色觉辅助（蓝涨橙跌） */
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** 切换（可传目标模式，缺省取反） */
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('normal')

  // 行情色写入 CSS 变量，供 ECharts 与数字组件读取
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(marketCssVars.up, marketColors[mode].up)
    root.style.setProperty(marketCssVars.down, marketColors[mode].down)
  }, [mode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((m) => (m === 'normal' ? 'colorblind' : 'normal')),
    }),
    [mode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用')
  }
  return ctx
}

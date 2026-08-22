import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  colorPalette,
  marketColors,
  densityTokens,
  colorCssVarNames,
  marketCssVarNames,
  densityCssVarNames,
  type UiTheme,
  type MarketTheme,
  type Density,
} from './tokens/v2'

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type ThemeMode = MarketTheme

export interface ThemeContextValue {
  /** 界面主题 */
  ui: UiTheme
  /** 行情色板 */
  market: MarketTheme
  /** 密度 */
  density: Density
  /** 设置界面主题 */
  setUi: (ui: UiTheme) => void
  /** 设置行情色板 */
  setMarket: (market: MarketTheme) => void
  /** 设置密度 */
  setDensity: (density: Density) => void
  /** 切换界面主题 */
  toggleUi: () => void
  /** 切换行情色板 */
  toggleMarket: () => void
  /** 切换密度 */
  toggleDensity: () => void
  /** 当前生效密度（含 override） */
  effectiveDensity: Density
  /** 临时覆盖密度（报告页强制 comfortable） */
  overrideDensity: (d: Density | null) => void
  /** 向后兼容：mode = market */
  mode: ThemeMode
  /** 向后兼容：setMode = setMarket */
  setMode: (mode: ThemeMode) => void
  /** 向后兼容：toggle = toggleMarket */
  toggle: () => void
}

// ─────────────────────────────────────────────
// localStorage 键
// ─────────────────────────────────────────────

const STORAGE_KEYS = {
  ui: 'qt.theme.ui',
  market: 'qt.theme.market',
  density: 'qt.theme.density',
} as const

// ─────────────────────────────────────────────
// 安全读取 localStorage
// ─────────────────────────────────────────────

function readStorage<T extends string>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key)
    if (val === null) return fallback
    return val as T
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // localStorage 不可用时静默降级
  }
}

// ─────────────────────────────────────────────
// CSS 变量写入
// ─────────────────────────────────────────────

function applyColorVars(ui: UiTheme): void {
  const root = document.documentElement
  const palette = colorPalette[ui]
  for (const key of Object.keys(palette) as (keyof typeof palette)[]) {
    root.style.setProperty(colorCssVarNames[key], palette[key])
  }
}

function applyMarketVars(ui: UiTheme, market: MarketTheme): void {
  const root = document.documentElement
  const colors = marketColors[ui][market]
  root.style.setProperty(marketCssVarNames.up, colors.up)
  root.style.setProperty(marketCssVarNames.down, colors.down)
  root.style.setProperty(marketCssVarNames.flat, colors.flat)
}

function applyDensityVars(density: Density): void {
  const root = document.documentElement
  const tokens = densityTokens[density]
  root.style.setProperty(densityCssVarNames.tableRowHeight, `${tokens.tableRowHeight}px`)
  root.style.setProperty(densityCssVarNames.cardPadding, `${tokens.cardPadding}px`)
  root.style.setProperty(densityCssVarNames.fontSize, `${tokens.fontSize}px`)
  root.style.setProperty(densityCssVarNames.menuItemHeight, `${tokens.menuItemHeight}px`)
  root.style.setProperty(densityCssVarNames.controlHeight, `${tokens.controlHeight}px`)
}

function applyDataAttrs(ui: UiTheme, market: MarketTheme, density: Density): void {
  const root = document.documentElement
  root.setAttribute('data-theme', ui)
  root.setAttribute('data-market', market)
  root.setAttribute('data-density', density)
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [ui, setUiState] = useState<UiTheme>(() => readStorage(STORAGE_KEYS.ui, 'dark'))
  const [market, setMarketState] = useState<MarketTheme>(() =>
    readStorage(STORAGE_KEYS.market, 'normal'),
  )
  const [density, setDensityState] = useState<Density>(() =>
    readStorage(STORAGE_KEYS.density, 'compact'),
  )
  const [densityOverride, setDensityOverride] = useState<Density | null>(null)

  const effectiveDensity = densityOverride ?? density

  // 原子写入：data-* 属性 + CSS 变量 + localStorage
  useEffect(() => {
    applyDataAttrs(ui, market, effectiveDensity)
    applyColorVars(ui)
    applyMarketVars(ui, market)
    applyDensityVars(effectiveDensity)
  }, [ui, market, effectiveDensity])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.ui, ui)
  }, [ui])
  useEffect(() => {
    writeStorage(STORAGE_KEYS.market, market)
  }, [market])
  useEffect(() => {
    writeStorage(STORAGE_KEYS.density, density)
  }, [density])

  const setUi = useCallback((v: UiTheme) => setUiState(v), [])
  const setMarket = useCallback((v: MarketTheme) => setMarketState(v), [])
  const setDensity = useCallback((v: Density) => setDensityState(v), [])
  const toggleUi = useCallback(() => setUiState((p) => (p === 'dark' ? 'light' : 'dark')), [])
  const toggleMarket = useCallback(
    () => setMarketState((p) => (p === 'normal' ? 'colorblind' : 'normal')),
    [],
  )
  const toggleDensity = useCallback(
    () => setDensityState((p) => (p === 'compact' ? 'comfortable' : 'compact')),
    [],
  )
  const overrideDensity = useCallback((d: Density | null) => setDensityOverride(d), [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      ui,
      market,
      density,
      setUi,
      setMarket,
      setDensity,
      toggleUi,
      toggleMarket,
      toggleDensity,
      effectiveDensity,
      overrideDensity,
      mode: market,
      setMode: setMarket,
      toggle: toggleMarket,
    }),
    [
      ui,
      market,
      density,
      effectiveDensity,
      setUi,
      setMarket,
      setDensity,
      toggleUi,
      toggleMarket,
      toggleDensity,
      overrideDensity,
    ],
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

// ─────────────────────────────────────────────
// 报告强制舒适密度 hook
// ─────────────────────────────────────────────

export function useDensityOverride(density: Density = 'comfortable') {
  const { overrideDensity } = useTheme()
  const savedRef = useRef<Density | null>(null)

  useEffect(() => {
    savedRef.current = density
    overrideDensity(density)
    return () => {
      overrideDensity(null)
    }
  }, [density, overrideDensity])
}

/**
 * 设计令牌 v2（Design Tokens v2）
 *
 * 五组令牌纯数据：色板 / 行情色 / 密度 / 动效 / 断点。
 * 无运行时副作用，由 ThemeContext 与 index.css 消费。
 *
 * 依据：docs/FRONTEND_REDESIGN.md §3 设计系统 v2
 */

// ─────────────────────────────────────────────
// 1. 色板令牌
// ─────────────────────────────────────────────

export interface ColorPaletteTokens {
  /** 页面底色 */
  bgPage: string
  /** 卡片/表格容器 */
  bgContainer: string
  /** 弹层/抽屉/悬浮 */
  bgElevated: string
  /** 行 hover */
  bgHover: string
  /** 常规分隔线 */
  borderBase: string
  /** 输入框/强调分隔 */
  borderStrong: string
  /** 正文/标题 */
  textPrimary: string
  /** 次要信息 */
  textSecondary: string
  /** 辅助/占位 */
  textTertiary: string
  /** 主操作/链接/选中 */
  colorPrimary: string
  /** 主色 hover */
  colorPrimaryHover: string
  /** 成功/通过 */
  colorSuccess: string
  /** 警告/待处理 */
  colorWarning: string
  /** 失败/阻断 */
  colorError: string
  /** 运行中/处理中 */
  colorProcessing: string
  /** 阴影 e1（卡片） */
  shadowE1: string
  /** 阴影 e2（弹层） */
  shadowE2: string
}

export const colorPalette: Record<'dark' | 'light', ColorPaletteTokens> = {
  dark: {
    bgPage: '#0E1117',
    bgContainer: '#161B26',
    bgElevated: '#1D2433',
    bgHover: 'rgba(255,255,255,0.06)',
    borderBase: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    textPrimary: 'rgba(255,255,255,0.92)',
    textSecondary: 'rgba(255,255,255,0.65)',
    textTertiary: 'rgba(255,255,255,0.45)',
    colorPrimary: '#5B7CFF',
    colorPrimaryHover: '#7A93FF',
    colorSuccess: '#3FB950',
    colorWarning: '#D29922',
    colorError: '#F85149',
    colorProcessing: '#58A6FF',
    shadowE1: 'none',
    shadowE2: '0 8px 24px rgba(0,0,0,0.45)',
  },
  light: {
    bgPage: '#F5F6F8',
    bgContainer: '#FFFFFF',
    bgElevated: '#FFFFFF',
    bgHover: 'rgba(0,0,0,0.04)',
    borderBase: 'rgba(0,0,0,0.08)',
    borderStrong: 'rgba(0,0,0,0.16)',
    textPrimary: 'rgba(0,0,0,0.88)',
    textSecondary: 'rgba(0,0,0,0.65)',
    textTertiary: 'rgba(0,0,0,0.45)',
    colorPrimary: '#2F54EB',
    colorPrimaryHover: '#4076FF',
    colorSuccess: '#389E0D',
    colorWarning: '#C47B0A',
    colorError: '#CF1322',
    colorProcessing: '#1677FF',
    shadowE1: '0 1px 2px rgba(0,0,0,0.04)',
    shadowE2: '0 4px 12px rgba(0,0,0,0.08)',
  },
}

// ─────────────────────────────────────────────
// 2. 行情色令牌
// ─────────────────────────────────────────────

export interface MarketColorTokens {
  up: string
  down: string
  flat: string
}

export const marketColors: Record<
  'dark' | 'light',
  Record<'normal' | 'colorblind', MarketColorTokens>
> = {
  dark: {
    normal: { up: '#FF5C5C', down: '#2FBF71', flat: 'rgba(255,255,255,0.45)' },
    colorblind: { up: '#4DA3FF', down: '#FF9F43', flat: 'rgba(255,255,255,0.45)' },
  },
  light: {
    normal: { up: '#CF1322', down: '#237804', flat: 'rgba(0,0,0,0.45)' },
    colorblind: { up: '#0958D9', down: '#D46B08', flat: 'rgba(0,0,0,0.45)' },
  },
}

// ─────────────────────────────────────────────
// 3. 密度令牌
// ─────────────────────────────────────────────

export interface DensityTokens {
  /** 表格行高 */
  tableRowHeight: number
  /** 卡片内边距 */
  cardPadding: number
  /** 正文字号 */
  fontSize: number
  /** 菜单项高 */
  menuItemHeight: number
  /** 表单控件高 */
  controlHeight: number
}

export const densityTokens: Record<'compact' | 'comfortable', DensityTokens> = {
  compact: {
    tableRowHeight: 40,
    cardPadding: 12,
    fontSize: 13,
    menuItemHeight: 36,
    controlHeight: 28,
  },
  comfortable: {
    tableRowHeight: 48,
    cardPadding: 16,
    fontSize: 14,
    menuItemHeight: 40,
    controlHeight: 32,
  },
}

// ─────────────────────────────────────────────
// 4. 动效令牌
// ─────────────────────────────────────────────

export const motionTokens = {
  fast: '120ms',
  base: '180ms',
  slow: '240ms',
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const

// ─────────────────────────────────────────────
// 5. 断点令牌
// ─────────────────────────────────────────────

export const breakpointTokens = {
  xl: 1600,
  lg: 1280,
  md: 1024,
  sm: 768,
  xs: 0,
} as const

// ─────────────────────────────────────────────
// 6. 字体令牌
// ─────────────────────────────────────────────

export const fontStacks = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', Menlo, monospace",
} as const

export const fontSizes = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 20,
  kpi: 28,
  hero: 32,
} as const

// ─────────────────────────────────────────────
// 7. 圆角令牌
// ─────────────────────────────────────────────

export const radiusTokens = {
  sm: 4,
  md: 6,
  lg: 8,
} as const

// ─────────────────────────────────────────────
// 8. z-index 层级令牌
// ─────────────────────────────────────────────

export const zIndexTokens = {
  sticky: 100,
  header: 200,
  drawer: 500,
  modal: 600,
  popover: 700,
  toast: 800,
  commandPalette: 900,
} as const

// ─────────────────────────────────────────────
// 9. 布局令牌
// ─────────────────────────────────────────────

export const layoutTokens = {
  siderWidth: 232,
  siderCollapsedWidth: 64,
  headerHeight: 56,
  contentMaxWidth: 1600,
} as const

// ─────────────────────────────────────────────
// 10. CSS 变量名映射
// ─────────────────────────────────────────────

/** 将 ColorPaletteTokens 的 key 转为 CSS 变量名 */
export const colorCssVarNames: Record<keyof ColorPaletteTokens, string> = {
  bgPage: '--bg-page',
  bgContainer: '--bg-container',
  bgElevated: '--bg-elevated',
  bgHover: '--bg-hover',
  borderBase: '--border-base',
  borderStrong: '--border-strong',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  colorPrimary: '--color-primary',
  colorPrimaryHover: '--color-primary-hover',
  colorSuccess: '--color-success',
  colorWarning: '--color-warning',
  colorError: '--color-error',
  colorProcessing: '--color-processing',
  shadowE1: '--shadow-e1',
  shadowE2: '--shadow-e2',
}

export const marketCssVarNames = {
  up: '--market-up',
  down: '--market-down',
  flat: '--market-flat',
} as const

export const densityCssVarNames = {
  tableRowHeight: '--density-table-row-height',
  cardPadding: '--density-card-padding',
  fontSize: '--density-font-size',
  menuItemHeight: '--density-menu-item-height',
  controlHeight: '--density-control-height',
} as const

// ─────────────────────────────────────────────
// 类型导出
// ─────────────────────────────────────────────

export type UiTheme = 'dark' | 'light'
export type MarketTheme = 'normal' | 'colorblind'
export type Density = 'compact' | 'comfortable'
/**
 * 设计令牌（Design Tokens）
 *
 * 语义色（系统状态）与行情色（市场涨跌）刻意隔离：
 * - 语义色：主色/成功/警告/错误/处理中/信息，注入 AntD ConfigProvider。
 * - 行情色：红涨绿跌（normal）或蓝涨橙跌（colorblind），经 CSS 变量
 *   --market-up / --market-down 暴露给图表与数字组件，随主题切换。
 */

export const semanticColors = {
  /** 主色 */
  primary: '#2F54EB',
  /** 成功 */
  success: '#389E0D',
  /** 警告 */
  warning: '#D48806',
  /** 错误 */
  error: '#CF1322',
  /** 处理中 */
  processing: '#1677FF',
  /** 信息 */
  info: '#595959',
} as const

export type SemanticColorKey = keyof typeof semanticColors

/** 色觉辅助主题 */
export const marketColors = {
  /** 正常：红涨绿跌 */
  normal: { up: '#CF1322', down: '#237804' },
  /** 色觉辅助：蓝涨橙跌 */
  colorblind: { up: '#0958D9', down: '#D46B08' },
} as const

export type MarketTheme = keyof typeof marketColors

/** 中文系统字体栈 */
export const fontStacks = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  /** 等宽字体：ID / 哈希 */
  mono: "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', Menlo, monospace",
} as const

/** 布局常量（桌面优先基准 1440px） */
export const layoutTokens = {
  siderWidth: 224,
  headerHeight: 56,
  contentMaxWidth: 1440,
} as const

/** CSS 变量名（ThemeContext 写入 :root） */
export const marketCssVars = {
  up: '--market-up',
  down: '--market-down',
} as const

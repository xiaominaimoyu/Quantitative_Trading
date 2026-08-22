/**
 * 设计令牌（Design Tokens）— v2 别名层
 *
 * 本文件仅作 re-export，保证存量组件 import 不破坏。
 * 真实令牌数据在 ./tokens/v2.ts。
 *
 * 语义色取浅色主题值（与存量一致）；
 * 行情色取浅色 normal/colorblind（与存量一致）。
 */

import {
  colorPalette,
  marketColors as v2MarketColors,
  fontStacks as v2FontStacks,
  layoutTokens as v2LayoutTokens,
  type MarketTheme as V2MarketTheme,
} from './tokens/v2'

// ─────────────────────────────────────────────
// 语义色（取浅色主题，与存量一致）
// ─────────────────────────────────────────────

export const semanticColors = {
  primary: colorPalette.light.colorPrimary,
  success: colorPalette.light.colorSuccess,
  warning: colorPalette.light.colorWarning,
  error: colorPalette.light.colorError,
  processing: colorPalette.light.colorProcessing,
  info: '#595959',
} as const

export type SemanticColorKey = keyof typeof semanticColors

// ─────────────────────────────────────────────
// 行情色（取浅色主题，与存量一致）
// ─────────────────────────────────────────────

export const marketColors = {
  normal: {
    up: v2MarketColors.light.normal.up,
    down: v2MarketColors.light.normal.down,
  },
  colorblind: {
    up: v2MarketColors.light.colorblind.up,
    down: v2MarketColors.light.colorblind.down,
  },
} as const

export type MarketTheme = V2MarketTheme

// ─────────────────────────────────────────────
// 字体栈
// ─────────────────────────────────────────────

export const fontStacks = v2FontStacks

// ─────────────────────────────────────────────
// 布局常量（沿用 v2，siderWidth 232、contentMaxWidth 1600）
// ─────────────────────────────────────────────

export const layoutTokens = {
  siderWidth: v2LayoutTokens.siderWidth,
  headerHeight: v2LayoutTokens.headerHeight,
  contentMaxWidth: v2LayoutTokens.contentMaxWidth,
} as const

// ─────────────────────────────────────────────
// CSS 变量名（ThemeContext 写入 :root）
// ─────────────────────────────────────────────

export const marketCssVars = {
  up: '--market-up',
  down: '--market-down',
} as const

/**
 * MarketValueV2 — 行情数值 v2
 *
 * ▲▼ 符号 + 行情色（CSS 变量）+ tabular
 * size: sm（表格内）/ default / large
 */

import type { ReactNode } from 'react'

export interface MarketValueV2Props {
  value: number
  prefix?: string
  suffix?: string
  precision?: number
  size?: 'sm' | 'default' | 'large'
  showSymbol?: boolean
  colored?: boolean
}

const SIZE_MAP = {
  sm: { fontSize: 12, symbolSize: 10 },
  default: { fontSize: 14, symbolSize: 12 },
  large: { fontSize: 20, symbolSize: 14 },
}

export function MarketValueV2({
  value,
  prefix = '',
  suffix = '',
  precision = 2,
  size = 'default',
  showSymbol = true,
  colored = true,
}: MarketValueV2Props): ReactNode {
  const isUp = value > 0
  const isDown = value < 0
  const isFlat = value === 0

  const color = colored
    ? isUp
      ? 'var(--market-up)'
      : isDown
        ? 'var(--market-down)'
        : 'var(--market-flat)'
    : 'var(--text-primary)'

  const sizes = SIZE_MAP[size]
  const symbol = isUp ? '▲' : isDown ? '▼' : '—'
  const absStr = Math.abs(value).toFixed(precision)

  return (
    <span
      className="qt-market-value qt-tabular"
      style={{ color, fontSize: sizes.fontSize, fontWeight: 500 }}
    >
      {showSymbol && (
        <span style={{ fontSize: sizes.symbolSize, marginRight: 2 }}>{symbol}</span>
      )}
      {prefix}
      {absStr}
      {suffix}
    </span>
  )
}

export default MarketValueV2
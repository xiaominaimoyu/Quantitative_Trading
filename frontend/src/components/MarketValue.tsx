/**
 * MarketValue —— 行情数字（涨跌符号 ▲▼/+− + 行情色 + 可选浅色底块）。
 *
 * - 颜色非唯一载体：始终带 ▲▼（或 +−）符号，随色觉主题切换（红涨绿跌 ↔ 蓝涨橙跌）。
 * - 颜色经 CSS 变量 var(--market-up)/var(--market-down) 读取，主题切换即时生效。
 * - 金融数字启用 tabular-nums，避免跳动。
 */

import { useTheme } from '@/theme'
import { formatMoney } from '@/shared/format'

export type MarketValueMode = 'percent' | 'amount'

export type MarketValueSize = 'small' | 'default' | 'large'

export interface MarketValueProps {
  /** 涨跌值：percent 模式为百分比数值（如 2.34），amount 模式为金额 */
  value: number
  /** 展示模式，默认 'percent' */
  mode?: MarketValueMode
  /** 是否显示正负符号，默认 true */
  showSign?: boolean
  /** 是否渲染浅色背景块，默认 false */
  background?: boolean
  /** 是否显示符号箭头（▲▼），默认 true */
  showArrow?: boolean
  size?: MarketValueSize
  className?: string
  /** 百分比精度（仅 percent 模式），默认 2 */
  digits?: number
}

const SIZE_STYLE: Record<MarketValueSize, { fontSize: number; fontWeight: number }> = {
  small: { fontSize: 12, fontWeight: 500 },
  default: { fontSize: 14, fontWeight: 600 },
  large: { fontSize: 22, fontWeight: 600 },
}

export default function MarketValue({
  value,
  mode = 'percent',
  showSign = true,
  background = false,
  showArrow = true,
  size = 'default',
  className,
  digits = 2,
}: MarketValueProps) {
  const { mode: themeMode } = useTheme()

  const up = value > 0
  const down = value < 0
  const flat = value === 0

  // 主题切换后直接读 CSS 变量；此处仍订阅 useTheme 以触发重渲染
  void themeMode
  const cssVar = up
    ? 'var(--market-up)'
    : down
      ? 'var(--market-down)'
      : 'var(--market-flat, rgba(0, 0, 0, 0.45))'

  const sign = flat ? '' : up ? '+' : '-'
  const arrow = flat ? '' : up ? '▲' : '▼'
  const body =
    mode === 'percent'
      ? `${showSign ? sign : ''}${Math.abs(value).toFixed(digits)}%`
      : `${showSign ? sign : ''}${formatMoney(Math.abs(value), digits)}`

  const { fontSize, fontWeight } = SIZE_STYLE[size]

  return (
    <span
      className={[
        'qt-market-value',
        background ? 'qt-market-value--bg' : '',
        className ?? '',
      ].join(' ')}
      style={{
        color: cssVar,
        fontSize,
        fontWeight,
      }}
      title={`${mode === 'percent' ? '涨跌幅' : '涨跌额'}：${body}`}
    >
      {showArrow ? <span aria-hidden="true">{arrow} </span> : null}
      {body}
    </span>
  )
}

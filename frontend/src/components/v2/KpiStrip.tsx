/**
 * KpiStrip — 指标带
 *
 * 通栏分段（分割线），3–6 段等分
 * 数值 28px/600 tabular + 口径 ⓘ + 可选 sparkline + 可选涨跌徽标
 */

import { useRef, useEffect, type ReactNode } from 'react'
import { Popover, Tooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import * as echarts from 'echarts'
import { registerEchartsThemes, getEchartsThemeName } from '@/echarts/themes'
import { useTheme } from '@/theme'
import { MarketValueV2 } from './MarketValueV2'
import { useViewport } from '@/shared/useViewport'

export interface KpiItem {
  label: string
  value: number | string
  unit?: string
  precision?: number
  description?: string
  sparkline?: number[]
  marketChange?: number
  onClick?: () => void
}

interface KpiStripProps {
  items: KpiItem[]
  layout?: 'strip' | 'card'
}

function Sparkline({ data }: { data: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { ui } = useTheme()

  useEffect(() => {
    registerEchartsThemes()
    if (!ref.current) return
    chartRef.current?.dispose()
    chartRef.current = echarts.init(ref.current, getEchartsThemeName(ui))

    chartRef.current.setOption({
      series: [
        {
          type: 'line',
          data,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 1.5 },
          areaStyle: { opacity: 0.08 },
        },
      ],
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false },
      yAxis: { type: 'value', show: false },
    })

    return () => chartRef.current?.dispose()
  }, [data, ui])

  return <div ref={ref} style={{ width: 60, height: 24 }} />
}

export function KpiStrip({ items, layout = 'strip' }: KpiStripProps) {
  const { breakpoint } = useViewport()
  const columns = breakpoint === 'xl' ? Math.min(items.length, 6) : breakpoint === 'md' ? 2 : Math.min(items.length, 4)

  if (layout === 'card') {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 12,
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            onClick={item.onClick}
            style={{
              padding: 'var(--density-card-padding)',
              background: 'var(--bg-container)',
              border: '1px solid var(--border-base)',
              borderRadius: 'var(--radius-md)',
              cursor: item.onClick ? 'pointer' : 'default',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>
              {item.label}
              {item.description && (
                <Popover content={item.description}>
                  <InfoCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                </Popover>
              )}
            </div>
            <div
              className="qt-tabular"
              style={{ fontSize: 'var(--font-size-kpi)', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              {typeof item.value === 'number' ? item.value.toFixed(item.precision ?? 2) : item.value}
              {item.unit && <span style={{ fontSize: 14, marginLeft: 4 }}>{item.unit}</span>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 0,
        background: 'var(--bg-container)',
        border: '1px solid var(--border-base)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          onClick={item.onClick}
          style={{
            padding: '12px 16px',
            borderRight: i < items.length - 1 ? '1px solid var(--border-base)' : 'none',
            cursor: item.onClick ? 'pointer' : 'default',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{item.label}</span>
            {item.description && (
              <Popover content={item.description}>
                <InfoCircleOutlined style={{ fontSize: 11, color: 'var(--text-tertiary)', cursor: 'help' }} />
              </Popover>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="qt-tabular"
              style={{ fontSize: 'var(--font-size-kpi)', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              {typeof item.value === 'number' ? item.value.toFixed(item.precision ?? 2) : item.value}
              {item.unit && <span style={{ fontSize: 14, marginLeft: 4 }}>{item.unit}</span>}
            </span>
            {item.marketChange != null && <MarketValueV2 value={item.marketChange} size="sm" suffix="%" />}
            {item.sparkline && <Sparkline data={item.sparkline} />}
          </div>
        </div>
      ))}
    </div>
  )
}

export default KpiStrip
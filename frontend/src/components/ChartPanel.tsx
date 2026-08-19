/**
 * ChartPanel —— ECharts 统一封装。
 *
 * 约定（研究控制台基调）：
 * - 主题色注入：按当前色觉主题注入主色 + 行情色（涨/跌）调色板；
 * - 缺失区间断开不连线：所有 line 系列强制 connectNulls: false；
 * - 无数据渲染空态说明（而非零值线）；
 * - 页脚元信息：数据截止 / 版本 / 降采样说明；
 * - 「查看数据表」折叠入口：表格数据由页面传入。
 */

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption, SeriesOption } from 'echarts'
import { Card, Collapse, Empty, Table } from 'antd'
import { useTheme } from '@/theme'
import { marketColors, semanticColors, fontStacks } from '@/theme'
import { formatCompact } from '@/shared/format'

export interface ChartPanelProps {
  title?: ReactNode
  chartOption: EChartsOption
  /** 图表高度，默认 320 */
  height?: number | string
  /** 数据截止说明，如 "2026-07-31" */
  dataCutoff?: string
  /** 版本标识，如 "v3" */
  versionLabel?: string
  /** 降采样说明（页面生成文案），如 "已降采样：显示 240 / 原始 960 点" */
  downsampleNote?: string
  /** 数据表（「查看数据表」折叠内容）；缺省不渲染折叠入口 */
  tableData?: Array<Record<string, unknown>> | null
  /** 空态文案，默认 "暂无数据" */
  emptyText?: string
  className?: string
  style?: CSSProperties
}

/** 空数据判定：无 series，或全部 series 数据为空 */
function isOptionEmpty(option: EChartsOption): boolean {
  const series = option.series
  if (!Array.isArray(series) || series.length === 0) return true
  return series.every((s) => {
    const data = (s as { data?: unknown }).data
    return (
      data == null || (Array.isArray(data) && data.length === 0)
    )
  })
}

/** 强制 line 系列断开缺失区间 */
function withConnectNullsFalse(
  series: SeriesOption | SeriesOption[] | undefined,
): SeriesOption | SeriesOption[] | undefined {
  if (!Array.isArray(series)) return series
  return series.map((s) => {
    const type = (s as { type?: string }).type
    if (type === 'line' || type === 'bar') {
      return { ...s, connectNulls: false } as SeriesOption
    }
    return s
  })
}

export default function ChartPanel({
  title,
  chartOption,
  height = 320,
  dataCutoff,
  versionLabel,
  downsampleNote,
  tableData,
  emptyText = '暂无数据',
  className,
  style,
}: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const { mode: themeMode } = useTheme()

  const empty = useMemo(() => isOptionEmpty(chartOption), [chartOption])

  // 初始化 + 自适应尺寸
  useEffect(() => {
    if (!containerRef.current) return
    const chart = echarts.init(containerRef.current)
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // 主题/数据变化 → 重建 option（含主题色注入）
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || empty) return

    const m = marketColors[themeMode]
    const palette = [
      semanticColors.primary,
      m.up,
      m.down,
      semanticColors.processing,
      semanticColors.warning,
      semanticColors.success,
      semanticColors.info,
      '#722ED1',
      '#13C2C2',
      '#FA8C16',
    ]

    const injected: EChartsOption = {
      textStyle: {
        fontFamily: fontStacks.system,
        color: 'rgba(0, 0, 0, 0.65)',
      },
      legend: {
        textStyle: { color: 'rgba(0, 0, 0, 0.65)' },
        ...(chartOption.legend as object | undefined),
      },
      tooltip: {
        confine: true,
        ...(chartOption.tooltip as object | undefined),
      },
      grid: {
        containLabel: true,
        left: 8,
        right: 16,
        top: 24,
        bottom: 8,
        ...(chartOption.grid as object | undefined),
      },
      ...chartOption,
      color: chartOption.color ?? palette,
      series: withConnectNullsFalse(chartOption.series),
    }

    chart.setOption(injected, { notMerge: true })
  }, [chartOption, themeMode, empty])

  const metaLine = [dataCutoff && `数据截止 ${dataCutoff}`, versionLabel && `版本 ${versionLabel}`, downsampleNote]
    .filter(Boolean)
    .join(' · ')

  const tableColumns = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    const keys = Object.keys(tableData[0])
    return keys.map((k) => ({
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: true,
      render: (v: unknown) =>
        typeof v === 'number'
          ? <span className="qt-tabular">{v.toLocaleString('zh-CN')}</span>
          : String(v ?? '—'),
    }))
  }, [tableData])

  return (
    <Card
      size="small"
      className={className}
      style={style}
      title={title}
      styles={{ body: { padding: 16 } }}
    >
      <div ref={containerRef} style={{ width: '100%', height }} aria-hidden={empty}>
        {empty ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={emptyText}
            />
          </div>
        ) : null}
      </div>
      {metaLine ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          {metaLine}
        </div>
      ) : null}
      {tableData && tableData.length > 0 ? (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'table',
              label: `查看数据表（${formatCompact(tableData.length)} 行）`,
              children: (
                <div className="qt-table-scroll">
                  <Table
                    size="small"
                    columns={tableColumns}
                    dataSource={tableData}
                    rowKey={(_, i) => String(i)}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                  />
                </div>
              ),
            },
          ]}
        />
      ) : null}
    </Card>
  )
}

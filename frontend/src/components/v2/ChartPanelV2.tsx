/**
 * ChartPanelV2 — 图表面板 v2
 *
 * 统一外壳：标题 + 副标题 + 工具区 + 图表区 + 状态层
 * 双主题切换、全屏、下载 PNG（暗色浅底）
 */

import { useRef, useEffect, useState, type ReactNode } from 'react'
import { Button, Modal, Empty, Spin, Tooltip, Segmented, Switch } from 'antd'
import {
  DownloadOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { registerEchartsThemes, getEchartsThemeName } from '@/echarts/themes'
import { buildPngFilename, timeRangePresets, type TimeRangePreset } from '@/echarts/formatters'
import { useTheme } from '@/theme'

interface ChartPanelV2Props {
  title?: string
  subtitle?: string
  chartOption: EChartsOption
  height?: number
  toolbar?: boolean
  loading?: boolean
  error?: { message: string; onRetry?: () => void }
  empty?: boolean
  downloadName?: string
  ariaLabel?: string
  showTimeRange?: boolean
  showNormalize?: boolean
  onTimeRangeChange?: (range: TimeRangePreset) => void
}

export function ChartPanelV2({
  title,
  subtitle,
  chartOption,
  height = 320,
  toolbar = true,
  loading = false,
  error,
  empty = false,
  downloadName = 'chart',
  ariaLabel,
  showTimeRange = false,
  showNormalize = false,
  onTimeRangeChange,
}: ChartPanelV2Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { ui } = useTheme()
  const [fullscreen, setFullscreen] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('1M')
  const [normalized, setNormalized] = useState(false)

  useEffect(() => {
    registerEchartsThemes()
  }, [])

  useEffect(() => {
    if (!containerRef.current || loading || error || empty) return

    chartRef.current?.dispose()
    chartRef.current = echarts.init(
      containerRef.current,
      getEchartsThemeName(ui),
    )
    chartRef.current.setOption(chartOption)

    const onResize = () => chartRef.current?.resize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chartRef.current?.dispose()
    }
  }, [chartOption, ui, loading, error, empty])

  const handleDownload = () => {
    if (!chartRef.current) return
    const chart = chartRef.current

    // 暗色下导出浅底
    if (ui === 'dark') {
      const dom = chart.getDom() as HTMLElement
      const option = chart.getOption() as EChartsOption
      const tempDiv = document.createElement('div')
      tempDiv.style.width = `${dom.offsetWidth}px`
      tempDiv.style.height = `${dom.offsetHeight}px`
      tempDiv.style.position = 'absolute'
      tempDiv.style.left = '-9999px'
      document.body.appendChild(tempDiv)

      const tempChart = echarts.init(tempDiv, 'qt-light')
      tempChart.setOption({ ...option, backgroundColor: '#FFFFFF' })
      const url = tempChart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#FFFFFF',
      })
      tempChart.dispose()
      document.body.removeChild(tempDiv)

      const link = document.createElement('a')
      link.href = url
      link.download = buildPngFilename('page', downloadName)
      link.click()
    } else {
      const url = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#FFFFFF',
      })
      const link = document.createElement('a')
      link.href = url
      link.download = buildPngFilename('page', downloadName)
      link.click()
    }
  }

  const renderToolbar = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {showTimeRange && (
        <Segmented
          size="small"
          value={timeRange}
          onChange={(v) => {
            setTimeRange(v as TimeRangePreset)
            onTimeRangeChange?.(v as TimeRangePreset)
          }}
          options={timeRangePresets.map((p) => ({ label: p.label, value: p.value }))}
        />
      )}
      {showNormalize && (
        <Tooltip title="归一化">
          <Switch
            size="small"
            checked={normalized}
            onChange={setNormalized}
          />
        </Tooltip>
      )}
      <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload} />
      <Button
        size="small"
        icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        onClick={() => setFullscreen(!fullscreen)}
      />
    </div>
  )

  const renderChartArea = (chartHeight: number) => (
    <div style={{ position: 'relative', height: chartHeight }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin />
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Empty description={error.message} />
          {error.onRetry && (
            <Button size="small" icon={<ReloadOutlined />} onClick={error.onRetry}>
              重试
            </Button>
          )}
        </div>
      )}
      {empty && !loading && !error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Empty description="暂无数据" />
        </div>
      )}
      {!loading && !error && !empty && (
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label={ariaLabel ?? title ?? '图表'}
        />
      )}
    </div>
  )

  return (
    <div
      style={{
        background: 'var(--bg-container)',
        border: '1px solid var(--border-base)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--density-card-padding)',
      }}
    >
      {(title || toolbar) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div>
            {title && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {title}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{subtitle}</div>
            )}
          </div>
          {toolbar && renderToolbar()}
        </div>
      )}
      {renderChartArea(height)}

      <Modal
        open={fullscreen}
        onCancel={() => setFullscreen(false)}
        footer={null}
        width="90vw"
        styles={{ body: { height: '80vh', padding: 0 } }}
      >
        {renderChartArea(window.innerHeight * 0.7)}
      </Modal>
    </div>
  )
}

export default ChartPanelV2
/**
 * ECharts 格式化工具与导出辅助
 *
 * 依据：docs/FRONTEND_REDESIGN.md §9.1/§9.3
 */

import * as echarts from 'echarts'

/** 千分位 + 单位缩写（万/亿） */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toLocaleString('zh-CN')
}

/** 千分位 */
export function formatThousands(value: number): string {
  return value.toLocaleString('zh-CN')
}

/** 百分比固定两位小数 */
export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

/** tooltip 数值格式（等宽 tabular + 千分位） */
export function formatTooltipValue(value: number): string {
  return `\`${value.toLocaleString('zh-CN')}\``
}

/** 时间范围快捷段 */
export const timeRangePresets = [
  { label: '1D', value: '1D' },
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '1Y', value: '1Y' },
  { label: '全部', value: 'ALL' },
] as const

export type TimeRangePreset = (typeof timeRangePresets)[number]['value']

/** 下载 PNG 文件名：页面_图表名_时间戳.png */
export function buildPngFilename(page: string, chartName: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${page}_${chartName}_${ts}.png`
}

/** 暗色导出浅底：临时切 qt-light 渲染 → getDataURL → 切回 */
export function exportPngWithLightBg(
  chart: echarts.ECharts,
  page: string,
  chartName: string,
): void {
  const dom = chart.getDom() as HTMLElement
  const originalTheme = dom.getAttribute('data-echarts-theme') || 'qt-dark'

  // 临时切浅色主题
  chart.dispose()
  const lightChart = echarts.init(dom, 'qt-light')
  // 注意：调用方需在 dispose 前保存 option
  // 此函数为辅助，实际使用见 ChartPanelV2 中的封装
  lightChart.setOption({ backgroundColor: '#FFFFFF' })

  const url = lightChart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#FFFFFF',
  })

  const link = document.createElement('a')
  link.href = url
  link.download = buildPngFilename(page, chartName)
  link.click()

  // 切回原主题
  lightChart.dispose()
  echarts.init(dom, originalTheme)
}

/** 初始化图表的便捷方法 */
export function initChart(
  dom: HTMLElement,
  ui: 'dark' | 'light',
): echarts.ECharts {
  const theme = ui === 'dark' ? 'qt-dark' : 'qt-light'
  const chart = echarts.init(dom, theme)
  dom.setAttribute('data-echarts-theme', theme)
  return chart
}
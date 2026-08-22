/**
 * ECharts option 工厂（presets）
 *
 * 可组合的 option 工厂：净值曲线、回撤组合、对比叠加、分布归因、仪表阈值线
 */

import type { EChartsOption } from 'echarts'
import { colorPalette } from '@/theme/tokens/v2'

/** 净值曲线：折线 + 面积填充 8% + 零轴加亮 */
export function netValueCurve(
  data: [string, number][],
  opts?: { name?: string },
): EChartsOption {
  return {
    xAxis: { type: 'category', data: data.map((d) => d[0]) },
    yAxis: { type: 'value' },
    series: [
      {
        name: opts?.name ?? '净值',
        type: 'line',
        data: data.map((d) => d[1]),
        showSymbol: false,
        smooth: true,
        areaStyle: { opacity: 0.08 },
        markLine: {
          symbol: 'none',
          data: [{ yAxis: 0 }],
          lineStyle: { color: 'var(--border-strong)', width: 1 },
        },
      },
    ],
  }
}

/** 回撤组合：inverted 面积图与净值共享 x 轴上下组合 */
export function drawdownCombo(
  netData: [string, number][],
  drawdownData: [string, number][],
): EChartsOption {
  return {
    grid: [
      { left: 48, right: 16, top: 8, height: '55%' },
      { left: 48, right: 16, top: '68%', height: '28%' },
    ],
    xAxis: [
      { type: 'category', data: netData.map((d) => d[0]), gridIndex: 0, show: false },
      { type: 'category', data: drawdownData.map((d) => d[0]), gridIndex: 1 },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, name: '净值' },
      { type: 'value', gridIndex: 1, name: '回撤', inverse: true },
    ],
    series: [
      {
        name: '净值',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: netData.map((d) => d[1]),
        showSymbol: false,
        areaStyle: { opacity: 0.08 },
      },
      {
        name: '回撤',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: drawdownData.map((d) => d[1]),
        showSymbol: false,
        areaStyle: { opacity: 0.12 },
      },
    ],
  }
}

/** 对比叠加：>2 序列不开面积；≥4 强制图例分页 */
export function compareOverlay(
  series: { name: string; data: number[] }[],
  xLabels: string[],
): EChartsOption {
  const showArea = series.length <= 2
  const legendType = series.length >= 4 ? 'scroll' : 'plain'

  return {
    legend: { type: legendType as 'plain' | 'scroll' },
    xAxis: { type: 'category', data: xLabels },
    yAxis: { type: 'value' },
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.data,
      showSymbol: false,
      smooth: true,
      areaStyle: showArea ? { opacity: 0.06 } : undefined,
    })),
  }
}

/** 分布归因：横向条形图 */
export function distributionBar(
  data: { name: string; value: number }[],
): EChartsOption {
  return {
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: data.map((d) => d.name),
      inverse: true,
    },
    series: [
      {
        type: 'bar',
        data: data.map((d) => d.value),
        barMaxWidth: 24,
      },
    ],
  }
}

/** 仪表阈值线 */
export function gaugeWithThreshold(
  value: number,
  thresholds: { value: number; color?: string }[],
  opts?: { min?: number; max?: number; name?: string },
): EChartsOption {
  return {
    series: [
      {
        type: 'gauge',
        min: opts?.min ?? 0,
        max: opts?.max ?? 100,
        detail: { formatter: '{value}' },
        data: [{ value, name: opts?.name ?? '' }],
        markLine: {
          symbol: 'none',
          data: thresholds.map((t) => ({
            yAxis: t.value,
            lineStyle: { color: t.color ?? 'var(--color-warning)' },
          })),
        },
      },
    ],
  }
}

/** 对比固定配色（A/B/C/D 四色从令牌取色） */
export const compareColors = (ui: 'dark' | 'light'): string[] => {
  const p = colorPalette[ui]
  return [p.colorPrimary, p.colorSuccess, p.colorWarning, p.colorError]
}
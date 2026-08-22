/**
 * ECharts 双主题注册（qt-dark / qt-light）
 *
 * 依据：docs/FRONTEND_REDESIGN.md §9.1
 */

import * as echarts from 'echarts'
import { colorPalette, marketColors } from '@/theme/tokens/v2'

type EChartsThemeOption = NonNullable<Parameters<typeof echarts.registerTheme>[1]>

function buildTheme(ui: 'dark' | 'light'): EChartsThemeOption {
  const palette = colorPalette[ui]
  const market = marketColors[ui].normal

  const colorSeq =
    ui === 'dark'
      ? ['#5B7CFF', '#3FB950', '#D29922', '#F85149', '#B16EFF', '#39C5CF']
      : ['#2F54EB', '#389E0D', '#D48806', '#CF1322', '#722ED1', '#08979C']

  return {
    color: colorSeq,
    backgroundColor: 'transparent',
    textStyle: {
      color: palette.textPrimary,
      fontFamily: 'var(--font-system)',
    },
    title: {
      textStyle: { color: palette.textPrimary },
      subtextStyle: { color: palette.textSecondary },
    },
    legend: {
      textStyle: { color: palette.textSecondary },
      inactiveColor: palette.textTertiary,
    },
    tooltip: {
      backgroundColor: palette.bgElevated,
      borderColor: palette.borderBase,
      borderWidth: 1,
      textStyle: {
        color: palette.textPrimary,
        fontFamily: 'var(--font-mono)',
      },
      extraCssText: 'box-shadow: var(--shadow-e2);',
      confine: true,
    },
    grid: {
      borderColor: palette.borderBase,
      borderWidth: 0,
    },
    xAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisTick: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: {
        show: false,
        lineStyle: { color: palette.borderBase, type: 'dashed' },
      },
    },
    yAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisTick: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: {
        show: true,
        lineStyle: { color: palette.borderBase, type: 'dashed' },
      },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisTick: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: { show: false, lineStyle: { color: palette.borderBase } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisTick: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: palette.borderBase, type: 'dashed' } },
    },
    logAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: palette.borderBase, type: 'dashed' } },
    },
    timeAxis: {
      axisLine: { lineStyle: { color: palette.borderBase } },
      axisLabel: { color: palette.textTertiary, fontSize: 11 },
      splitLine: { show: false, lineStyle: { color: palette.borderBase } },
    },
    radar: {
      axisName: { color: palette.textSecondary },
      splitLine: { lineStyle: { color: palette.borderBase } },
      splitArea: { areaStyle: { color: [palette.bgContainer, palette.bgPage] } },
      axisLine: { lineStyle: { color: palette.borderBase } },
    },
    candlestick: {
      itemStyle: {
        color: market.up,
        color0: market.down,
        borderColor: market.up,
        borderColor0: market.down,
      },
    },
    bar: {
      itemStyle: { color: palette.colorPrimary },
    },
    line: {
      lineStyle: { width: 2 },
      itemStyle: { color: palette.colorPrimary },
    },
    scatter: {
      itemStyle: { color: palette.colorPrimary },
    },
    graph: {
      color: colorSeq,
      lineStyle: { color: palette.borderStrong },
    },
    sankey: {
      lineStyle: { color: palette.borderBase },
    },
    boxplot: {
      itemStyle: { color: palette.colorPrimary },
    },
  }
}

let registered = false

export function registerEchartsThemes(): void {
  if (registered) return
  echarts.registerTheme('qt-dark', buildTheme('dark'))
  echarts.registerTheme('qt-light', buildTheme('light'))
  registered = true
}

export function getEchartsThemeName(ui: 'dark' | 'light'): string {
  return ui === 'dark' ? 'qt-dark' : 'qt-light'
}
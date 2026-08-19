/**
 * 格式化工具（全局共享）
 *
 * 精度约束：百分比最多两位小数；金额一律带单位；
 * 时间一律标注时区；大数量使用中文单位（万 / 亿）。
 */

import dayjs from 'dayjs'
import { PLATFORM_TIMEZONE } from './dayjs'

export type DateTimeInput = string | number | Date

export interface FormatDateTimeOptions {
  /** 是否包含秒，默认 false */
  seconds?: boolean
  /** 是否追加时区标注，默认 true */
  zone?: boolean
}

/** 时区标注（如 "Asia/Shanghai (UTC+8)"） */
export function timezoneLabel(): string {
  const offsetMinutes = dayjs().tz(PLATFORM_TIMEZONE).utcOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hh = Math.floor(abs / 60)
  const mm = abs % 60
  return `${PLATFORM_TIMEZONE} (UTC${sign}${hh}:${String(mm).padStart(2, '0')})`
}

/**
 * 格式化时间：YYYY-MM-DD HH:mm，默认带时区标注。
 * 例：formatDateTime('2026-08-08T12:00:00Z')
 *   → "2026-08-08 20:00 (Asia/Shanghai, UTC+8)"
 */
export function formatDateTime(
  value: DateTimeInput,
  options?: FormatDateTimeOptions,
): string {
  const { seconds = false, zone = true } = options ?? {}
  const fmt = seconds ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm'
  const text = dayjs(value).tz(PLATFORM_TIMEZONE).format(fmt)
  return zone ? `${text} (${timezoneLabel()})` : text
}

/**
 * 格式化百分比，默认两位小数。
 * 例：formatPercent(0.1234) → "0.12%"；formatPercent(12.34) → "12.34%"
 * （输入视为百分数值，直接拼 %）
 */
export function formatPercent(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/**
 * 格式化金额，自动切换中文单位，单位明确。
 * 例：formatMoney(12345.6) → "1.23 万"；formatMoney(123456789) → "1.23 亿"
 */
export function formatMoney(value: number, digits = 2): string {
  const abs = Math.abs(value)
  if (abs >= 1e8) {
    return `${(value / 1e8).toFixed(digits)} 亿`
  }
  if (abs >= 1e4) {
    return `${(value / 1e4).toFixed(digits)} 万`
  }
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

/**
 * 紧凑数量（行数 / 记录数）。
 * 例：formatCompact(8432) → "8,432"；formatCompact(123456) → "12.3 万"
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e8) {
    return `${(value / 1e8).toFixed(1)} 亿`
  }
  if (abs >= 1e4) {
    return `${(value / 1e4).toFixed(1)} 万`
  }
  return value.toLocaleString('zh-CN')
}

/**
 * 时长（秒 → 中文）。
 * 例：formatDurationSec(3725) → "1 小时 2 分 5 秒"
 */
export function formatDurationSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} 小时 ${m} 分 ${sec} 秒`
  if (m > 0) return `${m} 分 ${sec} 秒`
  return `${sec} 秒`
}

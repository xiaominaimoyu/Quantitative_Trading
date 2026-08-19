/**
 * StatusTag —— 统一「图标 + 文字 + 色」状态标签。
 *
 * 全部领域词表内置于本组件；未知状态回退为「原样显示 + 中性色」，
 * 保证状态字段演进时界面不崩。
 *
 * 视觉约定：浅色底 + 深色文字 + 图标（与行情数字的纯色文字区分）。
 */

import type { ReactNode } from 'react'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import type { SemanticColorKey } from '@/theme'

export type StatusDomain =
  | 'dataVersion' // 数据版本
  | 'run' // 运行与任务
  | 'task' // 任务中心（与 run 词表一致）
  | 'validation' // 验证结论
  | 'report' // 报告
  | 'quality' // 质量检查
  | 'riskEvent' // 风险事件

export interface StatusTagProps {
  /** 状态键（英文 key，如 'running'）；也接受已本地化的中文文案 */
  status: string
  /** 领域，决定词表映射；缺省取公共词表 */
  domain?: StatusDomain
  /** 覆盖默认图标 */
  icon?: ReactNode
  /** 覆盖默认文案 */
  label?: string
  className?: string
}

interface StatusMeta {
  label: string
  color: SemanticColorKey
  icon: ReactNode
}

const SEMANTIC_COLOR: Record<SemanticColorKey, string> = {
  primary: '#2F54EB',
  success: '#389E0D',
  warning: '#D48806',
  error: '#CF1322',
  processing: '#1677FF',
  info: '#595959',
}

const ICONS = {
  success: <CheckCircleOutlined />,
  fail: <CloseCircleOutlined />,
  warn: <ExclamationCircleOutlined />,
  pending: <ClockCircleOutlined />,
  running: <LoadingOutlined />,
  idle: <MinusCircleOutlined />,
  blocked: <StopOutlined />,
  file: <FileTextOutlined />,
  breaker: <ThunderboltOutlined />,
  manual: <ToolOutlined />,
  unknown: <InfoCircleOutlined />,
} as const

/** 公共词表（未指定 domain 时优先匹配） */
const COMMON: Record<string, StatusMeta> = {
  running: { label: '运行中', color: 'processing', icon: ICONS.running },
  queued: { label: '排队中', color: 'info', icon: ICONS.pending },
  claimed: { label: '已领取', color: 'processing', icon: ICONS.pending },
  cancel_requested: { label: '请求取消', color: 'warning', icon: ICONS.warn },
  success: { label: '成功', color: 'success', icon: ICONS.success },
  failed: { label: '失败', color: 'error', icon: ICONS.fail },
  canceled: { label: '已取消', color: 'info', icon: ICONS.idle },
}

/** 数据版本 */
const DATA_VERSION: Record<string, StatusMeta> = {
  draft: { label: '草稿', color: 'info', icon: ICONS.file },
  validating: { label: '校验中', color: 'processing', icon: ICONS.running },
  available: { label: '可用', color: 'success', icon: ICONS.success },
  failed: { label: '失败', color: 'error', icon: ICONS.fail },
  deprecated: { label: '已停用', color: 'info', icon: ICONS.idle },
}

/** 验证结论 */
const VALIDATION: Record<string, StatusMeta> = {
  passed: { label: '通过', color: 'success', icon: ICONS.success },
  failed: { label: '未通过', color: 'error', icon: ICONS.fail },
  /** 证据不足是正式状态，不是错误 —— 用警告色 */
  insufficient_evidence: { label: '证据不足', color: 'warning', icon: ICONS.warn },
  not_applicable: { label: '不适用', color: 'info', icon: ICONS.idle },
}

/** 报告 */
const REPORT: Record<string, StatusMeta> = {
  draft: { label: '草案', color: 'info', icon: ICONS.file },
  pending_approval: { label: '待批准', color: 'processing', icon: ICONS.pending },
  submitted: { label: '待批准', color: 'processing', icon: ICONS.pending },
  approved: { label: '已批准', color: 'success', icon: ICONS.success },
  archived: { label: '已归档', color: 'info', icon: ICONS.idle },
  deprecated: { label: '已停用', color: 'info', icon: ICONS.idle },
}

/** 质量检查 */
const QUALITY: Record<string, StatusMeta> = {
  pending: { label: '待检查', color: 'info', icon: ICONS.pending },
  passed: { label: '通过', color: 'success', icon: ICONS.success },
  blocked: { label: '阻断', color: 'error', icon: ICONS.blocked },
  warning: { label: '警告', color: 'warning', icon: ICONS.warn },
  failed: { label: '失败', color: 'error', icon: ICONS.fail },
}

/** 风险事件 */
const RISK_EVENT: Record<string, StatusMeta> = {
  covered: { label: '覆盖', color: 'success', icon: ICONS.success },
  rejected: { label: '拒绝', color: 'error', icon: ICONS.blocked },
  circuit_breaker: { label: '熔断', color: 'error', icon: ICONS.breaker },
  manual_review: { label: '人工干预', color: 'warning', icon: ICONS.manual },
}

const DOMAIN_TABLES: Partial<Record<StatusDomain, Record<string, StatusMeta>>> = {
  dataVersion: DATA_VERSION,
  run: COMMON,
  task: COMMON,
  validation: VALIDATION,
  report: REPORT,
  quality: QUALITY,
  riskEvent: RISK_EVENT,
}

/** 十六进制色 → rgba（浅色底 = 12% 透明度） */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * StatusTag
 *
 * 用法：
 *   <StatusTag status="running" domain="run" />
 *   <StatusTag status="insufficient_evidence" domain="validation" />
 *   <StatusTag status="custom-state" label="自定义" color="warning" />
 */
export default function StatusTag({
  status,
  domain,
  icon,
  label,
  className,
}: StatusTagProps) {
  const table = domain ? DOMAIN_TABLES[domain] : undefined
  const meta =
    table?.[status] ?? COMMON[status] ?? {
      label,
      color: 'info' as SemanticColorKey,
      icon: ICONS.unknown,
    }

  const text = label ?? meta.label ?? status
  const colorHex = SEMANTIC_COLOR[meta.color]
  const iconNode = icon ?? meta.icon

  return (
    <span
      className={`qt-status-tag ${className ?? ''}`}
      style={{
        color: colorHex,
        backgroundColor: hexToRgba(colorHex, 0.12),
      }}
      title={text}
    >
      {iconNode}
      <span>{text}</span>
    </span>
  )
}

/**
 * MetricCard —— 指标卡。
 *
 * 数值精度克制：百分比两位小数，金额由 formatMoney 带单位；
 * 「口径说明」ⓘ 以 Popover 呈现，不挤占版面。
 */

import type { ReactNode } from 'react'
import { Card, Popover, Skeleton } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { formatMoney, formatPercent } from '@/shared/format'

export interface MetricCardProps {
  title: ReactNode
  /** 大数字（数值 / 字符串 / 自定义节点） */
  value: ReactNode
  /** 单位，如 '元'、'%'、'条' */
  unit?: string
  /** 数值精度（value 为 number 时生效）：百分比两位小数、金额按 formatMoney 规则 */
  precision?: number
  /** 数值展示类型：'number' | 'percent' | 'money'；缺省按原样渲染 */
  valueType?: 'number' | 'percent' | 'money'
  /** ⓘ 口径说明（Popover 内容） */
  caveat?: ReactNode
  /** 右上角附加（如涨跌 MarketValue） */
  extra?: ReactNode
  /** 脚注（来源 / 截止时间等） */
  footnote?: ReactNode
  loading?: boolean
  className?: string
}

export default function MetricCard({
  title,
  value,
  unit,
  precision = 2,
  valueType,
  caveat,
  extra,
  footnote,
  loading = false,
  className,
}: MetricCardProps) {
  let display: ReactNode = value
  if (!loading && typeof value === 'number') {
    if (valueType === 'percent') {
      display = formatPercent(value, precision)
    } else if (valueType === 'money') {
      display = formatMoney(value, precision)
    } else if (valueType === 'number') {
      display = value.toLocaleString('zh-CN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: precision,
      })
    }
  }

  return (
    <Card
      size="small"
      className={className}
      styles={{ body: { padding: '16px' } }}
      title={
        <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.65)' }}>
          {title}
        </span>
      }
      extra={
        caveat ? (
          <Popover
            content={
              <div style={{ maxWidth: 280, fontSize: 12 }}>{caveat}</div>
            }
            title="口径说明"
            trigger="hover"
          >
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />
          </Popover>
        ) : undefined
      }
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {loading ? (
          <Skeleton.Input active size="small" style={{ width: 120 }} />
        ) : (
          <>
            <span
              className="qt-tabular"
              style={{
                fontSize: 26,
                fontWeight: 600,
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
              }}
            >
              {display}
            </span>
            {unit ? (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {unit}
              </span>
            ) : null}
            {extra ? (
              <span style={{ marginLeft: 'auto' }}>{extra}</span>
            ) : null}
          </>
        )}
      </div>
      {footnote ? (
        <div
          className="qt-ellipsis"
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'rgba(0,0,0,0.45)',
          }}
        >
          {footnote}
        </div>
      ) : null}
    </Card>
  )
}

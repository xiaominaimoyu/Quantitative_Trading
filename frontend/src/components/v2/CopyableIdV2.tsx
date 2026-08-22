/**
 * CopyableIdV2 — 可复制 ID v2
 *
 * 等宽 + hover 显示复制图标 + 复制成功 1.2s 内联 ✓ 反馈（不弹 message）
 */

import { useCallback, useRef, useState } from 'react'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

export interface CopyableIdV2Props {
  id: string
  label?: string
  maxLength?: number
  size?: 'sm' | 'default'
}

export function CopyableIdV2({ id, label, maxLength, size = 'default' }: CopyableIdV2Props) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number>(0)

  const display = maxLength && id.length > maxLength ? `${id.slice(0, maxLength)}…` : id
  const fontSize = size === 'sm' ? 12 : 13

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1200)
    })
  }, [id])

  return (
    <Tooltip title={copied ? '已复制' : '点击复制'}>
      <span
        onClick={onCopy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onCopy()
          }
        }}
        role="button"
        tabIndex={0}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm)',
          transition: 'background var(--motion-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {label && <span style={{ color: 'var(--text-tertiary)' }}>{label}: </span>}
        <span className="qt-tabular">{display}</span>
        {copied ? (
          <CheckOutlined style={{ color: 'var(--color-success)', fontSize: 12 }} />
        ) : (
          <CopyOutlined style={{ color: 'var(--text-tertiary)', fontSize: 12, opacity: 0.6 }} />
        )}
      </span>
    </Tooltip>
  )
}

export default CopyableIdV2
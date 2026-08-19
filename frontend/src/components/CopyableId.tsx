/**
 * CopyableId —— 可复制 ID（运行 / 版本 / 任务 ID）。
 *
 * 超长 ID 默认截断为 20 字符 + 省略号，悬停显示全文；点击复制并轻提示。
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Tooltip, App } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

export interface CopyableIdProps {
  id: string
  /** 前缀说明，如 "运行 "、"版本 " */
  prefix?: ReactNode
  /** 是否可复制，默认 true */
  copyable?: boolean
  /** 超长截断（默认 20 字符，0 表示不截断） */
  maxLength?: number
  showTooltip?: boolean
  className?: string
}

export default function CopyableId({
  id,
  prefix,
  copyable = true,
  maxLength = 20,
  showTooltip = true,
  className,
}: CopyableIdProps) {
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)

  const display =
    maxLength > 0 && id.length > maxLength ? `${id.slice(0, maxLength)}…` : id

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      message.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      message.error('复制失败，请手动选择复制')
    }
  }

  // 键盘激活：Enter / Space 触发复制（WCAG 2.1.1）
  const handleKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void handleCopy()
    }
  }

  const node = (
    <span
      className={`qt-copyable-id ${className ?? ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {prefix ? <span style={{ color: 'rgba(0,0,0,0.45)' }}>{prefix}</span> : null}
      <code
        className="qt-mono"
        style={{
          fontSize: 12,
          color: 'rgba(0,0,0,0.75)',
          background: 'rgba(0,0,0,0.04)',
          padding: '0 6px',
          borderRadius: 4,
          lineHeight: '20px',
        }}
      >
        {display}
      </code>
      {copyable ? (
        <a
          role="button"
          tabIndex={0}
          style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}
          onClick={handleCopy}
          onKeyDown={handleKeyDown}
          title="复制完整 ID"
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </a>
      ) : null}
    </span>
  )

  if (showTooltip && display !== id) {
    return (
      <Tooltip title={id} placement="top">
        {node}
      </Tooltip>
    )
  }
  return node
}

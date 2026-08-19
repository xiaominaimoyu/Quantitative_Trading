/**
 * LineageChain —— 数据血缘链（数据版本 › 策略版本 › 模型版本）。
 *
 * - 每个节点可跳转（to）或触发回调（onClick）；禁用的节点渲染为弱化文字；
 * - 横向为默认方向（› 分隔），纵向为 ↓ 递进；
 * - 配合 StatusTag 可表达各节点状态（由页面组装）。
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowDownOutlined } from '@ant-design/icons'

export interface LineageNode {
  key: string
  label: ReactNode
  /** 路由跳转地址 */
  to?: string
  onClick?: () => void
  icon?: ReactNode
  disabled?: boolean
}

export interface LineageChainProps {
  items: LineageNode[]
  direction?: 'horizontal' | 'vertical'
  /** 分隔符，默认 '›' */
  separator?: ReactNode
  className?: string
  style?: CSSProperties
}

function NodeContent({ node }: { node: LineageNode }) {
  const body = (
    <>
      {node.icon ? (
        <span style={{ marginRight: 4, opacity: 0.65 }}>{node.icon}</span>
      ) : null}
      {node.label}
    </>
  )

  if (node.disabled) {
    return <span style={{ color: 'rgba(0,0,0,0.45)' }}>{body}</span>
  }
  if (node.to) {
    return (
      <Link to={node.to} onClick={node.onClick} className="qt-link">
        {body}
      </Link>
    )
  }
  if (node.onClick) {
    return (
      <a
        onClick={node.onClick}
        onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => {
          // 键盘激活：Enter / Space 触发回调（WCAG 2.1.1）
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            node.onClick?.()
          }
        }}
        tabIndex={0}
        className="qt-link"
        role="button"
      >
        {body}
      </a>
    )
  }
  return <span>{body}</span>
}

export default function LineageChain({
  items,
  direction = 'horizontal',
  separator = '›',
  className,
  style,
}: LineageChainProps) {
  if (direction === 'vertical') {
    return (
      <div className={`qt-lineage qt-lineage--vertical ${className ?? ''}`} style={style}>
        {items.map((node, i) => (
          <div key={node.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <NodeContent node={node} />
            {i < items.length - 1 ? (
              <ArrowDownOutlined
                style={{ margin: '2px 0 2px 10px', color: 'rgba(0,0,0,0.45)', fontSize: 12 }}
              />
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={`qt-lineage ${className ?? ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}
    >
      {items.map((node, i) => (
        <span key={node.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {i > 0 ? (
            <span style={{ color: 'rgba(0,0,0,0.25)' }} aria-hidden="true">
              {separator}
            </span>
          ) : null}
          <NodeContent node={node} />
        </span>
      ))}
    </div>
  )
}

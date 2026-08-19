/**
 * PageHeader —— 页面头（标题 + 元信息 + 操作区）。
 *
 * 约定：
 * - 标题行：标题 + 副标题 + 右侧操作区（extra）；
 * - 元信息行：版本 / 时间 / 状态，用「·」分隔的小字说明；
 * - 父级路径用「‹」前缀（配合面包屑，不重复展示）。
 */

import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧操作区（按钮组） */
  extra?: ReactNode
  /** 元信息（版本 / 时间 / 状态），渲染为一行 · 分隔 */
  meta?: ReactNode[]
  /** 父级页面名（可选，如 "数据目录"） */
  parent?: ReactNode
  className?: string
}

export default function PageHeader({
  title,
  subtitle,
  extra,
  meta,
  parent,
  className,
}: PageHeaderProps) {
  return (
    <div className={`qt-page-header ${className ?? ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            {parent ? (
              <span
                style={{
                  color: 'rgba(0,0,0,0.45)',
                  fontWeight: 400,
                  marginRight: 6,
                }}
              >
                {parent} ›
              </span>
            ) : null}
            {title}
          </h1>
          {subtitle ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                color: 'rgba(0,0,0,0.45)',
              }}
            >
              {subtitle}
            </div>
          ) : null}
          {meta && meta.length > 0 ? (
            <div
              className="qt-ellipsis"
              style={{
                marginTop: 6,
                fontSize: 12,
                color: 'rgba(0,0,0,0.45)',
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              {meta.map((item, i) => (
                <span key={i}>
                  {i > 0 ? (
                    <span style={{ marginRight: 12, color: '#d9d9d9' }}>·</span>
                  ) : null}
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
      </div>
    </div>
  )
}

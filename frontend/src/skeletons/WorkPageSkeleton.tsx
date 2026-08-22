/**
 * WorkPageSkeleton — 工作页骨架 C
 *
 * 用于工作台、新建实验、AI 助手、模拟盘等定制页面
 */

import type { ReactNode } from 'react'

interface WorkPageSkeletonProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  maxWidth?: number | string
}

export function WorkPageSkeleton({
  title,
  description,
  actions,
  children,
  maxWidth = 'var(--content-max-width)',
}: WorkPageSkeletonProps) {
  return (
    <div style={{ maxWidth, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--font-size-xl)',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </h1>
          {description && (
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              {description}
            </p>
          )}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export default WorkPageSkeleton
/**
 * PageSkeleton — 页面骨架屏
 *
 * 支持 list / detail / row / table 四种类型
 */

import { Skeleton, Card } from 'antd'
import type { ReactNode } from 'react'

interface PageSkeletonProps {
  type: 'list' | 'detail' | 'row' | 'table'
  rows?: number
  columns?: number
}

export function PageSkeleton({ type, rows = 5, columns = 4 }: PageSkeletonProps): ReactNode {
  if (type === 'list') {
    return (
      <div style={{ padding: '16px 0' }}>
        <Skeleton.Input active size="small" style={{ width: 200, marginBottom: 16 }} />
        <Skeleton.Input active size="small" style={{ width: '100%', marginBottom: 16 }} />
        <Skeleton active paragraph={{ rows }} />
      </div>
    )
  }

  if (type === 'detail') {
    return (
      <div style={{ padding: '16px 0' }}>
        <Skeleton active paragraph={{ rows: 2 }} style={{ marginBottom: 24 }} />
        <Card style={{ marginBottom: 16 }}>
          <Skeleton active paragraph={{ rows: 1 }} />
        </Card>
        <Skeleton active paragraph={{ rows: rows }} />
      </div>
    )
  }

  if (type === 'row') {
    return <Skeleton active paragraph={{ rows: 1 }} />
  }

  // table
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          active
          paragraph={{ rows: 1 }}
          style={{ marginBottom: 12, padding: '0 8px' }}
        />
      ))}
    </div>
  )
}

export default PageSkeleton
/**
 * PageLoading —— 页面骨架屏。
 *
 * 页面挂载后加载数据期间展示：标题条 + 若干内容行，避免跳动。
 */

import { Card, Skeleton } from 'antd'

export interface PageLoadingProps {
  /** 是否显示标题骨架，默认 true */
  withTitle?: boolean
  /** 内容骨架行数，默认 6 */
  rows?: number
  titleWidth?: number
}

export default function PageLoading({
  withTitle = true,
  rows = 6,
  titleWidth = 180,
}: PageLoadingProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {withTitle ? (
        <Skeleton.Input active style={{ width: titleWidth, height: 28 }} />
      ) : null}
      <Card size="small">
        <Skeleton active paragraph={{ rows }} />
      </Card>
    </div>
  )
}

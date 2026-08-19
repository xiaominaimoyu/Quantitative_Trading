/**
 * Placeholder —— 占位页模板（未实现页面统一出口）。
 * 页面级组件，使用 PageHeader + 空状态说明。
 */

import { Empty } from 'antd'
import { PageHeader } from '@/components'
import type { ReactNode } from 'react'

export interface PlaceholderProps {
  title: ReactNode
  /** 页面副标题（页头下小字） */
  description?: ReactNode
  /** 空状态说明（默认：该页面尚未实现，敬请期待。） */
  hint?: ReactNode
}

export default function Placeholder({ title, description, hint }: PlaceholderProps) {
  return (
    <div>
      <PageHeader title={title} subtitle={description} />
      <Empty
        style={{ marginTop: 96 }}
        description={hint ?? '该页面尚未实现，敬请期待。'}
      />
    </div>
  )
}

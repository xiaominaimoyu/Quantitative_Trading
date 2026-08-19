/**
 * PageEmpty —— 页面空态（无数据 / 无可展示内容）。
 */

import type { ReactNode } from 'react'
import { Empty } from 'antd'

export interface PageEmptyProps {
  /** 主文案，默认 "暂无数据" */
  title?: string
  /** 说明文字 */
  description?: ReactNode
  /** 操作按钮（如「创建数据版本」） */
  action?: ReactNode
}

export default function PageEmpty({
  title = '暂无数据',
  description,
  action,
}: PageEmptyProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)' }}>
              {title}
            </span>
            {description ? (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {description}
              </span>
            ) : null}
            {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
          </div>
        }
      />
    </div>
  )
}

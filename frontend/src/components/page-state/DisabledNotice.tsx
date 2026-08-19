/**
 * DisabledNotice —— 内容已停用 / 过期警示（顶部常驻）。
 *
 * 场景：数据版本已停用、策略已停用、报告已归档；
 * 语义：内容只读 + 操作禁用 + 原因说明。
 */

import type { ReactNode } from 'react'
import { Alert, Typography } from 'antd'

export interface DisabledNoticeProps {
  /** 停用原因说明 */
  reason: ReactNode
  /** 提示标题，默认 "内容已停用" */
  title?: string
  /** 是否只读（默认 true，附加「只读」标注） */
  readOnly?: boolean
}

export default function DisabledNotice({
  reason,
  title = '内容已停用',
  readOnly = true,
}: DisabledNoticeProps) {
  return (
    <Alert
      type="info"
      showIcon
      banner
      message={
        <Typography.Text style={{ fontSize: 13 }}>
          {title}
          {readOnly ? '（只读）' : ''}：{reason}
        </Typography.Text>
      }
    />
  )
}

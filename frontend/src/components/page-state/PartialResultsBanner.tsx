/**
 * PartialResultsBanner —— 部分结果警示条（顶部常驻）。
 *
 * 场景：模拟盘结果不完整、数据缺失、降采样、策略被熔断等情况；
 * 页面同时提供主结果 + 明确说明不完整原因。
 */

import type { CSSProperties, ReactNode } from 'react'
import { Alert, Typography } from 'antd'

export interface PartialResultsBannerProps {
  /** 不完整原因说明 */
  reason: ReactNode
  /** 「查看详情」触发 */
  onDetail?: () => void
  /** 是否显示详情链接，默认 true */
  showDetail?: boolean
  style?: CSSProperties
}

export default function PartialResultsBanner({
  reason,
  onDetail,
  showDetail = true,
  style,
}: PartialResultsBannerProps) {
  return (
    <Alert
      type="warning"
      showIcon
      banner
      style={style}
      message={
        <Typography.Text style={{ fontSize: 13 }}>
          部分结果：{reason}
          {showDetail && onDetail ? (
            <a
              style={{ marginLeft: 8 }}
              onClick={(e) => {
                e.preventDefault()
                onDetail()
              }}
            >
              查看详情
            </a>
          ) : null}
        </Typography.Text>
      }
    />
  )
}

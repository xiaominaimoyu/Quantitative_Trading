/**
 * PageError —— 页面加载失败。
 *
 * 仅展示稳定错误码 + 可读说明 + 关联编号（requestId），绝不泄露堆栈；
 * 传入 ApiError 时自动提取 code / message / requestId。
 */

import type { ReactNode } from 'react'
import { Button, Result } from 'antd'
import { asApiError } from '@/api/client'

export interface PageErrorProps {
  /** 失败说明（缺省时从 error 提取） */
  message?: string
  code?: string
  requestId?: string
  /** 任意错误对象（ApiError 自动提取字段） */
  error?: unknown
  /** 重试回调 */
  retry?: () => void
  /** 补充内容（如 PartialResultsBanner） */
  children?: ReactNode
}

export default function PageError({
  message,
  code,
  requestId,
  error,
  retry,
  children,
}: PageErrorProps) {
  const apiErr = asApiError(error)
  const shownMessage = message ?? apiErr?.message ?? '页面加载失败，请稍后重试'
  const shownCode = code ?? apiErr?.code
  const shownRequestId = requestId ?? apiErr?.requestId

  return (
    <Result
      status="error"
      title="加载失败"
      subTitle={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{shownMessage}</span>
          <span className="qt-mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            {[shownCode && `错误码 ${shownCode}`, shownRequestId && `关联编号 ${shownRequestId}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {children}
        </div>
      }
      extra={
        retry ? (
          <Button type="primary" onClick={retry}>
            重试
          </Button>
        ) : undefined
      }
    />
  )
}

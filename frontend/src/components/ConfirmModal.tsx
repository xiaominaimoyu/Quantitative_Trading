/**
 * ConfirmModal —— 需要留痕的操作确认弹窗。
 *
 * 流程约定：
 * 1. 弹窗内填写【必填原因】后确认；
 * 2. onOk(reason) 异步执行；成功返回审计编号 → 弹窗切换为
 *    「操作已完成 + 审计编号（可复制）」成功视图；
 * 3. 失败（ApiError）→ 顶部 message 展示错误码 + 关联编号，弹窗保持打开可重试；
 * 4. 危险操作（发布/执行/停用）默认红色确认按钮。
 */

import { useEffect, useState, type ReactNode } from 'react'
import { App, Button, Input, Modal, Result, Space, Typography } from 'antd'
import { asApiError } from '@/api/client'
import { semanticColors } from '@/theme'
import CopyableId from './CopyableId'

export interface ConfirmModalProps {
  open: boolean
  title: ReactNode
  /** 操作说明（可选，如 "发布后数据版本将变为可用，不可回退"） */
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 是否必填原因，默认 true */
  requiredReason?: boolean
  reasonPlaceholder?: string
  /** 返回审计编号（string）；返回 void 则成功后直接关闭 */
  onOk: (reason: string) => Promise<string | void> | string | void
  onCancel: () => void
}

let auditSeq = 1

/** 生成 mock 审计编号，如 AUD-20260808-0001 */
export function generateAuditId(date = new Date()): string {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AUD-${ymd}-${String(auditSeq++).padStart(4, '0')}`
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmText = '确认执行',
  cancelText = '取消',
  danger = false,
  requiredReason = true,
  reasonPlaceholder = '请填写操作原因（必填，将记录到审计日志）',
  onOk,
  onCancel,
}: ConfirmModalProps) {
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [auditId, setAuditId] = useState<string | null>(null)

  // 每次打开重置状态
  useEffect(() => {
    if (open) {
      setReason('')
      setReasonError(undefined)
      setAuditId(null)
      setSubmitting(false)
    }
  }, [open])

  const handleConfirm = async () => {
    const trimmed = reason.trim()
    if (requiredReason && !trimmed) {
      setReasonError('请填写操作原因')
      return
    }
    setSubmitting(true)
    setReasonError(undefined)
    try {
      const result = await onOk(trimmed)
      if (typeof result === 'string' && result) {
        setAuditId(result)
      } else {
        onCancel()
      }
    } catch (err) {
      const apiErr = asApiError(err)
      if (apiErr) {
        message.error(
          `操作失败 [${apiErr.code}] ${apiErr.message}（关联编号 ${apiErr.requestId}）`,
        )
      } else {
        message.error('操作失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const successView = (
    <Result
      status="success"
      title="操作已完成"
      subTitle={
        <Space direction="vertical" size={4} align="center">
          <span>操作已记录到审计日志，审计编号：</span>
          <CopyableId id={auditId ?? ''} maxLength={0} />
        </Space>
      }
      extra={
        <Button type="primary" onClick={onCancel}>
          关闭
        </Button>
      }
    />
  )

  const formView = (
    <>
      {description ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {description}
        </Typography.Paragraph>
      ) : null}
      <Input.TextArea
        value={reason}
        onChange={(e) => {
          setReason(e.target.value)
          if (reasonError) setReasonError(undefined)
        }}
        placeholder={reasonPlaceholder}
        rows={3}
        maxLength={500}
        showCount
        status={reasonError ? 'error' : undefined}
        aria-invalid={!!reasonError}
        aria-describedby={reasonError ? 'confirm-modal-reason-error' : undefined}
      />
      {reasonError ? (
        <div
          id="confirm-modal-reason-error"
          role="alert"
          style={{ color: semanticColors.error, fontSize: 12, marginTop: 4 }}
        >
          {reasonError}
        </div>
      ) : null}
    </>
  )

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      width={480}
      okText={confirmText}
      cancelText={cancelText}
      confirmLoading={submitting}
      onOk={handleConfirm}
      okButtonProps={{ danger }}
      cancelButtonProps={{ disabled: submitting }}
      destroyOnHidden
      footer={auditId ? null : undefined}
    >
      {auditId ? successView : formView}
    </Modal>
  )
}

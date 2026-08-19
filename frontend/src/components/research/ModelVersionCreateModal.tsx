import { useEffect, useState } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { asApiError } from '@/api/client'
import {
  createModelVersion,
  type ModelVersion,
  type ModelVersionMutation,
} from '@/api/models'
import { createIdempotencyKey } from '@/api/research/ui'

interface FormValues {
  sourceRef: string
  licenseRef: string
  note?: string
}

interface Props {
  open: boolean
  modelId: string
  parent: ModelVersion | null
  initial?: boolean
  onCancel: () => void
  onCreated: (result: ModelVersionMutation) => void | Promise<void>
}

export default function ModelVersionCreateModal({
  open,
  modelId,
  parent,
  initial = false,
  onCancel,
  onCreated,
}: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('model-version'))
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    setIdempotencyKey(createIdempotencyKey('model-version'))
    form.setFieldsValue({
      sourceRef: parent?.content.source_ref ?? 'repository://baselines/no-prediction',
      licenseRef: parent?.content.license_ref ?? 'internal-research',
      note: parent?.note ?? '首个无预测基线草稿',
    })
  }, [form, open, parent])

  const submit = async () => {
    if (!parent && !initial) return
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const result = await createModelVersion(
        modelId,
        {
          parentVersionId: parent?.id ?? null,
          note: values.note?.trim() || null,
          content: {
            contract_version: 'no_prediction_baseline_v1',
            model_kind: 'no_prediction',
            purpose: 'baseline_reference',
            universe: 'csi300_point_in_time',
            frequency: 'daily',
            requires_training: false,
            randomized: false,
            prediction_horizon_trading_days: null,
            artifact_required: false,
            implementation_ref: 'no_prediction_baseline_v1',
            source_ref: values.sourceRef.trim(),
            license_ref: values.licenseRef.trim(),
          },
        },
        { idempotencyKey },
      )
      await onCreated(result)
    } catch (error) {
      const apiError = asApiError(error)
      if (apiError) message.error(`${apiError.message} [${apiError.code}] · ${apiError.requestId}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '创建首个模型草稿版本' : '基于冻结版本创建模型草稿'}
      okText="创建版本"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="父版本"><Input value={parent?.id ?? ''} disabled /></Form.Item>
        <Form.Item name="sourceRef" label="来源引用" rules={[{ required: true, max: 255 }]}>
          <Input maxLength={255} />
        </Form.Item>
        <Form.Item name="licenseRef" label="许可证引用" rules={[{ required: true, max: 255 }]}>
          <Input maxLength={255} />
        </Form.Item>
        <Form.Item name="note" label="版本备注">
          <Input.TextArea maxLength={2000} showCount rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { asApiError } from '@/api/client'
import { createIdempotencyKey } from '@/api/research/ui'

interface FormValues {
  slug: string
  name: string
  description?: string
}

interface CreatedContainer {
  id: string
}

interface Props<TItem extends CreatedContainer> {
  open: boolean
  title: string
  idempotencyPrefix: string
  onCancel: () => void
  create: (
    input: { slug: string; name: string; description: string | null },
    options: { idempotencyKey: string },
  ) => Promise<{ item: TItem; auditEventId: string }>
  onCreated: (result: { item: TItem; auditEventId: string }) => void | Promise<void>
}

export default function ResearchContainerCreateModal<TItem extends CreatedContainer>({
  open,
  title,
  idempotencyPrefix,
  onCancel,
  create,
  onCreated,
}: Props<TItem>) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey(idempotencyPrefix))
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    form.resetFields()
    setIdempotencyKey(createIdempotencyKey(idempotencyPrefix))
  }, [form, idempotencyPrefix, open])

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const result = await create(
        {
          slug: values.slug.trim(),
          name: values.name.trim(),
          description: values.description?.trim() || null,
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
      title={title}
      okText="创建"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="slug"
          label="Slug"
          rules={[
            { required: true, message: '请填写 slug' },
            { pattern: /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, message: '仅允许小写字母、数字、连字符和下划线' },
            { max: 64 },
          ]}
        >
          <Input maxLength={64} placeholder="cross-sectional-momentum" />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }, { max: 128 }]}>
          <Input maxLength={128} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea maxLength={2000} rows={3} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}

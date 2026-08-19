import { useEffect, useState } from 'react'
import { App, Form, Input, InputNumber, Modal, Select } from 'antd'
import { asApiError } from '@/api/client'
import {
  createStrategyVersion,
  type CrossSectionalMomentumStrategyV1,
  type StrategyVersion,
  type StrategyVersionMutation,
} from '@/api/strategies'
import { createIdempotencyKey } from '@/api/research/ui'

interface FormValues {
  signalAdjustment: CrossSectionalMomentumStrategyV1['signal_adjustment']
  lookbackTradingDays: number
  selectTopN: number
  rebalanceEveryTradingDays: number
  note?: string
}

interface Props {
  open: boolean
  strategyId: string
  parent: StrategyVersion | null
  initial?: boolean
  onCancel: () => void
  onCreated: (result: StrategyVersionMutation) => void | Promise<void>
}

export default function StrategyVersionCreateModal({
  open,
  strategyId,
  parent,
  initial = false,
  onCancel,
  onCreated,
}: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('strategy-version'))
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    setIdempotencyKey(createIdempotencyKey('strategy-version'))
    form.setFieldsValue({
      signalAdjustment: parent?.content.signal_adjustment ?? 'backward',
      lookbackTradingDays: parent?.content.lookback_trading_days ?? 60,
      selectTopN: parent?.content.select_top_n ?? 20,
      rebalanceEveryTradingDays: parent?.content.rebalance_every_trading_days ?? 20,
      note: parent?.note ?? '首个横截面动量基线草稿',
    })
  }, [form, open, parent])

  const submit = async () => {
    if (!parent && !initial) return
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const result = await createStrategyVersion(
        strategyId,
        {
          parentVersionId: parent?.id ?? null,
          note: values.note?.trim() || null,
          content: {
            contract_version: 'cross_sectional_momentum_v1',
            strategy_kind: 'cross_sectional_momentum',
            universe: 'csi300_point_in_time',
            frequency: 'daily',
            signal_price: 'close',
            signal_adjustment: values.signalAdjustment,
            lookback_trading_days: values.lookbackTradingDays,
            select_top_n: values.selectTopN,
            rebalance_every_trading_days: values.rebalanceEveryTradingDays,
            weighting: 'equal_weight',
            long_only: true,
            decision_timing: 'after_close',
            earliest_execution: 'next_open',
            output_contract: 'target_weights_v1',
          },
        },
        { idempotencyKey },
      )
      await onCreated(result)
    } catch (error) {
      const apiError = asApiError(error)
      if (apiError) {
        message.error(`${apiError.message} [${apiError.code}] · ${apiError.requestId}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '创建首个策略草稿版本' : '基于冻结版本创建策略草稿'}
      okText="创建版本"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="父版本">
          <Input value={parent?.id ?? '无（初始版本）'} disabled />
        </Form.Item>
        <Form.Item name="signalAdjustment" label="信号复权" rules={[{ required: true }]}>
          <Select options={[
            { value: 'none', label: '不复权' },
            { value: 'forward', label: '前复权' },
            { value: 'backward', label: '后复权' },
          ]} />
        </Form.Item>
        <Form.Item name="lookbackTradingDays" label="回看交易日" rules={[{ required: true }]}>
          <InputNumber min={2} max={504} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="selectTopN" label="选取数量" rules={[{ required: true }]}>
          <InputNumber min={1} max={300} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="rebalanceEveryTradingDays" label="再平衡间隔（交易日）" rules={[{ required: true }]}>
          <InputNumber min={1} max={252} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="版本备注">
          <Input.TextArea maxLength={2000} showCount rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

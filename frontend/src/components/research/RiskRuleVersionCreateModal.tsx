import { useEffect, useState } from 'react'
import { App, Form, Input, InputNumber, Modal } from 'antd'
import { asApiError } from '@/api/client'
import {
  createRiskRuleVersion,
  type RiskRuleVersion,
  type RiskRuleVersionMutation,
} from '@/api/risk'
import { createIdempotencyKey } from '@/api/research/ui'

interface FormValues {
  maxSinglePositionBp: number
  maxIndustryPositionBp: number
  maxGrossExposureBp: number
  maxConcentrationHhiBp: number
  maxDailyTurnoverBp: number
  dailyLossCircuitBreakerBp: number
  maxDrawdownCircuitBreakerBp: number
  note?: string
}

interface Props {
  open: boolean
  riskRuleSetId: string
  parent: RiskRuleVersion | null
  initial?: boolean
  onCancel: () => void
  onCreated: (result: RiskRuleVersionMutation) => void | Promise<void>
}

export default function RiskRuleVersionCreateModal({
  open,
  riskRuleSetId,
  parent,
  initial = false,
  onCancel,
  onCreated,
}: Props) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('risk-rule-version'))
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    const content = parent?.content
    setIdempotencyKey(createIdempotencyKey('risk-rule-version'))
    form.setFieldsValue({
      maxSinglePositionBp: content?.max_single_position_bp ?? 1000,
      maxIndustryPositionBp: content?.max_industry_position_bp ?? 3000,
      maxGrossExposureBp: content?.max_gross_exposure_bp ?? 10000,
      maxConcentrationHhiBp: content?.max_concentration_hhi_bp ?? 1500,
      maxDailyTurnoverBp: content?.max_daily_turnover_bp ?? 30000,
      dailyLossCircuitBreakerBp: content?.daily_loss_circuit_breaker_bp ?? 500,
      maxDrawdownCircuitBreakerBp: content?.max_drawdown_circuit_breaker_bp ?? 1500,
      note: parent?.note ?? '首个 A 股日线风险基线草稿',
    })
  }, [form, open, parent])

  const submit = async () => {
    if (!parent && !initial) return
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const result = await createRiskRuleVersion(
        riskRuleSetId,
        {
          parentVersionId: parent?.id ?? null,
          note: values.note?.trim() || null,
          content: {
            contract_version: 'ashare_daily_risk_v1',
            market: 'CN_A',
            frequency: 'daily',
            max_single_position_bp: values.maxSinglePositionBp,
            max_industry_position_bp: values.maxIndustryPositionBp,
            max_gross_exposure_bp: values.maxGrossExposureBp,
            max_concentration_hhi_bp: values.maxConcentrationHhiBp,
            max_daily_turnover_bp: values.maxDailyTurnoverBp,
            daily_loss_circuit_breaker_bp: values.dailyLossCircuitBreakerBp,
            max_drawdown_circuit_breaker_bp: values.maxDrawdownCircuitBreakerBp,
            uncertain_state_action: 'freeze_risk_increase',
            risk_reduction_bypasses_opening_limits: true,
            input_contract: 'risk_targets_v1',
            output_contract: 'risk_decision_v1',
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

  const threshold = (name: keyof FormValues, label: string, max = 10_000) => (
    <Form.Item name={name} label={`${label}（bp）`} rules={[{ required: true }]}>
      <InputNumber min={1} max={max} precision={0} style={{ width: '100%' }} />
    </Form.Item>
  )

  return (
    <Modal
      open={open}
      title={initial ? '创建首个风险规则草稿版本' : '基于冻结版本创建风险规则草稿'}
      okText="创建版本"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="父版本"><Input value={parent?.id ?? ''} disabled /></Form.Item>
        {threshold('maxSinglePositionBp', '单票上限')}
        {threshold('maxIndustryPositionBp', '行业上限')}
        {threshold('maxGrossExposureBp', '总敞口上限')}
        {threshold('maxConcentrationHhiBp', '集中度 HHI 上限')}
        {threshold('maxDailyTurnoverBp', '日换手上限', 100_000)}
        {threshold('dailyLossCircuitBreakerBp', '日亏损熔断')}
        {threshold('maxDrawdownCircuitBreakerBp', '最大回撤熔断')}
        <Form.Item name="note" label="版本备注">
          <Input.TextArea maxLength={2000} showCount rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

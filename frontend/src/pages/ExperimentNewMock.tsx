/** Mock 模式的新建实验向导；real 模式不会加载此模块。 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { App, Alert, Button, Checkbox, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Steps } from 'antd'
import { useNavigate } from 'react-router'
import dayjs from '@/shared/dayjs'
import { asApiError } from '@/api/client'
import { listDatasetVersions } from '@/api/mock/datasets'
import {
  listModelVersions,
  listStrategyVersions,
  type ModelVersion,
  type StrategyVersion,
} from '@/api/mock/strategies'
import { listRiskRuleSets } from '@/api/mock/risk'
import {
  submitExperiment,
  type ExperimentDraft,
  type ExperimentSplit,
  type SubmitExperimentResult,
} from '@/api/mock/experimentNew'
import { PageHeader } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

const STEPS = [
  '研究假设',
  '数据版本',
  '策略与模型',
  '时间切分',
  '成本与风控',
  '调参预算',
  '预注册确认',
]

const DEFAULT_DRAFT: ExperimentDraft = {
  hypothesis: {
    statement: '',
    primaryMetrics: ['年化超额', 'Sharpe'],
    secondaryMetrics: ['换手率'],
    failureConditions: '',
    stopRule: '',
  },
  datasetVersionId: '',
  universe: '沪深300',
  pointInTimeRule: 'T+1 可交易，后复权',
  strategyVersionId: '',
  baselineIds: [],
  candidateIds: [],
  split: {
    trainStart: '2015-01-01',
    trainEnd: '2020-12-31',
    validationStart: '2021-01-01',
    validationEnd: '2023-12-31',
    testStart: '2024-01-01',
    testEnd: '2025-12-31',
    walkForwardWindows: 6,
    purgeDays: 5,
    embargoDays: 5,
  },
  cost: { commissionBp: 3, slippageBp: 5, turnoverLimitPct: 300 },
  riskRuleSetId: '',
  budget: { searchSpace: 'topN × holdDays', maxAttempts: 12, seeds: [42, 43, 44] },
}

const METRIC_OPTIONS = [
  { value: '年化超额', label: '年化超额' },
  { value: 'Sharpe', label: 'Sharpe' },
  { value: '最大回撤', label: '最大回撤' },
  { value: 'Sortino', label: 'Sortino' },
  { value: 'Calmar', label: 'Calmar' },
  { value: '换手率', label: '换手率' },
  { value: '成本贡献', label: '成本贡献' },
]

function getSplitError(split: ExperimentSplit): string | undefined {
  const ordered = [
    split.trainStart,
    split.trainEnd,
    split.validationStart,
    split.validationEnd,
    split.testStart,
    split.testEnd,
  ]
  if (ordered.some((value) => !value)) return '训练、验证和测试区间都必须填写'
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    return '时间切分必须按训练 → 验证 → 测试严格递增，且区间不能重叠'
  }
  if (split.walkForwardWindows < 1) return 'Walk-forward 窗口数至少为 1'
  if (split.purgeDays < 0 || split.embargoDays < 0) return 'purge 和 embargo 天数不能为负数'
  return undefined
}

function isSelectableDatasetVersion(v: { status: string; qualityStatus: string }) {
  return v.status === 'available' && (v.qualityStatus === 'passed' || v.qualityStatus === 'warning')
}

export default function ExperimentNewPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<ExperimentDraft>(DEFAULT_DRAFT)
  const [submitting, setSubmitting] = useState(false)
  const [freezeConfirmed, setFreezeConfirmed] = useState(false)

  const versionsQ = useQuery({
    queryKey: ['datasetVersions', 'ds-ashare'],
    queryFn: () => listDatasetVersions('ds-ashare'),
  })
  const strategyVersionsQ = useQuery({
    queryKey: ['strategyVersions', 'st-momentum'],
    queryFn: () => listStrategyVersions('st-momentum'),
  })
  const modelVersionsQ = useQuery({
    queryKey: ['modelVersions-all'],
    queryFn: async () => {
      const [buyhold, linreg, lgbm, lstm] = await Promise.all([
        listModelVersions('m-buyhold'),
        listModelVersions('m-linreg'),
        listModelVersions('m-lgbm'),
        listModelVersions('m-lstm'),
      ])
      return [...buyhold, ...linreg, ...lgbm, ...lstm]
    },
  })
  const riskQ = useQuery({ queryKey: ['riskRuleSets'], queryFn: () => listRiskRuleSets() })

  const queriesLoading = versionsQ.isLoading || strategyVersionsQ.isLoading || modelVersionsQ.isLoading || riskQ.isLoading
  const queryError = versionsQ.error ?? strategyVersionsQ.error ?? modelVersionsQ.error ?? riskQ.error
  const retryQueries = () => {
    void versionsQ.refetch()
    void strategyVersionsQ.refetch()
    void modelVersionsQ.refetch()
    void riskQ.refetch()
  }

  const selectableVersions = useMemo(
    () => (versionsQ.data ?? []).filter(isSelectableDatasetVersion),
    [versionsQ.data],
  )
  const frozenStrategyVersions = useMemo(
    () => (strategyVersionsQ.data ?? []).filter((v) => v.status === 'frozen'),
    [strategyVersionsQ.data],
  )
  const frozenModels = useMemo(
    () => (modelVersionsQ.data ?? []).filter((v) => v.status === 'frozen'),
    [modelVersionsQ.data],
  )
  const frozenRisk = useMemo(
    () => (riskQ.data ?? []).filter((r) => r.status === 'frozen'),
    [riskQ.data],
  )

  if (queriesLoading) return <PageLoading rows={8} />
  if (queryError) return <PageError error={queryError} retry={retryQueries} />

  const canNext = () => {
    switch (step) {
      case 0:
        return draft.hypothesis.statement.trim().length > 0 && draft.hypothesis.failureConditions.trim().length > 0 && draft.hypothesis.primaryMetrics.length > 0
      case 1:
        return !!draft.datasetVersionId
      case 2:
        return !!draft.strategyVersionId && draft.baselineIds.length > 0
      case 3:
        return !getSplitError(draft.split)
      case 4:
        return !!draft.riskRuleSetId
      case 5:
        return draft.budget.searchSpace.trim().length > 0 && draft.budget.maxAttempts > 0 && draft.budget.seeds.length > 0
      case 6:
        return freezeConfirmed
      default:
        return false
    }
  }

  const showDuplicateDialog = (result: SubmitExperimentResult) => {
    Modal.confirm({
      title: '发现相同输入的运行',
      content: (
        <div>
          已有运行 {result.existingRunId}（完成于{' '}
          {result.existingFinishedAt
            ? formatDateTime(result.existingFinishedAt, { zone: false })
            : '—'}
          ）。是否查看既有结果，或仍要运行（将作为复现运行关联）？
        </div>
      ),
      okText: '仍要运行',
      cancelText: '查看既有结果',
      onCancel: () => navigate(`/experiments/${result.existingExperimentId}/runs/${result.existingRunId}`),
      onOk: async () => {
        const forced = await submitExperiment(draft, { force: true })
        navigate(`/experiments/${forced.experimentId}/runs/${forced.runId}`)
      },
    })
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const result = await submitExperiment(draft)
      if (result.isDuplicate) {
        showDuplicateDialog(result)
      } else {
        message.success('实验已提交，运行已排队')
        navigate(`/experiments/${result.experimentId}/runs/${result.runId}`)
      }
    } catch (err) {
      const apiError = asApiError(err)
      message.error(
        apiError
          ? `提交失败 [${apiError.code}] ${apiError.message}（关联编号 ${apiError.requestId}）`
          : '提交失败，请重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Form layout="vertical">
            <Form.Item label="假设陈述" required>
              <Input.TextArea
                rows={3}
                value={draft.hypothesis.statement}
                onChange={(e) =>
                  setDraft({ ...draft, hypothesis: { ...draft.hypothesis, statement: e.target.value } })
                }
                placeholder="描述你要验证的研究假设"
              />
            </Form.Item>
            <Form.Item label="失败条件" required>
              <Input.TextArea
                rows={2}
                value={draft.hypothesis.failureConditions}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    hypothesis: { ...draft.hypothesis, failureConditions: e.target.value },
                  })
                }
              />
            </Form.Item>
            <Form.Item label="主要指标" required>
              <Select
                mode="multiple"
                value={draft.hypothesis.primaryMetrics}
                options={METRIC_OPTIONS}
                maxTagCount="responsive"
                onChange={(values) =>
                  setDraft({
                    ...draft,
                    hypothesis: { ...draft.hypothesis, primaryMetrics: values as string[] },
                  })
                }
              />
            </Form.Item>
            <Form.Item label="次要指标">
              <Select
                mode="multiple"
                value={draft.hypothesis.secondaryMetrics}
                options={METRIC_OPTIONS}
                maxTagCount="responsive"
                onChange={(values) =>
                  setDraft({
                    ...draft,
                    hypothesis: { ...draft.hypothesis, secondaryMetrics: values as string[] },
                  })
                }
              />
            </Form.Item>
            <Form.Item label="停止规则">
              <Input
                value={draft.hypothesis.stopRule}
                onChange={(e) =>
                  setDraft({ ...draft, hypothesis: { ...draft.hypothesis, stopRule: e.target.value } })
                }
              />
            </Form.Item>
            <Alert type="info" showIcon message="提交后修改假设需创建新实验。" />
          </Form>
        )
      case 1:
        return (
          <Form layout="vertical">
            <Form.Item label="数据版本" required>
              <Select
                placeholder="选择可用数据版本"
                value={draft.datasetVersionId || undefined}
                onChange={(v) => setDraft({ ...draft, datasetVersionId: v })}
                options={selectableVersions.map((v) => ({
                  value: v.id,
                  label: `${v.id} · ${v.timeRange} · ${v.qualitySummary?.slice(0, 30) ?? ''}`,
                }))}
              />
            </Form.Item>
            <Form.Item label="标的池">
              <Input value={draft.universe} onChange={(e) => setDraft({ ...draft, universe: e.target.value })} />
            </Form.Item>
            <Form.Item label="时点规则">
              <Input
                value={draft.pointInTimeRule}
                onChange={(e) => setDraft({ ...draft, pointInTimeRule: e.target.value })}
              />
            </Form.Item>
          </Form>
        )
      case 2:
        return (
          <Form layout="vertical">
            <Form.Item label="策略版本" required>
              <Select
                value={draft.strategyVersionId || undefined}
                onChange={(v) => setDraft({ ...draft, strategyVersionId: v })}
                options={frozenStrategyVersions.map((v: StrategyVersion) => ({
                  value: v.id,
                  label: `动量轮动 · v${v.version}`,
                }))}
              />
            </Form.Item>
            <Form.Item label="基线模型" required>
              <Checkbox.Group
                value={draft.baselineIds}
                onChange={(v) => setDraft({ ...draft, baselineIds: v as string[] })}
                options={frozenModels
                  .filter((m: ModelVersion) => !m.challenge)
                  .map((m) => ({ value: m.id, label: `${m.name} v${m.version}` }))}
              />
            </Form.Item>
            <Form.Item label="候选模型">
              <Checkbox.Group
                value={draft.candidateIds}
                onChange={(v) => setDraft({ ...draft, candidateIds: v as string[] })}
                options={frozenModels.map((m: ModelVersion) => ({
                  value: m.id,
                  label: `${m.name} v${m.version}${m.challenge ? '（挑战层）' : ''}`,
                  disabled: m.challenge,
                }))}
              />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              message="所有候选将使用相同的标的池、时间切分、成本口径与调参预算。提交后不可修改。"
            />
          </Form>
        )
      case 3:
        return (
          <Form layout="vertical">
            <Alert type="warning" showIcon message="测试集区间在冻结前不可见于策略调参。" style={{ marginBottom: 16 }} />
            <Space wrap>
              <Form.Item label="训练起">
                <DatePicker
                  value={dayjs(draft.split.trainStart)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, trainStart: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
              <Form.Item label="训练止">
                <DatePicker
                  value={dayjs(draft.split.trainEnd)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, trainEnd: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
              <Form.Item label="验证起">
                <DatePicker
                  value={dayjs(draft.split.validationStart)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, validationStart: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
              <Form.Item label="验证止">
                <DatePicker
                  value={dayjs(draft.split.validationEnd)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, validationEnd: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
              <Form.Item label="测试起">
                <DatePicker
                  value={dayjs(draft.split.testStart)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, testStart: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
              <Form.Item label="测试止">
                <DatePicker
                  value={dayjs(draft.split.testEnd)}
                  onChange={(d) => d && setDraft({ ...draft, split: { ...draft.split, testEnd: d.format('YYYY-MM-DD') } })}
                />
              </Form.Item>
            </Space>
            <Space wrap>
              <Form.Item label="Walk-forward 窗口数">
                <InputNumber
                  min={1}
                  value={draft.split.walkForwardWindows}
                  onChange={(v) => setDraft({ ...draft, split: { ...draft.split, walkForwardWindows: v ?? 6 } })}
                />
              </Form.Item>
              <Form.Item label="Purge 天数">
                <InputNumber
                  min={0}
                  value={draft.split.purgeDays}
                  onChange={(v) => setDraft({ ...draft, split: { ...draft.split, purgeDays: v ?? 0 } })}
                />
              </Form.Item>
              <Form.Item label="Embargo 天数">
                <InputNumber
                  min={0}
                  value={draft.split.embargoDays}
                  onChange={(v) => setDraft({ ...draft, split: { ...draft.split, embargoDays: v ?? 0 } })}
                />
              </Form.Item>
            </Space>
            {getSplitError(draft.split) ? <Alert type="error" showIcon message={getSplitError(draft.split)} /> : null}
          </Form>
        )
      case 4:
        return (
          <Form layout="vertical">
            <Space wrap>
              <Form.Item label="手续费 (bp)">
                <InputNumber
                  value={draft.cost.commissionBp}
                  onChange={(v) => setDraft({ ...draft, cost: { ...draft.cost, commissionBp: v ?? 3 } })}
                />
              </Form.Item>
              <Form.Item label="滑点 (bp)">
                <InputNumber
                  value={draft.cost.slippageBp}
                  onChange={(v) => setDraft({ ...draft, cost: { ...draft.cost, slippageBp: v ?? 5 } })}
                />
              </Form.Item>
              <Form.Item label="换手上限 (%)">
                <InputNumber
                  min={0}
                  value={draft.cost.turnoverLimitPct}
                  onChange={(v) => setDraft({ ...draft, cost: { ...draft.cost, turnoverLimitPct: v ?? 0 } })}
                />
              </Form.Item>
            </Space>
            <Form.Item label="风控规则集" required>
              <Select
                value={draft.riskRuleSetId || undefined}
                onChange={(v) => setDraft({ ...draft, riskRuleSetId: v })}
                options={frozenRisk.map((r) => ({ value: r.id, label: `${r.name} · v${r.version}` }))}
              />
            </Form.Item>
          </Form>
        )
      case 5:
        return (
          <Form layout="vertical">
            <Form.Item label="搜索空间">
              <Input
                value={draft.budget.searchSpace}
                onChange={(e) => setDraft({ ...draft, budget: { ...draft.budget, searchSpace: e.target.value } })}
              />
            </Form.Item>
            <Form.Item label="最大尝试次数">
              <InputNumber
                min={1}
                value={draft.budget.maxAttempts}
                onChange={(v) => setDraft({ ...draft, budget: { ...draft.budget, maxAttempts: v ?? 12 } })}
              />
            </Form.Item>
            <Form.Item label="随机种子（逗号分隔）">
              <Input
                value={draft.budget.seeds.join(', ')}
                onChange={(e) => {
                  const seeds = e.target.value
                    .split(',')
                    .map((s) => parseInt(s.trim(), 10))
                    .filter((n) => !Number.isNaN(n))
                  setDraft({ ...draft, budget: { ...draft.budget, seeds } })
                }}
              />
            </Form.Item>
            <Alert type="info" showIcon message="全部尝试将被记录，不可隐藏。" />
          </Form>
        )
      case 6:
        return (
          <div>
            <Alert
              type="warning"
              showIcon
              message="请确认预注册协议完整无误。冻结后不可修改，最终测试只运行一次。"
              style={{ marginBottom: 16 }}
            />
            <Checkbox checked={freezeConfirmed} onChange={(e) => setFreezeConfirmed(e.target.checked)}>
              我确认上述预注册协议完整无误，并理解冻结后不可修改、最终测试只运行一次。
            </Checkbox>
            <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
              <Descriptions.Item label="研究假设" span={2}>{draft.hypothesis.statement || '—'}</Descriptions.Item>
              <Descriptions.Item label="数据版本">{draft.datasetVersionId || '—'}</Descriptions.Item>
              <Descriptions.Item label="策略版本">{draft.strategyVersionId || '—'}</Descriptions.Item>
              <Descriptions.Item label="标的池">{draft.universe}</Descriptions.Item>
              <Descriptions.Item label="风控规则集">{draft.riskRuleSetId || '—'}</Descriptions.Item>
              <Descriptions.Item label="时间切分" span={2}>{draft.split.trainStart} ~ {draft.split.trainEnd} / {draft.split.validationStart} ~ {draft.split.validationEnd} / {draft.split.testStart} ~ {draft.split.testEnd}</Descriptions.Item>
              <Descriptions.Item label="主要指标">{draft.hypothesis.primaryMetrics.join('、') || '—'}</Descriptions.Item>
              <Descriptions.Item label="随机种子">{draft.budget.seeds.join(', ') || '—'}</Descriptions.Item>
            </Descriptions>
            <pre
              style={{
                background: 'rgba(0,0,0,0.04)',
                padding: 16,
                borderRadius: 8,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 360,
              }}
            >
              {JSON.stringify(draft, null, 2)}
            </pre>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div>
      <PageHeader title="新建实验" subtitle="七步预注册向导" meta={[`步骤 ${step + 1} / 7`]} />
      <Steps current={step} items={STEPS.map((t) => ({ title: t }))} size="small" style={{ marginTop: 16 }} />
      <div style={{ marginTop: 24, minHeight: 320 }}>{renderStep()}</div>
      <Space style={{ marginTop: 24 }}>
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          上一步
        </Button>
        {step < 6 ? (
          <Button type="primary" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
            下一步
          </Button>
        ) : (
          <Button type="primary" loading={submitting} disabled={!canNext()} onClick={() => void handleSubmit()}>
            提交并冻结协议
          </Button>
        )}
      </Space>
    </div>
  )
}

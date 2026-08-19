/**
 * 实验 Mock：实验列表、详情与运行列表。
 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'
import type { TaskStatus } from '@/api/mock/tasks'
import type { ExperimentDraft } from '@/api/mock/experimentNew'
import { registerMockRun } from '@/api/mock/runs'

export type ExperimentStatus = 'running' | 'completed' | 'archived'

export interface Experiment {
  id: string
  name: string
  hypothesisSummary: string
  status: ExperimentStatus
  runCount: number
  latestRunStatus: TaskStatus
  owner: string
  frozenAt: string
  updatedAt: string
}

export interface ExperimentRunSummary {
  id: string
  experimentId: string
  strategyVersionId: string
  modelVersionId: string
  modelName: string
  seeds: number[]
  status: TaskStatus
  annualReturn?: number
  maxDrawdown?: number
  sharpe?: number
  durationSec: number
  createdAt: string
}

export interface ExperimentDetail extends Experiment {
  protocol: ExperimentDraft
}

const MOCK_PROTOCOL: ExperimentDraft = {
  hypothesis: {
    statement: '20 日动量因子在沪深300成分股中具有样本外超额收益',
    primaryMetrics: ['年化超额', 'Sharpe', '最大回撤'],
    secondaryMetrics: ['换手率', '成本贡献'],
    failureConditions: '样本外 Sharpe < 0.5 或最大回撤 > 15%',
    stopRule: '连续 3 个窗口未通过验证则停止',
  },
  datasetVersionId: 'ds-ashare-v3',
  universe: '沪深300',
  pointInTimeRule: 'T+1 可交易，复权后复权',
  strategyVersionId: 'st-momentum-v2',
  baselineIds: ['m-buyhold-v1', 'm-linreg-v1'],
  candidateIds: ['m-lgbm-v1'],
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
  riskRuleSetId: 'rc-standard-v1',
  budget: { searchSpace: 'topN × holdDays', maxAttempts: 12, seeds: [42, 43, 44] },
}

const MOCK_REGISTERED_PROTOCOLS = new Map<string, ExperimentDraft>()

function copyExperimentDraft(draft: ExperimentDraft): ExperimentDraft {
  return {
    ...draft,
    hypothesis: {
      ...draft.hypothesis,
      primaryMetrics: [...draft.hypothesis.primaryMetrics],
      secondaryMetrics: [...draft.hypothesis.secondaryMetrics],
    },
    baselineIds: [...draft.baselineIds],
    candidateIds: [...draft.candidateIds],
    split: { ...draft.split },
    cost: { ...draft.cost },
    budget: { ...draft.budget, seeds: [...draft.budget.seeds] },
  }
}

const MOCK_EXPERIMENTS: Experiment[] = [
  {
    id: 'exp-momentum-0042',
    name: '动量因子有效性验证',
    hypothesisSummary: '20 日动量因子在沪深300成分股中具有样本外超额收益',
    status: 'running',
    runCount: 5,
    latestRunStatus: 'running',
    owner: '陈默',
    frozenAt: '2026-07-28T16:00:00+08:00',
    updatedAt: '2026-08-08T10:24:00+08:00',
  },
  {
    id: 'exp-value-0012',
    name: '价值因子季度再平衡',
    hypothesisSummary: '低估值因子在中证500具有稳定超额',
    status: 'completed',
    runCount: 3,
    latestRunStatus: 'success',
    owner: '陈默',
    frozenAt: '2026-06-15T10:00:00+08:00',
    updatedAt: '2026-07-20T14:30:00+08:00',
  },
  {
    id: 'exp-lgbm-0008',
    name: 'LightGBM 因子组合',
    hypothesisSummary: '树模型非线性组合优于线性回归基线',
    status: 'completed',
    runCount: 4,
    latestRunStatus: 'failed',
    owner: '李研',
    frozenAt: '2026-05-01T09:00:00+08:00',
    updatedAt: '2026-08-07T16:40:00+08:00',
  },
]

const MOCK_RUNS: ExperimentRunSummary[] = [
  {
    id: 'R-0042',
    experimentId: 'exp-momentum-0042',
    strategyVersionId: 'st-momentum-v2',
    modelVersionId: 'm-lgbm-v1',
    modelName: 'LightGBM v1',
    seeds: [42, 43, 44],
    status: 'running',
    durationSec: 942,
    createdAt: '2026-08-08T10:24:00+08:00',
  },
  {
    id: 'R-0041',
    experimentId: 'exp-momentum-0042',
    strategyVersionId: 'st-momentum-v2',
    modelVersionId: 'm-linreg-v1',
    modelName: '线性回归 v1',
    seeds: [42, 43, 44],
    status: 'success',
    annualReturn: 12.3,
    maxDrawdown: -8.4,
    sharpe: 1.02,
    durationSec: 1840,
    createdAt: '2026-08-08T08:12:00+08:00',
  },
  {
    id: 'R-0040',
    experimentId: 'exp-momentum-0042',
    strategyVersionId: 'st-momentum-v2',
    modelVersionId: 'm-buyhold-v1',
    modelName: '买入持有',
    seeds: [42],
    status: 'queued',
    durationSec: 0,
    createdAt: '2026-08-08T11:05:00+08:00',
  },
  {
    id: 'R-0035',
    experimentId: 'exp-lgbm-0008',
    strategyVersionId: 'st-lion-v1',
    modelVersionId: 'm-lgbm-v1',
    modelName: 'LightGBM v1',
    seeds: [42, 43],
    status: 'failed',
    durationSec: 1215,
    createdAt: '2026-08-07T16:40:00+08:00',
  },
]

export interface RegisterMockExperimentRunInput {
  experimentId: string
  runId: string
  draft: ExperimentDraft
  createdAt: string
}

export function registerMockExperimentRun({
  experimentId,
  runId,
  draft,
  createdAt,
}: RegisterMockExperimentRunInput): void {
  if (MOCK_EXPERIMENTS.some((experiment) => experiment.id === experimentId)) {
    throw new ApiError({
      code: 'EXP-409',
      message: `实验已存在：${experimentId}`,
      requestId: generateRequestId(),
    })
  }
  if (MOCK_RUNS.some((run) => run.id === runId)) {
    throw new ApiError({
      code: 'RUN-409',
      message: `运行已存在：${runId}`,
      requestId: generateRequestId(),
    })
  }

  const experimentName = draft.hypothesis.statement.trim() || `实验 ${experimentId}`
  const modelVersionId = draft.candidateIds[0] ?? draft.baselineIds[0] ?? 'unassigned'
  registerMockRun({
    id: runId,
    experimentId,
    experimentName,
    datasetVersionId: draft.datasetVersionId,
    strategyVersionId: draft.strategyVersionId,
    modelVersionId,
    riskRuleSetId: draft.riskRuleSetId,
    seeds: draft.budget.seeds,
  })

  MOCK_EXPERIMENTS.unshift({
    id: experimentId,
    name: experimentName,
    hypothesisSummary: draft.hypothesis.statement,
    status: 'running',
    runCount: 1,
    latestRunStatus: 'queued',
    owner: '陈默',
    frozenAt: createdAt,
    updatedAt: createdAt,
  })
  MOCK_REGISTERED_PROTOCOLS.set(experimentId, copyExperimentDraft(draft))
  MOCK_RUNS.unshift({
    id: runId,
    experimentId,
    strategyVersionId: draft.strategyVersionId,
    modelVersionId,
    modelName: modelVersionId,
    seeds: [...draft.budget.seeds],
    status: 'queued',
    durationSec: 0,
    createdAt,
  })
}

export function listExperiments(options?: MockRequestOptions): Promise<Experiment[]> {
  return mockRequest(() => MOCK_EXPERIMENTS.map((e) => ({ ...e })), options)
}

export function getExperiment(id: string, options?: MockRequestOptions): Promise<ExperimentDetail> {
  return mockRequest(
    () => {
      const item = MOCK_EXPERIMENTS.find((e) => e.id === id)
      if (!item) {
        throw new ApiError({
          code: 'IR-0404',
          message: `实验不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      const protocol = MOCK_REGISTERED_PROTOCOLS.get(id) ?? MOCK_PROTOCOL
      return { ...item, protocol: copyExperimentDraft(protocol) }
    },
    options,
  )
}

export function listExperimentRuns(
  experimentId: string,
  options?: MockRequestOptions,
): Promise<ExperimentRunSummary[]> {
  return mockRequest(
    () =>
      MOCK_RUNS.filter((r) => r.experimentId === experimentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r })),
    options,
  )
}

export function getRunSummary(
  runId: string,
  options?: MockRequestOptions,
): Promise<ExperimentRunSummary> {
  return mockRequest(
    () => {
      const run = MOCK_RUNS.find((r) => r.id === runId)
      if (!run) {
        throw new ApiError({
          code: 'IR-0404',
          message: `运行不存在：${runId}`,
          requestId: generateRequestId(),
        })
      }
      return { ...run }
    },
    options,
  )
}

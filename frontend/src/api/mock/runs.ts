/**
 * 运行详情 Mock：概览指标、净值序列、状态时间线。
 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'
import type { TaskStatus } from '@/api/mock/tasks'

export interface RunMetrics {
  annualReturn: number
  maxDrawdown: number
  sharpe: number
  sortino: number
  calmar: number
  turnover: number
  costContribution: number
  dataCutoff: string
}

export interface RunDetail {
  id: string
  experimentId: string
  experimentName: string
  status: TaskStatus
  progress: number
  datasetVersionId: string
  strategyVersionId: string
  modelVersionId: string
  riskRuleSetId: string
  seeds: number[]
  codeCommit: string
  metrics: RunMetrics | null
  partialResult: boolean
  errorSummary?: string
  cancelReason?: string
}

export interface NavPoint {
  date: string
  nav: number
  drawdown: number
  benchmark: number
}

export interface TradeDetail {
  id: string
  timestamp: string
  symbol: string
  direction: '买入' | '卖出'
  price: number
  quantity: number
  fee: number
  slippage: number
  status: 'filled' | 'partial' | 'rejected'
}

export interface ValidationWindow {
  id: string
  label: string
  annualReturn: number
  sharpe: number
  coverage: number
  status: 'passed' | 'failed' | 'insufficient_evidence'
  note: string
}

const MOCK_RUN_TRADES: Record<string, TradeDetail[]> = {
  'R-0041': [
    { id: 'T-0041-001', timestamp: '2026-07-01T09:31:00+08:00', symbol: '600519.SH', direction: '买入', price: 1688.2, quantity: 100, fee: 50.64, slippage: 0.12, status: 'filled' },
    { id: 'T-0041-002', timestamp: '2026-07-01T09:31:00+08:00', symbol: '000858.SZ', direction: '买入', price: 121.45, quantity: 800, fee: 29.15, slippage: 0.08, status: 'filled' },
    { id: 'T-0041-003', timestamp: '2026-07-22T09:32:00+08:00', symbol: '600519.SH', direction: '卖出', price: 1724.8, quantity: 100, fee: 51.74, slippage: 0.16, status: 'filled' },
    { id: 'T-0041-004', timestamp: '2026-07-22T09:32:00+08:00', symbol: '300750.SZ', direction: '买入', price: 188.6, quantity: 500, fee: 28.29, slippage: 0.21, status: 'partial' },
  ],
  'R-0035': [
    { id: 'T-0035-001', timestamp: '2026-07-01T09:31:00+08:00', symbol: '601318.SH', direction: '买入', price: 42.18, quantity: 1200, fee: 15.18, slippage: 0.05, status: 'filled' },
  ],
}

const MOCK_RUN_VALIDATION: Record<string, ValidationWindow[]> = {
  'R-0041': [
    { id: 'w1', label: '窗口 1 · 2021–2022', annualReturn: 10.8, sharpe: 0.91, coverage: 0.92, status: 'passed', note: '覆盖率达到目标' },
    { id: 'w2', label: '窗口 2 · 2022–2023', annualReturn: 14.6, sharpe: 1.12, coverage: 0.94, status: 'passed', note: '成本敏感性通过' },
    { id: 'w3', label: '窗口 3 · 2023–2024', annualReturn: 7.1, sharpe: 0.58, coverage: 0.88, status: 'insufficient_evidence', note: '样本较少，需结合压力测试解释' },
    { id: 'w4', label: '窗口 4 · 2024–2025', annualReturn: 16.4, sharpe: 1.42, coverage: 0.95, status: 'passed', note: '最优窗口，不作为唯一选择依据' },
  ],
  'R-0035': [
    { id: 'w1', label: '窗口 1 · 2021–2022', annualReturn: 4.2, sharpe: 0.31, coverage: 0.76, status: 'failed', note: '校准覆盖率低于目标' },
    { id: 'w2', label: '窗口 2 · 2022–2023', annualReturn: 0, sharpe: 0, coverage: 0, status: 'insufficient_evidence', note: 'Worker 内存溢出，窗口未完成' },
  ],
}

const MOCK_RUN_DETAILS: Record<string, RunDetail> = {
  'R-0042': {
    id: 'R-0042',
    experimentId: 'exp-momentum-0042',
    experimentName: '动量因子有效性验证',
    status: 'running',
    progress: 64,
    datasetVersionId: 'ds-ashare-v3',
    strategyVersionId: 'st-momentum-v2',
    modelVersionId: 'm-lgbm-v1',
    riskRuleSetId: 'rc-standard-v1',
    seeds: [42, 43, 44],
    codeCommit: 'a1b2c3d',
    metrics: null,
    partialResult: false,
  },
  'R-0041': {
    id: 'R-0041',
    experimentId: 'exp-momentum-0042',
    experimentName: '动量因子有效性验证',
    status: 'success',
    progress: 100,
    datasetVersionId: 'ds-ashare-v3',
    strategyVersionId: 'st-momentum-v2',
    modelVersionId: 'm-linreg-v1',
    riskRuleSetId: 'rc-standard-v1',
    seeds: [42, 43, 44],
    codeCommit: 'a1b2c3d',
    metrics: {
      annualReturn: 12.3,
      maxDrawdown: -8.4,
      sharpe: 1.02,
      sortino: 1.35,
      calmar: 1.46,
      turnover: 240,
      costContribution: 1.8,
      dataCutoff: '2026-07-31',
    },
    partialResult: false,
  },
  'R-0035': {
    id: 'R-0035',
    experimentId: 'exp-lgbm-0008',
    experimentName: 'LightGBM 因子组合',
    status: 'failed',
    progress: 41,
    datasetVersionId: 'ds-ashare-v3',
    strategyVersionId: 'st-lion-v1',
    modelVersionId: 'm-lgbm-v1',
    riskRuleSetId: 'rc-standard-v1',
    seeds: [42, 43],
    codeCommit: 'f9e8d7c',
    metrics: null,
    partialResult: true,
    errorSummary: '验证窗口 3 内存溢出，Worker 已终止。部分窗口指标已写入产物。',
  },
}

export interface RegisterMockRunInput {
  id: string
  experimentId: string
  experimentName: string
  datasetVersionId: string
  strategyVersionId: string
  modelVersionId: string
  riskRuleSetId: string
  seeds: number[]
}

export function registerMockRun(input: RegisterMockRunInput): RunDetail {
  if (MOCK_RUN_DETAILS[input.id]) {
    throw new ApiError({
      code: 'RUN-409',
      message: `运行已存在：${input.id}`,
      requestId: generateRequestId(),
    })
  }

  const run: RunDetail = {
    id: input.id,
    experimentId: input.experimentId,
    experimentName: input.experimentName,
    status: 'queued',
    progress: 0,
    datasetVersionId: input.datasetVersionId,
    strategyVersionId: input.strategyVersionId,
    modelVersionId: input.modelVersionId,
    riskRuleSetId: input.riskRuleSetId,
    seeds: [...input.seeds],
    codeCommit: 'mock-local',
    metrics: null,
    partialResult: false,
  }
  MOCK_RUN_DETAILS[run.id] = run
  return { ...run, seeds: [...run.seeds] }
}

let runAuditSeq = 1

function generateRunAuditId(date = new Date()): string {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AUD-${ymd}-${String(runAuditSeq++).padStart(4, '0')}`
}

function generateNavSeries(seed: number): NavPoint[] {
  const points: NavPoint[] = []
  let nav = 1
  let peak = 1
  for (let i = 0; i < 120; i++) {
    const drift = Math.sin((i + seed) / 12) * 0.008 + 0.002
    nav *= 1 + drift
    peak = Math.max(peak, nav)
    const drawdown = ((nav - peak) / peak) * 100
    const benchmark = 1 + i * 0.0015
    points.push({
      date: `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      nav: Number(nav.toFixed(4)),
      drawdown: Number(drawdown.toFixed(2)),
      benchmark: Number(benchmark.toFixed(4)),
    })
  }
  return points
}

export function getRunDetail(runId: string, options?: MockRequestOptions): Promise<RunDetail> {
  return mockRequest(
    () => {
      const detail = MOCK_RUN_DETAILS[runId]
      if (!detail) {
        throw new ApiError({
          code: 'IR-0404',
          message: `运行不存在：${runId}`,
          requestId: generateRequestId(),
        })
      }
      return { ...detail, metrics: detail.metrics ? { ...detail.metrics } : null }
    },
    options,
  )
}

export function getRunNavSeries(runId: string, options?: MockRequestOptions): Promise<NavPoint[]> {
  return mockRequest(() => generateNavSeries(runId.charCodeAt(2) ?? 42), options)
}

export function listRunTrades(runId: string, options?: MockRequestOptions): Promise<TradeDetail[]> {
  return mockRequest(
    () => (MOCK_RUN_TRADES[runId] ?? []).map((trade) => ({ ...trade })),
    options,
  )
}

export function listRunValidation(
  runId: string,
  options?: MockRequestOptions,
): Promise<ValidationWindow[]> {
  return mockRequest(
    () => (MOCK_RUN_VALIDATION[runId] ?? []).map((window) => ({ ...window })),
    options,
  )
}

/** 请求取消运行；演示环境直接进入已取消终态。 */
export function cancelRun(
  runId: string,
  reason: string,
  options?: MockRequestOptions,
): Promise<{ run: RunDetail; auditId: string }> {
  return mockRequest(
    () => {
      const run = MOCK_RUN_DETAILS[runId]
      if (!run) {
        throw new ApiError({
          code: 'IR-0404',
          message: `运行不存在：${runId}`,
          requestId: generateRequestId(),
        })
      }
      if (run.status !== 'running' && run.status !== 'cancel_requested') {
        throw new ApiError({
          code: 'RUN-409',
          message: '只有运行中任务可以请求取消',
          requestId: generateRequestId(),
        })
      }
      if (!reason.trim()) {
        throw new ApiError({
          code: 'RUN-400',
          message: '取消运行必须填写原因',
          requestId: generateRequestId(),
        })
      }
      run.status = 'canceled'
      run.cancelReason = reason.trim()
      return {
        run: { ...run, metrics: run.metrics ? { ...run.metrics } : null },
        auditId: generateRunAuditId(),
      }
    },
    options,
  )
}

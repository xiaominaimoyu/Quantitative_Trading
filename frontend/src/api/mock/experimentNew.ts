/**
 * 实验创建向导 Mock：预注册协议提交与输入指纹检测。
 *
 * 指纹复用规则：数据集版本 ds-ashare-v3 + 策略版本 st-momentum-v2
 * + 种子集合完全等于 [42,43,44] → 判定为与既有运行重复，
 * 返回既有运行信息供向导给出「查看既有结果 / 作为复现运行」选择。
 */

import { mockRequest, type MockRequestOptions } from '@/api/client'
import { registerMockExperimentRun } from '@/api/mock/experiments'

/** 研究假设（步骤 1） */
export interface ExperimentHypothesis {
  statement: string
  primaryMetrics: string[]
  secondaryMetrics: string[]
  failureConditions: string
  stopRule: string
}

/** 时间切分（步骤 4），日期为 YYYY-MM-DD */
export interface ExperimentSplit {
  trainStart: string
  trainEnd: string
  validationStart: string
  validationEnd: string
  testStart: string
  testEnd: string
  walkForwardWindows: number
  purgeDays: number
  embargoDays: number
}

/** 成本与风控（步骤 5） */
export interface ExperimentCost {
  commissionBp: number
  slippageBp: number
  turnoverLimitPct: number
}

/** 调参预算（步骤 6） */
export interface ExperimentBudget {
  searchSpace: string
  maxAttempts: number
  seeds: number[]
}

/** 预注册协议（提交载荷） */
export interface ExperimentDraft {
  hypothesis: ExperimentHypothesis
  datasetVersionId: string
  universe: string
  pointInTimeRule: string
  strategyVersionId: string
  baselineIds: string[]
  candidateIds: string[]
  split: ExperimentSplit
  cost: ExperimentCost
  riskRuleSetId: string
  budget: ExperimentBudget
}

export interface SubmitExperimentResult {
  /** 本次提交产生的运行（或复现运行）编号 */
  runId: string
  /** 本次提交归属的实验编号 */
  experimentId: string
  /** 输入指纹是否命中既有运行 */
  isDuplicate: boolean
  /** 命中时的既有运行编号 */
  existingRunId?: string
  /** 命中时的既有实验编号 */
  existingExperimentId?: string
  /** 命中时的既有运行完成时间（ISO，Asia/Shanghai） */
  existingFinishedAt?: string
}

export interface SubmitExperimentOptions extends MockRequestOptions {
  /** 重复输入时仍创建新的复现运行。 */
  force?: boolean
}

/** 数组完全相等（长度 + 顺序 + 值） */
function sameValues(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

let experimentSeq = 43
let runSeq = 50

function createExperimentId(): string {
  return `exp-momentum-${String(experimentSeq++).padStart(4, '0')}`
}

function createRunId(): string {
  return `R-${String(runSeq++).padStart(4, '0')}`
}

/**
 * 提交预注册协议。
 * 指纹命中时返回 isDuplicate=true 并携带既有运行信息；
 * 未命中返回 isDuplicate=false 与新建运行编号。
 */
export function submitExperiment(
  draft: ExperimentDraft,
  options?: SubmitExperimentOptions,
): Promise<SubmitExperimentResult> {
  return mockRequest(() => {
    const isDuplicate =
      draft.datasetVersionId === 'ds-ashare-v3' &&
      draft.strategyVersionId === 'st-momentum-v2' &&
      sameValues(draft.budget.seeds, [42, 43, 44])

    if (isDuplicate && !options?.force) {
      return {
        runId: 'R-0041',
        experimentId: 'exp-momentum-0042',
        isDuplicate: true,
        existingRunId: 'R-0041',
        existingExperimentId: 'exp-momentum-0042',
        existingFinishedAt: '2026-08-01T09:30:00+08:00',
      }
    }

    const experimentId = createExperimentId()
    const runId = createRunId()
    registerMockExperimentRun({
      experimentId,
      runId,
      draft,
      createdAt: new Date().toISOString(),
    })
    return {
      runId,
      experimentId,
      isDuplicate: false,
    }
  }, options)
}

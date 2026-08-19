/**
 * 风控 Mock：风控规则集的查询函数与数据。
 *
 * 供「新建实验向导」步骤 5 使用：仅 status === 'frozen' 的规则集可选。
 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'

/** 规则集冻结状态（draft / frozen / deprecated） */
export type RiskRuleSetStatus = 'draft' | 'frozen' | 'deprecated'

/** 风控规则集 */
export interface RiskRuleSet {
  id: string
  name: string
  /** 版本号（v1 → 1） */
  version: number
  status: RiskRuleSetStatus
}

const MOCK_RISK_RULE_SETS: RiskRuleSet[] = [
  {
    id: 'rc-standard-v1',
    name: '标准风控（单标的持仓上限 10%）',
    version: 1,
    status: 'frozen',
  },
  {
    id: 'rc-strict-v1',
    name: '严格风控（熔断 + 单标的 5%）',
    version: 1,
    status: 'frozen',
  },
  {
    id: 'rc-loose-v1',
    name: '宽松风控（仅熔断）',
    version: 1,
    status: 'deprecated',
  },
  {
    id: 'rc-standard-v2',
    name: '标准风控（单标的持仓上限 10%）',
    version: 2,
    status: 'draft',
  },
]

/** 查询全部风控规则集 */
export function listRiskRuleSets(
  options?: MockRequestOptions,
): Promise<RiskRuleSet[]> {
  return mockRequest(
    () => MOCK_RISK_RULE_SETS.map((r) => ({ ...r })),
    options,
  )
}

let riskAuditSeq = 1

function generateRiskAuditId(date = new Date()): string {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AUD-${ymd}-${String(riskAuditSeq++).padStart(4, '0')}`
}

/** 冻结草稿规则集，并返回审计编号。 */
export function freezeRiskRuleSet(
  id: string,
  reason: string,
  options?: MockRequestOptions,
): Promise<{ ruleSet: RiskRuleSet; auditId: string }> {
  return mockRequest(
    () => {
      const ruleSet = MOCK_RISK_RULE_SETS.find((r) => r.id === id)
      if (!ruleSet) {
        throw new ApiError({
          code: 'IR-0404',
          message: `风控规则集不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      if (ruleSet.status !== 'draft') {
        throw new ApiError({
          code: 'RSK-409',
          message: '只有草稿规则集可以冻结',
          requestId: generateRequestId(),
        })
      }
      if (!reason.trim()) {
        throw new ApiError({
          code: 'RSK-400',
          message: '冻结操作必须填写原因',
          requestId: generateRequestId(),
        })
      }

      ruleSet.status = 'frozen'
      return { ruleSet: { ...ruleSet }, auditId: generateRiskAuditId() }
    },
    options,
  )
}

/** 风险事件 */
export interface RiskEvent {
  id: string
  timestamp: string
  type: 'covered' | 'rejected' | 'circuit_breaker' | 'manual_review'
  ruleSetId: string
  runId: string
  symbol?: string
  beforeTarget: string
  afterTarget: string
  reason: string
  auditId: string
}

const MOCK_RISK_EVENTS: RiskEvent[] = [
  {
    id: 're-001',
    timestamp: '2026-08-08T09:15:00+08:00',
    type: 'rejected',
    ruleSetId: 'rc-standard-v1',
    runId: 'R-0042',
    symbol: '600519.SH',
    beforeTarget: '12%',
    afterTarget: '10%',
    reason: '单标的持仓超过 10% 上限',
    auditId: 'AUD-20260808-0002',
  },
  {
    id: 're-002',
    timestamp: '2026-08-07T14:22:00+08:00',
    type: 'circuit_breaker',
    ruleSetId: 'rc-strict-v1',
    runId: 'R-0035',
    beforeTarget: '继续运行',
    afterTarget: '暂停',
    reason: '日亏损超过熔断阈值',
    auditId: 'AUD-20260807-0011',
  },
]

export function listRiskEvents(options?: MockRequestOptions): Promise<RiskEvent[]> {
  return mockRequest(
    () => MOCK_RISK_EVENTS.map((e) => ({ ...e })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    options,
  )
}

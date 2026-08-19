import { ApiError, generateRequestId, mockRequest } from '../client.ts'
import { mockAuditId, replayMockMutation } from '../research/mock.ts'
import type {
  AshareDailyRiskRulesV1,
  CreateRiskRuleSetInput,
  CreateRiskRuleVersionInput,
  MutationOptions,
  RiskRuleSet,
  RiskRuleSetListQuery,
  RiskRuleSetMutation,
  RiskRuleSetPage,
  RiskRuleVersion,
  RiskRuleVersionListQuery,
  RiskRuleVersionMutation,
  RiskRuleVersionPage,
} from './types.ts'

const ruleSetId = '09663935-1432-4cdc-aa1c-53f65c9a1551'
const frozenVersionId = 'c20aa34a-4cb5-46cb-af09-228bef4c0770'

const baselineContent: AshareDailyRiskRulesV1 = {
  contract_version: 'ashare_daily_risk_v1',
  market: 'CN_A',
  frequency: 'daily',
  max_single_position_bp: 1000,
  max_industry_position_bp: 3000,
  max_gross_exposure_bp: 10000,
  max_concentration_hhi_bp: 1500,
  max_daily_turnover_bp: 30000,
  daily_loss_circuit_breaker_bp: 500,
  max_drawdown_circuit_breaker_bp: 1500,
  uncertain_state_action: 'freeze_risk_increase',
  risk_reduction_bypasses_opening_limits: true,
  input_contract: 'risk_targets_v1',
  output_contract: 'risk_decision_v1',
}

const ruleSets: RiskRuleSet[] = [{
  id: ruleSetId,
  slug: 'ashare-daily-risk',
  name: 'A 股日线风险规则',
  description: '七类确定性阈值与不确定状态保护。',
  ownerKey: 'frontend-dev-auditor',
  versionCount: 1,
  latestVersionId: frozenVersionId,
  latestVersionNo: 1,
  latestVersionStatus: 'frozen',
  createdAt: '2026-08-13T00:00:00+08:00',
  updatedAt: '2026-08-13T01:00:00+08:00',
}]

const versions: RiskRuleVersion[] = [{
  id: frozenVersionId,
  riskRuleSetId: ruleSetId,
  version: 1,
  parentVersionId: null,
  status: 'frozen',
  contractName: 'ashare_daily_risk_v1',
  content: baselineContent,
  contentSha256: 'c'.repeat(64),
  eligibleForNewExperiment: true,
  note: '首个 A 股日线风险基线',
  createdByKey: 'frontend-dev-auditor',
  createdAt: '2026-08-13T00:00:00+08:00',
  frozenByKey: 'frontend-dev-auditor',
  frozenAt: '2026-08-13T01:00:00+08:00',
  freezeReason: '风险阈值评审通过',
  deprecatedByKey: null,
  deprecatedAt: null,
  deprecateReason: null,
}]

function notFound(message: string): never {
  throw new ApiError({ code: 'RISK_RULE_SET_NOT_FOUND', message, requestId: generateRequestId() })
}

export function listRiskRuleSets(_query: RiskRuleSetListQuery = {}): Promise<RiskRuleSetPage> {
  return mockRequest(() => ({
    items: ruleSets.map((item) => ({ ...item })),
    page: { hasMore: false, nextCursor: null },
  }), { latencyMs: 0 })
}

export function getRiskRuleSet(id: string): Promise<RiskRuleSet> {
  return mockRequest(() => {
    const item = ruleSets.find((value) => value.id === id)
    return item ? { ...item } : notFound(`风险规则集不存在：${id}`)
  }, { latencyMs: 0 })
}

export function listRiskRuleVersions(
  ownerId: string,
  query: RiskRuleVersionListQuery = {},
): Promise<RiskRuleVersionPage> {
  return mockRequest(() => ({
    items: versions
      .filter((item) => item.riskRuleSetId === ownerId && (!query.status || item.status === query.status))
      .sort((a, b) => b.version - a.version)
      .map((item) => ({ ...item, content: { ...item.content } })),
    page: { hasMore: false, nextCursor: null },
  }), { latencyMs: 0 })
}

export function getRiskRuleVersion(id: string): Promise<RiskRuleVersion> {
  return mockRequest(() => {
    const item = versions.find((value) => value.id === id)
    if (!item) notFound(`风险规则版本不存在：${id}`)
    return { ...item, content: { ...item.content } }
  }, { latencyMs: 0 })
}

export function createRiskRuleSet(
  input: CreateRiskRuleSetInput,
  options: MutationOptions,
): Promise<RiskRuleSetMutation> {
  return mockRequest(() => replayMockMutation('risk-rule-set:create', input, options, () => {
    const now = new Date().toISOString()
    const item: RiskRuleSet = {
      id: crypto.randomUUID(),
      ...input,
      ownerKey: 'frontend-dev-auditor',
      versionCount: 0,
      latestVersionId: null,
      latestVersionNo: null,
      latestVersionStatus: null,
      createdAt: now,
      updatedAt: now,
    }
    ruleSets.push(item)
    return { item: { ...item }, auditEventId: mockAuditId() }
  }), { latencyMs: 0 })
}

export function createRiskRuleVersion(
  ownerId: string,
  input: CreateRiskRuleVersionInput,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  return mockRequest(() => replayMockMutation(`risk-rule-set:${ownerId}:version:create`, input, options, () => {
    const owner = ruleSets.find((value) => value.id === ownerId)
    if (!owner) notFound(`风险规则集不存在：${ownerId}`)
    const parent = input.parentVersionId
      ? versions.find((value) => value.id === input.parentVersionId && value.riskRuleSetId === ownerId)
      : null
    if (input.parentVersionId && parent?.status !== 'frozen') {
      throw new ApiError({ code: 'RISK_RULE_PARENT_NOT_FROZEN', message: '父版本必须已冻结', requestId: generateRequestId() })
    }
    const now = new Date().toISOString()
    const item: RiskRuleVersion = {
      id: crypto.randomUUID(),
      riskRuleSetId: ownerId,
      version: owner.versionCount + 1,
      parentVersionId: input.parentVersionId,
      status: 'draft',
      contractName: 'ashare_daily_risk_v1',
      content: { ...input.content },
      contentSha256: 'd'.repeat(64),
      eligibleForNewExperiment: false,
      note: input.note,
      createdByKey: owner.ownerKey,
      createdAt: now,
      frozenByKey: null,
      frozenAt: null,
      freezeReason: null,
      deprecatedByKey: null,
      deprecatedAt: null,
      deprecateReason: null,
    }
    versions.push(item)
    owner.versionCount = item.version
    owner.latestVersionId = item.id
    owner.latestVersionNo = item.version
    owner.latestVersionStatus = item.status
    owner.updatedAt = now
    return { item: { ...item, content: { ...item.content } }, auditEventId: mockAuditId() }
  }), { latencyMs: 0 })
}

function transition(
  id: string,
  action: 'freeze' | 'deprecate',
  reason: string,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  return mockRequest(() => replayMockMutation(`risk-rule-version:${id}:${action}`, { reason }, options, () => {
    const item = versions.find((value) => value.id === id)
    if (!item) notFound(`风险规则版本不存在：${id}`)
    const expected = action === 'freeze' ? 'draft' : 'frozen'
    if (item.status !== expected) {
      throw new ApiError({ code: 'RISK_RULE_VERSION_STATE_CONFLICT', message: '版本状态不允许该操作', requestId: generateRequestId() })
    }
    const now = new Date().toISOString()
    if (action === 'freeze') {
      item.status = 'frozen'
      item.eligibleForNewExperiment = true
      item.frozenAt = now
      item.frozenByKey = item.createdByKey
      item.freezeReason = reason
    } else {
      item.status = 'deprecated'
      item.eligibleForNewExperiment = false
      item.deprecatedAt = now
      item.deprecatedByKey = item.createdByKey
      item.deprecateReason = reason
    }
    return { item: { ...item, content: { ...item.content } }, auditEventId: mockAuditId() }
  }), { latencyMs: 0 })
}

export function freezeRiskRuleVersion(id: string, reason: string, options: MutationOptions) {
  return transition(id, 'freeze', reason, options)
}

export function deprecateRiskRuleVersion(id: string, reason: string, options: MutationOptions) {
  return transition(id, 'deprecate', reason, options)
}

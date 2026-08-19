import { ApiError, generateRequestId, mockRequest } from '../client.ts'
import { mockAuditId, replayMockMutation } from '../research/mock.ts'
import type {
  CreateStrategyInput,
  CreateStrategyVersionInput,
  CrossSectionalMomentumStrategyV1,
  MutationOptions,
  Strategy,
  StrategyListQuery,
  StrategyMutation,
  StrategyPage,
  StrategyVersion,
  StrategyVersionListQuery,
  StrategyVersionMutation,
  StrategyVersionPage,
} from './types.ts'

const strategyId = 'ee1c9959-42a6-4384-b268-a44ad53b7cf2'
const frozenVersionId = '52964104-b3a5-48cb-b294-b642cda0eea8'

const baselineContent: CrossSectionalMomentumStrategyV1 = {
  contract_version: 'cross_sectional_momentum_v1',
  strategy_kind: 'cross_sectional_momentum',
  universe: 'csi300_point_in_time',
  frequency: 'daily',
  signal_price: 'close',
  signal_adjustment: 'backward',
  lookback_trading_days: 60,
  select_top_n: 20,
  rebalance_every_trading_days: 20,
  weighting: 'equal_weight',
  long_only: true,
  decision_timing: 'after_close',
  earliest_execution: 'next_open',
  output_contract: 'target_weights_v1',
}

const strategies: Strategy[] = [{
  id: strategyId,
  slug: 'csi300-cross-sectional-momentum',
  name: '沪深 300 横截面动量',
  description: '首个规则基线，仅输出目标权重。',
  ownerKey: 'frontend-dev-researcher',
  versionCount: 1,
  latestVersionId: frozenVersionId,
  latestVersionNo: 1,
  latestVersionStatus: 'frozen',
  createdAt: '2026-08-13T00:00:00+08:00',
  updatedAt: '2026-08-13T01:00:00+08:00',
}]

const versions: StrategyVersion[] = [{
  id: frozenVersionId,
  strategyId,
  version: 1,
  parentVersionId: null,
  status: 'frozen',
  contractName: 'cross_sectional_momentum_v1',
  content: baselineContent,
  contentSha256: 'a'.repeat(64),
  eligibleForNewExperiment: true,
  note: '首个规则基线',
  createdByKey: 'frontend-dev-researcher',
  createdAt: '2026-08-13T00:00:00+08:00',
  frozenByKey: 'frontend-dev-researcher',
  frozenAt: '2026-08-13T01:00:00+08:00',
  freezeReason: '基线评审通过',
  deprecatedByKey: null,
  deprecatedAt: null,
  deprecateReason: null,
}]

function notFound(message: string): never {
  throw new ApiError({ code: 'STRATEGY_NOT_FOUND', message, requestId: generateRequestId() })
}

export function listStrategies(_query: StrategyListQuery = {}): Promise<StrategyPage> {
  return mockRequest(() => ({
    items: strategies.map((item) => ({ ...item })),
    page: { hasMore: false, nextCursor: null },
  }), { latencyMs: 0 })
}

export function getStrategy(id: string): Promise<Strategy> {
  return mockRequest(() => {
    const item = strategies.find((value) => value.id === id)
    return item ? { ...item } : notFound(`策略不存在：${id}`)
  }, { latencyMs: 0 })
}

export function listStrategyVersions(
  ownerId: string,
  query: StrategyVersionListQuery = {},
): Promise<StrategyVersionPage> {
  return mockRequest(() => ({
    items: versions
      .filter((item) => item.strategyId === ownerId && (!query.status || item.status === query.status))
      .sort((a, b) => b.version - a.version)
      .map((item) => ({ ...item, content: { ...item.content } })),
    page: { hasMore: false, nextCursor: null },
  }), { latencyMs: 0 })
}

export function getStrategyVersion(id: string): Promise<StrategyVersion> {
  return mockRequest(() => {
    const item = versions.find((value) => value.id === id)
    if (!item) notFound(`策略版本不存在：${id}`)
    return { ...item, content: { ...item.content } }
  }, { latencyMs: 0 })
}

export function createStrategy(
  input: CreateStrategyInput,
  options: MutationOptions,
): Promise<StrategyMutation> {
  return mockRequest(() => replayMockMutation('strategy:create', input, options, () => {
    const now = new Date().toISOString()
    const item: Strategy = {
      id: crypto.randomUUID(),
      ...input,
      ownerKey: 'frontend-dev-researcher',
      versionCount: 0,
      latestVersionId: null,
      latestVersionNo: null,
      latestVersionStatus: null,
      createdAt: now,
      updatedAt: now,
    }
    strategies.push(item)
    return { item: { ...item }, auditEventId: mockAuditId() }
  }), { latencyMs: 0 })
}

export function createStrategyVersion(
  ownerId: string,
  input: CreateStrategyVersionInput,
  options: MutationOptions,
): Promise<StrategyVersionMutation> {
  return mockRequest(() => replayMockMutation(`strategy:${ownerId}:version:create`, input, options, () => {
    const owner = strategies.find((value) => value.id === ownerId)
    if (!owner) notFound(`策略不存在：${ownerId}`)
    const parent = input.parentVersionId
      ? versions.find((value) => value.id === input.parentVersionId && value.strategyId === ownerId)
      : null
    if (input.parentVersionId && parent?.status !== 'frozen') {
      throw new ApiError({ code: 'STRATEGY_PARENT_NOT_FROZEN', message: '父版本必须已冻结', requestId: generateRequestId() })
    }
    const now = new Date().toISOString()
    const item: StrategyVersion = {
      id: crypto.randomUUID(),
      strategyId: ownerId,
      version: owner.versionCount + 1,
      parentVersionId: input.parentVersionId,
      status: 'draft',
      contractName: 'cross_sectional_momentum_v1',
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
): Promise<StrategyVersionMutation> {
  return mockRequest(() => replayMockMutation(`strategy-version:${id}:${action}`, { reason }, options, () => {
    const item = versions.find((value) => value.id === id)
    if (!item) notFound(`策略版本不存在：${id}`)
    const expected = action === 'freeze' ? 'draft' : 'frozen'
    if (item.status !== expected) {
      throw new ApiError({ code: 'STRATEGY_VERSION_STATE_CONFLICT', message: '版本状态不允许该操作', requestId: generateRequestId() })
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

export function freezeStrategyVersion(id: string, reason: string, options: MutationOptions) {
  return transition(id, 'freeze', reason, options)
}

export function deprecateStrategyVersion(id: string, reason: string, options: MutationOptions) {
  return transition(id, 'deprecate', reason, options)
}

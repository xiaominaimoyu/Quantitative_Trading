import { isRealApiMode } from '../config.ts'
import * as B5Real from '../b5/real.ts'
import * as mock from './mock.ts'
import * as real from './real.ts'
import type {
  CreateRiskRuleSetInput,
  CreateRiskRuleVersionInput,
  MutationOptions,
  RiskRuleSetListQuery,
  RiskRuleVersionListQuery,
} from './types.ts'

export type * from './types.ts'
export type { RiskEvent, RiskEventReason, PagedRiskEvent } from '../b5/types.ts'
export { RESEARCH_VERSION_STATUS_LABEL } from '../research/types.ts'

export const readsAreReal = isRealApiMode

export function listRiskRuleSets(query?: RiskRuleSetListQuery) {
  return isRealApiMode ? real.listRiskRuleSets(query) : mock.listRiskRuleSets(query)
}

export function getRiskRuleSet(id: string) {
  return isRealApiMode ? real.getRiskRuleSet(id) : mock.getRiskRuleSet(id)
}

export function listRiskRuleVersions(id: string, query?: RiskRuleVersionListQuery) {
  return isRealApiMode
    ? real.listRiskRuleVersions(id, query)
    : mock.listRiskRuleVersions(id, query)
}

export function getRiskRuleVersion(id: string) {
  return isRealApiMode ? real.getRiskRuleVersion(id) : mock.getRiskRuleVersion(id)
}

export function createRiskRuleSet(input: CreateRiskRuleSetInput, options: MutationOptions) {
  return isRealApiMode
    ? real.createRiskRuleSet(input, options)
    : mock.createRiskRuleSet(input, options)
}

export function createRiskRuleVersion(
  id: string,
  input: CreateRiskRuleVersionInput,
  options: MutationOptions,
) {
  return isRealApiMode
    ? real.createRiskRuleVersion(id, input, options)
    : mock.createRiskRuleVersion(id, input, options)
}

export function freezeRiskRuleVersion(id: string, reason: string, options: MutationOptions) {
  return isRealApiMode
    ? real.freezeRiskRuleVersion(id, reason, options)
    : mock.freezeRiskRuleVersion(id, reason, options)
}

export function deprecateRiskRuleVersion(id: string, reason: string, options: MutationOptions) {
  return isRealApiMode
    ? real.deprecateRiskRuleVersion(id, reason, options)
    : mock.deprecateRiskRuleVersion(id, reason, options)
}

/**
 * 风险事件查询 facade：real 模式调用 B5 `/risk-events`，mock 模式返回空集。
 * 风险事件属于 B5 运行时产物，mock 模式无对应样本。
 */
export function listRiskEvents(
  query: { reasonCode?: string; runId?: string; experimentId?: string; page?: number; pageSize?: number } = {},
) {
  if (isRealApiMode) return B5Real.listRiskEvents(query)
  return Promise.resolve({
    items: [],
    page: { hasMore: false, nextCursor: null },
  })
}

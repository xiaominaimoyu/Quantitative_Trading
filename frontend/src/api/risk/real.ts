import { apiRequest } from '../http.ts'
import { researchQueryString, mutationInit } from '../research/http.ts'
import { mapMutation, mapResearchPage } from '../research/mapper.ts'
import type { MutationWire, PagedWire } from '../research/types.ts'
import { mapRiskRuleSet, mapRiskRuleVersion } from './mapper.ts'
import type {
  CreateRiskRuleSetInput,
  CreateRiskRuleVersionInput,
  MutationOptions,
  RiskRuleSet,
  RiskRuleSetListQuery,
  RiskRuleSetMutation,
  RiskRuleSetPage,
  RiskRuleSetWire,
  RiskRuleVersion,
  RiskRuleVersionListQuery,
  RiskRuleVersionMutation,
  RiskRuleVersionPage,
  RiskRuleVersionWire,
} from './types.ts'

export async function listRiskRuleSets(
  query: RiskRuleSetListQuery = {},
): Promise<RiskRuleSetPage> {
  const response = await apiRequest<PagedWire<RiskRuleSetWire>>(
    `/risk-rule-sets${researchQueryString({
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      name: query.name,
      owner_key: query.ownerKey,
    })}`,
  )
  return mapResearchPage(response, mapRiskRuleSet)
}

export async function getRiskRuleSet(id: string): Promise<RiskRuleSet> {
  return mapRiskRuleSet(
    await apiRequest<RiskRuleSetWire>(`/risk-rule-sets/${encodeURIComponent(id)}`),
  )
}

export async function listRiskRuleVersions(
  ruleSetId: string,
  query: RiskRuleVersionListQuery = {},
): Promise<RiskRuleVersionPage> {
  const response = await apiRequest<PagedWire<RiskRuleVersionWire>>(
    `/risk-rule-sets/${encodeURIComponent(ruleSetId)}/versions${researchQueryString({
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      status: query.status,
    })}`,
  )
  return mapResearchPage(response, mapRiskRuleVersion)
}

export async function getRiskRuleVersion(id: string): Promise<RiskRuleVersion> {
  return mapRiskRuleVersion(
    await apiRequest<RiskRuleVersionWire>(`/risk-rule-versions/${encodeURIComponent(id)}`),
  )
}

export async function createRiskRuleSet(
  input: CreateRiskRuleSetInput,
  options: MutationOptions,
): Promise<RiskRuleSetMutation> {
  const response = await apiRequest<MutationWire<RiskRuleSetWire>>(
    '/risk-rule-sets',
    mutationInit({ slug: input.slug, name: input.name, description: input.description }, options.idempotencyKey),
  )
  return mapMutation(response, mapRiskRuleSet)
}

export async function createRiskRuleVersion(
  ruleSetId: string,
  input: CreateRiskRuleVersionInput,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  const response = await apiRequest<MutationWire<RiskRuleVersionWire>>(
    `/risk-rule-sets/${encodeURIComponent(ruleSetId)}/versions`,
    mutationInit({
      content: input.content,
      parent_version_id: input.parentVersionId,
      note: input.note,
    }, options.idempotencyKey),
  )
  return mapMutation(response, mapRiskRuleVersion)
}

async function transitionRiskRuleVersion(
  id: string,
  action: 'freeze' | 'deprecate',
  reason: string,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  const response = await apiRequest<MutationWire<RiskRuleVersionWire>>(
    `/risk-rule-versions/${encodeURIComponent(id)}/${action}`,
    mutationInit({ reason }, options.idempotencyKey),
  )
  return mapMutation(response, mapRiskRuleVersion)
}

export function freezeRiskRuleVersion(
  id: string,
  reason: string,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  return transitionRiskRuleVersion(id, 'freeze', reason, options)
}

export function deprecateRiskRuleVersion(
  id: string,
  reason: string,
  options: MutationOptions,
): Promise<RiskRuleVersionMutation> {
  return transitionRiskRuleVersion(id, 'deprecate', reason, options)
}

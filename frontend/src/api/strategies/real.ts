import { apiRequest } from '../http.ts'
import { researchQueryString, mutationInit } from '../research/http.ts'
import { mapMutation, mapResearchPage } from '../research/mapper.ts'
import type { MutationWire, PagedWire } from '../research/types.ts'
import { mapStrategy, mapStrategyVersion } from './mapper.ts'
import type {
  CreateStrategyInput,
  CreateStrategyVersionInput,
  MutationOptions,
  Strategy,
  StrategyListQuery,
  StrategyMutation,
  StrategyPage,
  StrategyVersion,
  StrategyVersionListQuery,
  StrategyVersionMutation,
  StrategyVersionPage,
  StrategyVersionWire,
  StrategyWire,
} from './types.ts'

export async function listStrategies(
  query: StrategyListQuery = {},
): Promise<StrategyPage> {
  const response = await apiRequest<PagedWire<StrategyWire>>(
    `/strategies${researchQueryString({
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      name: query.name,
      owner_key: query.ownerKey,
    })}`,
  )
  return mapResearchPage(response, mapStrategy)
}

export async function getStrategy(id: string): Promise<Strategy> {
  return mapStrategy(await apiRequest<StrategyWire>(`/strategies/${encodeURIComponent(id)}`))
}

export async function listStrategyVersions(
  strategyId: string,
  query: StrategyVersionListQuery = {},
): Promise<StrategyVersionPage> {
  const response = await apiRequest<PagedWire<StrategyVersionWire>>(
    `/strategies/${encodeURIComponent(strategyId)}/versions${researchQueryString({
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      status: query.status,
    })}`,
  )
  return mapResearchPage(response, mapStrategyVersion)
}

export async function getStrategyVersion(id: string): Promise<StrategyVersion> {
  return mapStrategyVersion(
    await apiRequest<StrategyVersionWire>(`/strategy-versions/${encodeURIComponent(id)}`),
  )
}

export async function createStrategy(
  input: CreateStrategyInput,
  options: MutationOptions,
): Promise<StrategyMutation> {
  const response = await apiRequest<MutationWire<StrategyWire>>(
    '/strategies',
    mutationInit({ slug: input.slug, name: input.name, description: input.description }, options.idempotencyKey),
  )
  return mapMutation(response, mapStrategy)
}

export async function createStrategyVersion(
  strategyId: string,
  input: CreateStrategyVersionInput,
  options: MutationOptions,
): Promise<StrategyVersionMutation> {
  const response = await apiRequest<MutationWire<StrategyVersionWire>>(
    `/strategies/${encodeURIComponent(strategyId)}/versions`,
    mutationInit({
      content: input.content,
      parent_version_id: input.parentVersionId,
      note: input.note,
    }, options.idempotencyKey),
  )
  return mapMutation(response, mapStrategyVersion)
}

async function transitionStrategyVersion(
  id: string,
  action: 'freeze' | 'deprecate',
  reason: string,
  options: MutationOptions,
): Promise<StrategyVersionMutation> {
  const response = await apiRequest<MutationWire<StrategyVersionWire>>(
    `/strategy-versions/${encodeURIComponent(id)}/${action}`,
    mutationInit({ reason }, options.idempotencyKey),
  )
  return mapMutation(response, mapStrategyVersion)
}

export function freezeStrategyVersion(
  id: string,
  reason: string,
  options: MutationOptions,
): Promise<StrategyVersionMutation> {
  return transitionStrategyVersion(id, 'freeze', reason, options)
}

export function deprecateStrategyVersion(
  id: string,
  reason: string,
  options: MutationOptions,
): Promise<StrategyVersionMutation> {
  return transitionStrategyVersion(id, 'deprecate', reason, options)
}

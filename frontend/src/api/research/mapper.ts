import { ApiError, generateRequestId } from '../client.ts'
import type {
  MutationResult,
  MutationWire,
  PageInfo,
  PagedResult,
  PagedWire,
  ResearchContainer,
  ResearchContainerWire,
  ResearchVersion,
  ResearchVersionWire,
} from './types.ts'

export function mapResearchContainer(value: ResearchContainerWire): ResearchContainer {
  return {
    id: value.id,
    slug: value.slug,
    name: value.name,
    description: value.description,
    ownerKey: value.owner_key,
    versionCount: value.version_count,
    latestVersionId: value.latest_version_id,
    latestVersionNo: value.latest_version_no,
    latestVersionStatus: value.latest_version_status,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  }
}

export function mapResearchVersion<TContent>(
  value: ResearchVersionWire<TContent>,
): ResearchVersion<TContent> {
  return {
    id: value.id,
    version: value.version_no,
    parentVersionId: value.parent_version_id,
    status: value.status,
    contractName: value.contract_name,
    content: value.content,
    contentSha256: value.content_sha256,
    eligibleForNewExperiment: value.eligible_for_new_experiment,
    note: value.note,
    createdByKey: value.created_by_key,
    createdAt: value.created_at,
    frozenByKey: value.frozen_by_key,
    frozenAt: value.frozen_at,
    freezeReason: value.freeze_reason,
    deprecatedByKey: value.deprecated_by_key,
    deprecatedAt: value.deprecated_at,
    deprecateReason: value.deprecate_reason,
  }
}

export function mapPageInfo(value: { has_more: boolean; next_cursor: string | number | null }): PageInfo {
  return {
    hasMore: value.has_more,
    nextCursor: value.next_cursor,
  }
}

export function mapResearchPage<TWire, TDomain>(
  value: PagedWire<TWire>,
  mapper: (item: TWire) => TDomain,
): PagedResult<TDomain> {
  return {
    items: value.items.map(mapper),
    page: mapPageInfo(value.page),
  }
}

export function mapMutation<TWire, TDomain>(
  value: MutationWire<TWire>,
  mapper: (item: TWire) => TDomain,
): MutationResult<TDomain> {
  if (!value?.item || typeof value.audit_event_id !== 'string') {
    throw new ApiError({
      code: 'INVALID_API_RESPONSE',
      message: '后端未返回研究对象或审计编号',
      requestId: generateRequestId(),
    })
  }
  return {
    item: mapper(value.item),
    auditEventId: value.audit_event_id,
  }
}

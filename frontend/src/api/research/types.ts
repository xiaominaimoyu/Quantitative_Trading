export type ResearchVersionStatus = 'draft' | 'frozen' | 'deprecated'

export const RESEARCH_VERSION_STATUS_LABEL: Record<ResearchVersionStatus, string> = {
  draft: '草稿',
  frozen: '已冻结',
  deprecated: '已废弃',
}

export interface PageInfo {
  hasMore: boolean
  nextCursor: string | number | null
}

export interface PagedResult<T> {
  items: T[]
  page: PageInfo
}

export interface ResearchContainer {
  id: string
  slug: string
  name: string
  description: string | null
  ownerKey: string
  versionCount: number
  latestVersionId: string | null
  latestVersionNo: number | null
  latestVersionStatus: ResearchVersionStatus | null
  createdAt: string
  updatedAt: string
}

export interface ResearchVersion<TContent> {
  id: string
  version: number
  parentVersionId: string | null
  status: ResearchVersionStatus
  contractName: string
  content: TContent
  contentSha256: string
  eligibleForNewExperiment: boolean
  note: string | null
  createdByKey: string
  createdAt: string
  frozenByKey: string | null
  frozenAt: string | null
  freezeReason: string | null
  deprecatedByKey: string | null
  deprecatedAt: string | null
  deprecateReason: string | null
}

export interface CreateResearchContainerInput {
  slug: string
  name: string
  description: string | null
}

export interface ResearchListQuery {
  page?: number
  pageSize?: number
  name?: string
  ownerKey?: string
}

export interface ResearchVersionListQuery {
  page?: number
  pageSize?: number
  status?: ResearchVersionStatus
}

export interface MutationOptions {
  idempotencyKey: string
}

export interface MutationResult<T> {
  item: T
  auditEventId: string
}

export interface PageInfoWire {
  has_more: boolean
  next_cursor: string | number | null
}

export interface ResearchContainerWire {
  id: string
  slug: string
  name: string
  description: string | null
  owner_key: string
  version_count: number
  latest_version_id: string | null
  latest_version_no: number | null
  latest_version_status: ResearchVersionStatus | null
  created_at: string
  updated_at: string
}

export interface ResearchVersionWire<TContent> {
  id: string
  version_no: number
  parent_version_id: string | null
  status: ResearchVersionStatus
  contract_name: string
  content: TContent
  content_sha256: string
  eligible_for_new_experiment: boolean
  note: string | null
  created_by_key: string
  created_at: string
  frozen_by_key: string | null
  frozen_at: string | null
  freeze_reason: string | null
  deprecated_by_key: string | null
  deprecated_at: string | null
  deprecate_reason: string | null
}

export interface PagedWire<T> {
  items: T[]
  page: PageInfoWire
}

export interface MutationWire<T> {
  item: T
  audit_event_id: string
}

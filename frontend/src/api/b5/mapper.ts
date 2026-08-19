/** B5 mapping helpers (validation / report / risk events / audit). */
import type { PageInfo } from '../research/types.ts'
import type {
  Report,
  ReportBlock,
  ReportContent,
  ReportStatus,
  RiskEvent,
  RiskEventReason,
  ValidationProtocol,
  ValidationRun,
  ValidationRunMetrics,
  ValidationRunStatus,
} from './types.ts'

export function mapValidationProtocol(value: ValidationProtocol): ValidationProtocol {
  return {
    contractVersion: value.contractVersion,
    walkForwardWindows: value.walkForwardWindows,
    seeds: value.seeds,
    holdoutAccessBlocked: value.holdoutAccessBlocked ?? true,
    stressScenarios: value.stressScenarios ?? [],
    promotionRule: value.promotionRule ?? 'none',
    baselineMetricName: value.baselineMetricName ?? 'total_return',
  }
}

export function mapValidationRunMetrics(value: ValidationRunMetrics | null | undefined): ValidationRunMetrics {
  if (!value) return {} as ValidationRunMetrics
  return value
}

export function mapValidationRun(
  value: Record<string, unknown> | null,
): ValidationRun {
  if (!value) {
    throw new Error('validation run payload is empty')
  }
  const v = value as Record<string, unknown> & {
    id: string
    experiment_id: string
    task_id: string | null
    protocol_sha256: string
    window_index: number
    seed: number
    scenario_name: string
    status: ValidationRunStatus
    result_completeness: 'none' | 'partial' | 'complete'
    metrics: ValidationRunMetrics | null
    business_result_sha256: string | null
    error_code: string | null
    error_message: string | null
    created_at: string
    started_at: string | null
    completed_at: string | null
  }
  return {
    id: v.id,
    experimentId: v.experiment_id,
    taskId: v.task_id,
    protocolSha256: v.protocol_sha256,
    windowIndex: v.window_index,
    seed: v.seed,
    scenarioName: v.scenario_name,
    status: v.status,
    resultCompleteness: v.result_completeness,
    metrics: mapValidationRunMetrics(v.metrics),
    businessResultSha256: v.business_result_sha256,
    errorCode: v.error_code,
    errorMessage: v.error_message,
    createdAt: v.created_at,
    startedAt: v.started_at,
    completedAt: v.completed_at,
  }
}

export function mapReportBlock(value: Record<string, unknown>): ReportBlock {
  const partition = value.partition as ReportBlock['partition']
  return {
    partition,
    bodyMd: (value.body_md as string) ?? '',
    modelVersionSha256: (value.model_version_sha256 as string) ?? '',
    sources: Array.isArray(value.sources)
      ? (value.sources as Record<string, unknown>[]).map((item) => ({
          label: (item.label as string) ?? '',
          uri: (item.uri as string) ?? '',
          sha256: (item.sha256 as string) ?? '',
        }))
      : [],
  }
}

export function mapReport(value: Record<string, unknown>): Report {
  const v = value as Record<string, unknown> & {
    id: string
    owner_key: string
    experiment_id: string
    title: string
    contract_version: string
    content_sha256: string
    status: ReportStatus
    submitted_at: string | null
    approved_by_key: string | null
    approved_at: string | null
    deprecated_by_key: string | null
    deprecated_at: string | null
    created_at: string
    updated_at: string
  }
  return {
    id: v.id,
    ownerKey: v.owner_key,
    experimentId: v.experiment_id,
    title: v.title,
    contractVersion: v.contract_version,
    contentSha256: v.content_sha256,
    status: v.status,
    submittedAt: v.submitted_at,
    approvedByKey: v.approved_by_key,
    approvedAt: v.approved_at,
    deprecatedByKey: v.deprecated_by_key,
    deprecatedAt: v.deprecated_at,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }
}

export function mapReportContent(content: Record<string, unknown>): ReportContent {
  const v = content as Record<string, unknown> & {
    contract_version: 'report_content_v1'
    title: string
    data_cutoff: string
    applicable_universe: string[]
    prediction_horizon_days: number
    blocks: Record<string, unknown>[]
  }
  return {
    contractVersion: v.contract_version,
    title: v.title,
    dataCutoff: v.data_cutoff,
    applicableUniverse: v.applicable_universe,
    predictionHorizonDays: v.prediction_horizon_days,
    blocks: v.blocks.map((block) => mapReportBlock(block)),
  }
}

export function mapRiskEvent(value: Record<string, unknown>): RiskEvent {
  const v = value as Record<string, unknown> & {
    id: string
    reason_code: RiskEventReason
    trade_date: string
    symbol: string
    risk_rule_sha256: string
    run_id: string | null
    experiment_id: string | null
    detail: string
    observed_by_key: string
    created_at: string
  }
  return {
    id: v.id,
    reasonCode: v.reason_code,
    tradeDate: v.trade_date,
    symbol: v.symbol,
    riskRuleSha256: v.risk_rule_sha256,
    runId: v.run_id,
    experimentId: v.experiment_id,
    detail: v.detail,
    observedByKey: v.observed_by_key,
    createdAt: v.created_at,
  }
}

export function mapRiskEventReason(reason: string): RiskEventReason {
  if (reason === 'RISK_REJECTED') return 'RISK_REJECTED'
  if (reason === 'RISK_SCALE_DOWN') return 'RISK_SCALE_DOWN'
  if (reason === 'RISK_VOLATILITY_BREACH') return 'RISK_VOLATILITY_BREACH'
  if (reason === 'RISK_DRAWDOWN_BREACH') return 'RISK_DRAWDOWN_BREACH'
  if (reason === 'RISK_TURNOVER_BREACH') return 'RISK_TURNOVER_BREACH'
  return 'RISK_DATA_STALE'
}

export function mapB5PageInfo(value: { has_more: boolean; next_cursor: string | number | null }): PageInfo {
  return {
    hasMore: value.has_more,
    nextCursor: value.next_cursor,
  }
}

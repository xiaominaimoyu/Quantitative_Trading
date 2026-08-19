/** B5 reports, validation runs, risk events and audit log real API. */
import { apiRequest } from '../http.ts'
import { researchQueryString, mutationInit } from '../research/http.ts'
import { mapB5PageInfo, mapReport, mapReportContent, mapRiskEvent } from './mapper.ts'
import type {
  AuditListQuery,
  PagedAuditEvent,
  PagedRiskEvent,
  PagedValidationRun,
  Report,
  ReportActionResult,
  ReportContent,
  ReportCreateResult,
  ReportDetail,
  ReportExportFormat,
  ReportExportResult,
  ReportRunLink,
  RiskCoverage,
  RiskEvent,
  RiskEventCreateInput,
  ValidationProtocol,
  ValidationRun,
  ValidationRunCreateResult,
} from './types.ts'

interface PagedEnvelope<T> {
  items: T[]
  page: { has_more: boolean; next_cursor: string | number | null }
}

interface MutationEnvelope<T> {
  item: T
  audit_event_id: string
}

export async function listReports(
  experimentId?: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: Report[]; page: { hasMore: boolean; nextCursor: string | number | null } }> {
  const query = researchQueryString({ page, page_size: pageSize, experiment_id: experimentId ?? '' })
  const response = await apiRequest<PagedEnvelope<Record<string, unknown>>>(
    `/reports${query}`,
  )
  return {
    items: response.items.map((value) => mapReport(value)),
    page: mapB5PageInfo(response.page),
  }
}

export async function getReport(id: string): Promise<ReportDetail> {
  const response = await apiRequest<{
    report: Record<string, unknown>
    content: Record<string, unknown>
    content_sha256: string
    experiment_id: string
  }>(
    `/reports/${encodeURIComponent(id)}/content`,
  )
  return {
    report: mapReport(response.report),
    content: mapReportContent(response.content),
    contentSha256: response.content_sha256,
    experimentId: response.experiment_id,
  }
}

export async function listReportRuns(id: string): Promise<ReportRunLink[]> {
  const response = await apiRequest<Array<Record<string, unknown>>>(
    `/reports/${encodeURIComponent(id)}/runs`,
  )
  return response.map((value) => ({
    reportId: (value.report_id as string) ?? id,
    runId: (value.run_id as string) ?? '',
    role: (value.role as string) ?? 'primary',
    createdAt: (value.created_at as string) ?? '',
  }))
}

export async function createReport(
  experimentId: string,
  title: string,
  content: ReportContent,
  runIds: string[] = [],
  idempotencyKey: string,
): Promise<ReportCreateResult> {
  const response = await apiRequest<MutationEnvelope<Record<string, unknown>>>(
    `/experiments/${encodeURIComponent(experimentId)}/reports`,
    mutationInit(
      {
        title,
        content: {
          contractVersion: content.contractVersion,
          title: content.title,
          dataCutoff: content.dataCutoff,
          applicableUniverse: content.applicableUniverse,
          predictionHorizonDays: content.predictionHorizonDays,
          blocks: content.blocks.map((block) => ({
            partition: block.partition,
            body_md: block.bodyMd,
            model_version_sha256: block.modelVersionSha256,
            sources: block.sources,
          })),
        },
        run_ids: runIds,
      },
      idempotencyKey,
    ),
  )
  return {
    report: mapReport(response.item),
    auditEventId: response.audit_event_id,
  }
}

export async function reportAction(
  reportId: string,
  action: 'submit' | 'approve' | 'deprecate',
  reason: string,
  idempotencyKey: string,
): Promise<ReportActionResult> {
  const response = await apiRequest<MutationEnvelope<Record<string, unknown>>>(
    `/reports/${encodeURIComponent(reportId)}/${action}`,
    mutationInit({ reason }, idempotencyKey),
  )
  return {
    report: mapReport(response.item),
    auditEventId: response.audit_event_id,
  }
}

export async function exportReport(
  reportId: string,
  request: ReportExportFormat,
  idempotencyKey: string,
): Promise<ReportExportResult> {
  const response = await apiRequest<{
    report_id: string
    format: string
    sha256: string
    size_bytes: number
    artifact_id: string
    audit_event_id: string
  }>(
    `/reports/${encodeURIComponent(reportId)}/export`,
    mutationInit(request, idempotencyKey),
  )
  return {
    reportId: response.report_id,
    format: response.format as ReportExportFormat['format'],
    sha256: response.sha256,
    sizeBytes: response.size_bytes,
    artifactId: response.artifact_id,
    auditEventId: response.audit_event_id,
  }
}

export async function listValidationRuns(
  experimentId: string,
  page = 1,
  pageSize = 20,
): Promise<PagedValidationRun> {
  const response = await apiRequest<PagedEnvelope<Record<string, unknown>>>(
    `/experiments/${encodeURIComponent(experimentId)}/validation-runs${researchQueryString({
      page,
      page_size: pageSize,
    })}`,
  )
  return {
    items: response.items.map((value) => ({
      id: value.id as string,
      experimentId: value.experiment_id as string,
      taskId: (value.task_id as string | null) ?? null,
      protocolSha256: value.protocol_sha256 as string,
      windowIndex: value.window_index as number,
      seed: value.seed as number,
      scenarioName: value.scenario_name as string,
      status: value.status as ValidationRun['status'],
      resultCompleteness: value.result_completeness as ValidationRun['resultCompleteness'],
      metrics: (value.metrics as Record<string, number | string>) ?? {},
      businessResultSha256: (value.business_result_sha256 as string | null) ?? null,
      errorCode: (value.error_code as string | null) ?? null,
      errorMessage: (value.error_message as string | null) ?? null,
      createdAt: value.created_at as string,
      startedAt: (value.started_at as string | null) ?? null,
      completedAt: (value.completed_at as string | null) ?? null,
    })),
    page: mapB5PageInfo(response.page),
  }
}

export async function getValidationRun(id: string): Promise<ValidationRun> {
  const response = await apiRequest<Record<string, unknown>>(
    `/validation-runs/${encodeURIComponent(id)}`,
  )
  return {
    id: response.id as string,
    experimentId: response.experiment_id as string,
    taskId: (response.task_id as string | null) ?? null,
    protocolSha256: response.protocol_sha256 as string,
    windowIndex: response.window_index as number,
    seed: response.seed as number,
    scenarioName: response.scenario_name as string,
    status: response.status as ValidationRun['status'],
    resultCompleteness: response.result_completeness as ValidationRun['resultCompleteness'],
    metrics: (response.metrics as Record<string, number | string>) ?? {},
    businessResultSha256: (response.business_result_sha256 as string | null) ?? null,
    errorCode: (response.error_code as string | null) ?? null,
    errorMessage: (response.error_message as string | null) ?? null,
    createdAt: response.created_at as string,
    startedAt: (response.started_at as string | null) ?? null,
    completedAt: (response.completed_at as string | null) ?? null,
  }
}

export async function createValidationRuns(
  experimentId: string,
  protocol: ValidationProtocol,
  idempotencyKey: string,
): Promise<ValidationRunCreateResult> {
  const response = await apiRequest<MutationEnvelope<{
    experiment_id: string
    protocol_sha256: string
    created_count: number
    validation_run_ids: string[]
  }>>(
    `/experiments/${encodeURIComponent(experimentId)}/validation-runs`,
    mutationInit({ protocol: protocol as unknown }, idempotencyKey),
  )
  return {
    experimentId: response.item.experiment_id,
    protocolSha256: response.item.protocol_sha256,
    createdCount: response.item.created_count,
    validationRunIds: response.item.validation_run_ids,
  }
}

export async function listRiskEvents(
  query: { reasonCode?: string; runId?: string; experimentId?: string; page?: number; pageSize?: number } = {},
): Promise<PagedRiskEvent> {
  const response = await apiRequest<PagedEnvelope<Record<string, unknown>>>(
    `/risk-events${researchQueryString({
      reason_code: query.reasonCode,
      run_id: query.runId,
      experiment_id: query.experimentId,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
    })}`,
  )
  return {
    items: response.items.map((value) => mapRiskEvent(value)),
    page: mapB5PageInfo(response.page),
  }
}

export async function createRiskEvent(
  payload: RiskEventCreateInput,
  idempotencyKey: string,
): Promise<{ event: RiskEvent; auditEventId: string }> {
  const response = await apiRequest<{ item: Record<string, unknown>; audit_event_id: string }>(
    `/risk-events`,
    mutationInit(
      {
        payload: {
          contract_version: 'risk_event_v1',
          reason_code: payload.reasonCode,
          symbol: payload.symbol,
          trade_date: payload.tradeDate,
          detail: payload.detail,
        },
        run_id: payload.runId,
        experiment_id: payload.experimentId,
      },
      idempotencyKey,
    ),
  )
  return {
    event: mapRiskEvent(response.item),
    auditEventId: response.audit_event_id,
  }
}

export async function riskCoverage(experimentId: string): Promise<RiskCoverage> {
  const response = await apiRequest<{
    experiment_id: string
    risk_rule_sha256: string
    total_events: number
    by_reason_code: Record<string, number>
  }>(
    `/experiments/${encodeURIComponent(experimentId)}/risk-coverage`,
  )
  return {
    experimentId: response.experiment_id,
    riskRuleSha256: response.risk_rule_sha256,
    totalEvents: response.total_events,
    byReasonCode: response.by_reason_code,
  }
}

export async function listAuditEvents(
  query: AuditListQuery = {},
): Promise<PagedAuditEvent> {
  const response = await apiRequest<PagedEnvelope<Record<string, unknown>>>(
    `/audit-events${researchQueryString({
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      actor_key: query.actorKey,
      action: query.action,
      target: query.target,
      since: query.since,
      until: query.until,
    })}`,
  )
  return {
    items: response.items.map((value) => ({
      id: value.id as string,
      actorKey: value.actor_key as string,
      action: value.action as string,
      target: value.target as string,
      businessId: (value.business_id as string) ?? '',
      requestId: (value.request_id as string | null) ?? null,
      reason: (value.reason as string | null) ?? null,
      beforeJson: (value.before_json as Record<string, unknown> | null) ?? null,
      afterJson: (value.after_json as Record<string, unknown> | null) ?? null,
      createdAt: value.created_at as string,
    })),
    page: mapB5PageInfo(response.page),
  }
}

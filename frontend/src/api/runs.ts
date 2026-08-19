/**
 * B4 运行详情 real API 客户端。
 *
 * 后端端点（experiments.py）：
 * - GET  /experiments/{id}/runs    → RunListOut（比较视图）
 * - GET  /runs/{run_id}            → RunOut
 * - GET  /runs/{run_id}/metrics    → MetricSummaryOut[]
 * - GET  /runs/{run_id}/artifacts  → ArtifactOut[]
 * - POST /runs/{run_id}/cancel     → RunMutationOut
 *
 * Real 模式专用；mock 模式继续使用 api/mock/runs.ts。
 */
import { apiRequest } from './http.ts'
import { mutationInit } from './research/http.ts'

export type RunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'cancel_requested'
  | 'success'
  | 'failed'
  | 'canceled'

export type ResultCompleteness = 'none' | 'partial' | 'complete'

export interface RunManifest {
  contractVersion: string
  protocolSha256: string
  backtestBundleManifestSha256: string
  datasetVersionId: string
  datasetVersionSha256: string
  strategyVersionId: string
  strategyVersionSha256: string
  modelVersionId: string
  modelVersionSha256: string
  riskRuleVersionId: string
  riskRuleVersionSha256: string
  engineContract: string
  marketRuleVersion: string
  codeVersion: string
  dependencyLockSha256: string
  seed: number
}

export interface RunDetail {
  id: string
  experimentId: string
  taskId: string
  sourceRunId: string | null
  fingerprint: string
  runManifest: RunManifest
  runManifestSha256: string
  status: RunStatus
  resultCompleteness: ResultCompleteness
  businessResultSha256: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface RunMetric {
  metricName: 'total_return' | 'max_drawdown' | 'turnover' | 'total_fees'
  value: string
  unit: string
  schemaVersion: string
  createdAt: string
}

export interface RunArtifact {
  id: string
  runId: string | null
  artifactType: string
  format: string
  sizeBytes: number
  sha256: string | null
  logicalContentSha256: string | null
  rowCount: number | null
  completeness: 'partial' | 'complete'
  storageKind: 'data' | 'artifact'
  generatedByTaskId: string | null
  createdAt: string
}

export interface RunCancelResult {
  outcome: 'created' | 'duplicate' | 'cancel_requested' | 'canceled'
  run: RunDetail
  auditEventId: string | null
}

/** 实验运行摘要：用于比较视图，字段来自 RunOut 的子集。 */
export interface RunSummary {
  id: string
  experimentId: string
  status: RunStatus
  resultCompleteness: ResultCompleteness
  createdAt: string
  /** 后端 RunOut 未直接提供模型名，取自 run_manifest.model_version_id。 */
  modelName: string | null
}

interface RawRunOut {
  id: string
  experiment_id: string
  task_id: string
  source_run_id: string | null
  fingerprint: string
  run_manifest: Record<string, unknown>
  run_manifest_sha256: string
  status: RunStatus
  result_completeness: ResultCompleteness
  business_result_sha256: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

interface RawMetricOut {
  metric_name: RunMetric['metricName']
  value: string
  unit: string
  schema_version: string
  created_at: string
}

interface RawArtifactOut {
  id: string
  run_id: string | null
  artifact_type: string
  format: string
  size_bytes: number
  sha256: string | null
  logical_content_sha256: string | null
  row_count: number | null
  completeness: 'partial' | 'complete'
  storage_kind: 'data' | 'artifact'
  generated_by_task_id: string | null
  created_at: string
}

interface RawPageInfo {
  next_cursor: number | null
  has_more: boolean
}

interface RawRunListOut {
  items: RawRunOut[]
  page: RawPageInfo
}

function mapRun(raw: RawRunOut): RunDetail {
  const m = raw.run_manifest
  return {
    id: raw.id,
    experimentId: raw.experiment_id,
    taskId: raw.task_id,
    sourceRunId: raw.source_run_id,
    fingerprint: raw.fingerprint,
    runManifest: {
      contractVersion: (m.contract_version as string) ?? 'run_manifest_v1',
      protocolSha256: (m.protocol_sha256 as string) ?? '',
      backtestBundleManifestSha256: (m.backtest_bundle_manifest_sha256 as string) ?? '',
      datasetVersionId: (m.dataset_version_id as string) ?? '',
      datasetVersionSha256: (m.dataset_version_sha256 as string) ?? '',
      strategyVersionId: (m.strategy_version_id as string) ?? '',
      strategyVersionSha256: (m.strategy_version_sha256 as string) ?? '',
      modelVersionId: (m.model_version_id as string) ?? '',
      modelVersionSha256: (m.model_version_sha256 as string) ?? '',
      riskRuleVersionId: (m.risk_rule_version_id as string) ?? '',
      riskRuleVersionSha256: (m.risk_rule_version_sha256 as string) ?? '',
      engineContract: (m.engine_contract as string) ?? '',
      marketRuleVersion: (m.market_rule_version as string) ?? '',
      codeVersion: (m.code_version as string) ?? '',
      dependencyLockSha256: (m.dependency_lock_sha256 as string) ?? '',
      seed: (m.seed as number) ?? 0,
    },
    runManifestSha256: raw.run_manifest_sha256,
    status: raw.status,
    resultCompleteness: raw.result_completeness,
    businessResultSha256: raw.business_result_sha256,
    errorCode: raw.error_code,
    errorMessage: raw.error_message,
    createdAt: raw.created_at,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
  }
}

function mapRunSummary(raw: RawRunOut): RunSummary {
  const manifest = raw.run_manifest as { model_version_id?: string }
  return {
    id: raw.id,
    experimentId: raw.experiment_id,
    status: raw.status,
    resultCompleteness: raw.result_completeness,
    createdAt: raw.created_at,
    modelName: manifest.model_version_id ?? null,
  }
}

export async function getRun(runId: string): Promise<RunDetail> {
  const raw = await apiRequest<RawRunOut>(`/runs/${encodeURIComponent(runId)}`)
  return mapRun(raw)
}

export async function listRunMetrics(runId: string): Promise<RunMetric[]> {
  const raw = await apiRequest<RawMetricOut[]>(
    `/runs/${encodeURIComponent(runId)}/metrics`,
  )
  return raw.map((m) => ({
    metricName: m.metric_name,
    value: m.value,
    unit: m.unit,
    schemaVersion: m.schema_version,
    createdAt: m.created_at,
  }))
}

export async function listRunArtifacts(runId: string): Promise<RunArtifact[]> {
  const raw = await apiRequest<RawArtifactOut[]>(
    `/runs/${encodeURIComponent(runId)}/artifacts`,
  )
  return raw.map((a) => ({
    id: a.id,
    runId: a.run_id,
    artifactType: a.artifact_type,
    format: a.format,
    sizeBytes: a.size_bytes,
    sha256: a.sha256,
    logicalContentSha256: a.logical_content_sha256,
    rowCount: a.row_count,
    completeness: a.completeness,
    storageKind: a.storage_kind,
    generatedByTaskId: a.generated_by_task_id,
    createdAt: a.created_at,
  }))
}

export async function cancelRun(
  runId: string,
  reason: string,
  idempotencyKey: string,
): Promise<RunCancelResult> {
  const raw = await apiRequest<{
    outcome: RunCancelResult['outcome']
    item: RawRunOut
    audit_event_id: string | null
  }>(
    `/runs/${encodeURIComponent(runId)}/cancel`,
    mutationInit({ reason }, idempotencyKey),
  )
  return {
    outcome: raw.outcome,
    run: mapRun(raw.item),
    auditEventId: raw.audit_event_id,
  }
}

/**
 * 列出实验下的运行（B4 GET /experiments/{experiment_id}/runs）。
 *
 * 返回按 createdAt 降序排列的运行摘要——与 mock 一致，确保比较视图默认
 * 不按收益指标排序（反选择性偏差）。
 */
export async function listExperimentRuns(experimentId: string): Promise<RunSummary[]> {
  const raw = await apiRequest<RawRunListOut>(
    `/experiments/${encodeURIComponent(experimentId)}/runs?page_size=100`,
  )
  return raw.items
    .map(mapRunSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

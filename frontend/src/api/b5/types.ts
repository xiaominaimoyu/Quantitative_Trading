/** B5 domain types: validation, report, risk events. */
export type ValidationRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export type ValidationPhase = 'train' | 'validation' | 'holdout'

export interface TimeWindow {
  phase: ValidationPhase
  start_date: string
  end_date: string
}

export interface WalkForwardWindow {
  train: TimeWindow
  validation: TimeWindow
  holdout: TimeWindow
  purge_days: number
  embargo_days: number
}

export interface StressScenario {
  name: string
  cost_multiplier_bp: number
  signal_delay_days: number
  missing_bar_fraction_bp: number
}

export type PromotionRule = 'none' | 'must_outperform_baseline'

export type BaselineMetricName = 'total_return' | 'max_drawdown' | 'turnover' | 'total_fees'

export interface ValidationProtocol {
  contractVersion: 'validation_protocol_v1'
  walkForwardWindows: WalkForwardWindow[]
  seeds: number[]
  holdoutAccessBlocked?: boolean
  stressScenarios?: StressScenario[]
  promotionRule?: PromotionRule
  baselineMetricName?: BaselineMetricName
}

export interface ValidationRunMetrics {
  total_return?: number
  max_drawdown?: number
  turnover?: number
  total_fees?: number
  business_sha256?: string
  [key: string]: number | string | undefined
}

export interface ValidationRun {
  id: string
  experimentId: string
  taskId: string | null
  protocolSha256: string
  windowIndex: number
  seed: number
  scenarioName: string
  status: ValidationRunStatus
  resultCompleteness: 'none' | 'partial' | 'complete'
  metrics: ValidationRunMetrics
  businessResultSha256: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type ValidationRunSummary = ValidationRun

export interface PagedValidationRun {
  items: ValidationRunSummary[]
  page: { hasMore: boolean; nextCursor: string | number | null }
}

export interface ValidationRunCreateResult {
  experimentId: string
  protocolSha256: string
  createdCount: number
  validationRunIds: string[]
}

export interface ValidationRunMutation {
  item: ValidationRunCreateResult
  auditEventId: string
}

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'deprecated'

export type ReportPartition = 'facts' | 'inference' | 'uncertainty' | 'sources' | 'limits'

export interface ReportSourceItem {
  label: string
  uri: string
  sha256: string
}

export interface ReportBlock {
  partition: ReportPartition
  bodyMd: string
  modelVersionSha256: string
  sources: ReportSourceItem[]
}

export interface ReportContent {
  contractVersion: 'report_content_v1'
  title: string
  dataCutoff: string
  applicableUniverse: string[]
  predictionHorizonDays: number
  blocks: ReportBlock[]
}

export interface Report {
  id: string
  ownerKey: string
  experimentId: string
  title: string
  contractVersion: string
  contentSha256: string
  status: ReportStatus
  submittedAt: string | null
  approvedByKey: string | null
  approvedAt: string | null
  deprecatedByKey: string | null
  deprecatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportDetail {
  report: Report
  content: ReportContent
  contentSha256: string
  experimentId: string
}

export interface ReportRunLink {
  reportId: string
  runId: string
  role: string
  createdAt: string
}

export interface ReportExportFormat {
  format: 'json' | 'markdown' | 'html'
  includeLineage: boolean
}

export interface ReportExportResult {
  reportId: string
  format: 'json' | 'markdown' | 'html'
  sha256: string
  sizeBytes: number
  artifactId: string
  auditEventId: string
}

export interface ReportCreateResult {
  report: Report
  auditEventId: string
}

export type ReportActionType = 'submit' | 'approve' | 'deprecate'

export interface ReportActionResult {
  report: Report
  auditEventId: string
}

export type RiskEventReason =
  | 'RISK_REJECTED'
  | 'RISK_SCALE_DOWN'
  | 'RISK_VOLATILITY_BREACH'
  | 'RISK_DRAWDOWN_BREACH'
  | 'RISK_TURNOVER_BREACH'
  | 'RISK_DATA_STALE'

export interface RiskEvent {
  id: string
  reasonCode: RiskEventReason
  tradeDate: string
  symbol: string
  riskRuleSha256: string
  runId: string | null
  experimentId: string | null
  detail: string
  observedByKey: string
  createdAt: string
}

export interface RiskEventCreateInput {
  reasonCode: RiskEventReason
  symbol: string
  tradeDate: string
  detail: string
  runId?: string
  experimentId?: string
}

export interface RiskCoverage {
  experimentId: string
  riskRuleSha256: string
  totalEvents: number
  byReasonCode: Record<string, number>
}

export interface PagedRiskEvent {
  items: RiskEvent[]
  page: { hasMore: boolean; nextCursor: string | number | null }
}

export interface AuditEvent {
  id: string
  actorKey: string
  action: string
  target: string
  businessId: string
  requestId: string | null
  reason: string | null
  beforeJson: Record<string, unknown> | null
  afterJson: Record<string, unknown> | null
  createdAt: string
}

export interface PagedAuditEvent {
  items: AuditEvent[]
  page: { hasMore: boolean; nextCursor: string | number | null }
}

export interface AuditListQuery {
  page?: number
  pageSize?: number
  actorKey?: string
  action?: string
  target?: string
  since?: string
  until?: string
}

export interface MutationOptions {
  idempotencyKey: string
}

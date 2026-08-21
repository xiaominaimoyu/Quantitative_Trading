/** B5 reports facade: real when in real mode, mock fallback otherwise. */
import { API_MODE } from './config.ts'
import * as mock from './mock/reports.ts'
import * as real from './b5/real.ts'
import type {
  Report,
  ReportActionResult,
  ReportContent,
  ReportDetail,
  ReportExportFormat,
  ReportExportResult,
  ReportRunLink,
} from './b5/types.ts'

const useReal = API_MODE === 'real'

export async function listReports(experimentId?: string): Promise<Report[]> {
  if (useReal) return real.listReports(experimentId, 1, 50).then((p) => p.items)
  // mock returns the older ReportSummary shape; map to Report domain shape
  const rows = await mock.listReports()
  const detailed = await Promise.all(rows.map((row) => mock.getReport(row.id)))
  return detailed.map((detail) => ({
    id: detail.id,
    ownerKey: 'mock',
    experimentId: detail.experimentId,
    title: detail.title,
    contractVersion: 'report_content_v1',
    contentSha256: detail.contentHash,
    status: detail.status === 'pending_approval' ? 'submitted' : detail.status === 'archived' ? 'deprecated' : detail.status,
    submittedAt: null,
    approvedByKey: detail.approver ?? null,
    approvedAt: detail.approvedAt ?? null,
    deprecatedByKey: null,
    deprecatedAt: null,
    createdAt: detail.updatedAt,
    updatedAt: detail.updatedAt,
  }))
}

export async function getReport(id: string): Promise<ReportDetail> {
  if (useReal) return real.getReport(id)
  const detail = await mock.getReport(id)
  return {
    report: {
      id: detail.id,
      ownerKey: 'mock',
      experimentId: detail.experimentId,
      title: detail.title,
      contractVersion: 'report_content_v1',
      contentSha256: detail.contentHash,
      status: detail.status === 'pending_approval' ? 'submitted' : detail.status === 'archived' ? 'deprecated' : detail.status,
      submittedAt: null,
      approvedByKey: detail.approver ?? null,
      approvedAt: detail.approvedAt ?? null,
      deprecatedByKey: null,
      deprecatedAt: null,
      createdAt: detail.updatedAt,
      updatedAt: detail.updatedAt,
    },
    content: {
      contractVersion: 'report_content_v1',
      title: detail.title,
      dataCutoff: detail.dataCutoff,
      applicableUniverse: ['mock-universe'],
      predictionHorizonDays: 1,
      blocks: detail.sections.map((s) => ({
        partition: s.type === 'attribution' ? 'facts' : s.type === 'counter' ? 'limits' : s.type === 'risk' ? 'limits' : s.type,
        bodyMd: s.items.map((i) => i.text).join('\n'),
        modelVersionSha256: '0'.repeat(64),
        sources: s.items
          .filter((i) => i.source)
          .map((i) => ({ label: i.source ?? '', uri: i.sourceLink ?? '', sha256: '0'.repeat(64) })),
      })),
    },
    contentSha256: detail.contentHash,
    experimentId: detail.experimentId,
  }
}

export async function listReportRuns(id: string): Promise<ReportRunLink[]> {
  if (useReal) return real.listReportRuns(id)
  return []
}

export async function reportAction(
  reportId: string,
  action: 'submit' | 'approve' | 'deprecate',
  reason: string,
  idempotencyKey: string,
): Promise<ReportActionResult> {
  if (useReal) return real.reportAction(reportId, action, reason, idempotencyKey)
  // mock fallback: only approve supported; map to old shape.
  if (action === 'approve') {
    const result = await mock.approveReport(reportId, 'mock-admin', reason)
    return {
      report: {
        id: result.report.id,
        ownerKey: 'mock',
        experimentId: result.report.experimentId,
        title: result.report.title,
        contractVersion: 'report_content_v1',
        contentSha256: result.report.contentHash,
        status: 'approved',
        submittedAt: null,
        approvedByKey: result.report.approver ?? null,
        approvedAt: result.report.approvedAt ?? null,
        deprecatedByKey: null,
        deprecatedAt: null,
        createdAt: result.report.updatedAt,
        updatedAt: result.report.updatedAt,
      },
      auditEventId: result.auditId,
    }
  }
  return {
    report: {
      id: reportId,
      ownerKey: 'mock',
      experimentId: '',
      title: '',
      contractVersion: 'report_content_v1',
      contentSha256: '',
      status: 'draft',
      submittedAt: null,
      approvedByKey: null,
      approvedAt: null,
      deprecatedByKey: null,
      deprecatedAt: null,
      createdAt: '',
      updatedAt: '',
    },
    auditEventId: 'mock-audit',
  }
}

export async function exportReport(
  reportId: string,
  request: ReportExportFormat,
  idempotencyKey: string,
): Promise<ReportExportResult> {
  if (useReal) return real.exportReport(reportId, request, idempotencyKey)
  return {
    reportId,
    format: request.format,
    sha256: '0'.repeat(64),
    sizeBytes: 0,
    artifactId: 'mock-artifact',
    auditEventId: 'mock-audit',
  }
}

export async function createReport(
  experimentId: string,
  title: string,
  content: ReportContent,
  runIds: string[],
  idempotencyKey: string,
): Promise<{ report: Report; auditEventId: string }> {
  if (useReal) {
    const result = await real.createReport(experimentId, title, content, runIds, idempotencyKey)
    return { report: result.report, auditEventId: result.auditEventId }
  }
  return {
    report: {
      id: 'mock-' + Math.random().toString(36).slice(2),
      ownerKey: 'mock',
      experimentId,
      title,
      contractVersion: 'report_content_v1',
      contentSha256: '0'.repeat(64),
      status: 'draft',
      submittedAt: null,
      approvedByKey: null,
      approvedAt: null,
      deprecatedByKey: null,
      deprecatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    auditEventId: 'mock-audit',
  }
}

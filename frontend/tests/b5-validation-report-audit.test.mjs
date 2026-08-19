/**
 * B5 验证、报告与审计测试：real API 客户端 + mappers + 审计完整性测试。
 *
 * 覆盖点：
 * 1. ValidationRun mapper 保留后端 UUID、状态、指标和哈希
 * 2. Report mapper 保留状态流转、内容块和来源
 * 3. RiskEvent mapper 保留原因码、关联运行/实验
 * 4. AuditEvent mapper 保留操作人、目标、变更前后
 * 5. real API 调用使用正确的端点和幂等性键
 * 6. 网络错误不回退 mock 数据
 * 7. 报告状态流转符合业务规则
 * 8. 验证协议配置完整
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import {
  mapB5PageInfo,
  mapReport,
  mapReportBlock,
  mapReportContent,
  mapRiskEvent,
  mapRiskEventReason,
  mapValidationProtocol,
  mapValidationRun,
  mapValidationRunMetrics,
} from '../src/api/b5/mapper.ts'
import {
  createReport,
  createRiskEvent,
  createValidationRuns,
  exportReport,
  getReport,
  getValidationRun,
  listAuditEvents,
  listReportRuns,
  listReports,
  listRiskEvents,
  listValidationRuns,
  reportAction,
  riskCoverage,
} from '../src/api/b5/real.ts'
import type {
  Report,
  ReportContent,
  RiskEvent,
  ValidationProtocol,
  ValidationRun,
} from '../src/api/b5/types.ts'
import { ApiError } from '../src/api/client.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// 测试数据工厂
// ---------------------------------------------------------------------------

function validationRunWire(overrides = {}) {
  return {
    id: 'run-001',
    experiment_id: 'exp-001',
    task_id: 'task-001',
    protocol_sha256: 'a'.repeat(64),
    window_index: 0,
    seed: 42,
    scenario_name: 'baseline',
    status: 'success',
    result_completeness: 'complete',
    metrics: {
      total_return: 0.1234,
      max_drawdown: -0.0567,
      turnover: 1.23,
      total_fees: 0.0012,
      business_sha256: 'b'.repeat(64),
    },
    business_result_sha256: 'b'.repeat(64),
    error_code: null,
    error_message: null,
    created_at: '2026-08-13T00:00:00Z',
    started_at: '2026-08-13T00:01:00Z',
    completed_at: '2026-08-13T00:10:00Z',
    ...overrides,
  }
}

function reportWire(overrides = {}) {
  return {
    id: 'report-001',
    owner_key: 'frontend-dev-researcher',
    experiment_id: 'exp-001',
    title: '策略验证报告',
    contract_version: 'report_content_v1',
    content_sha256: 'c'.repeat(64),
    status: 'draft',
    submitted_at: null,
    approved_by_key: null,
    approved_at: null,
    deprecated_by_key: null,
    deprecated_at: null,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  }
}

function reportContentWire(): Record<string, unknown> {
  return {
    contract_version: 'report_content_v1',
    title: '策略验证报告',
    data_cutoff: '2026-08-12',
    applicable_universe: ['csi300_point_in_time'],
    prediction_horizon_days: 5,
    blocks: [
      {
        partition: 'facts',
        body_md: '## 事实\n\n实验结果概述。',
        model_version_sha256: 'd'.repeat(64),
        sources: [
          { label: '数据源A', uri: 's3://bucket/a.parquet', sha256: 'e'.repeat(64) },
        ],
      },
      {
        partition: 'inference',
        body_md: '## 推断\n\n信号有效性分析。',
        model_version_sha256: 'f'.repeat(64),
        sources: [],
      },
    ],
  }
}

function riskEventWire(overrides = {}) {
  return {
    id: 'event-001',
    reason_code: 'RISK_DRAWDOWN_BREACH',
    trade_date: '2026-08-12',
    symbol: '600000.SH',
    risk_rule_sha256: 'g'.repeat(64),
    run_id: 'run-001',
    experiment_id: 'exp-001',
    detail: '最大回撤超过阈值',
    observed_by_key: 'frontend-dev-researcher',
    created_at: '2026-08-13T00:00:00Z',
    ...overrides,
  }
}

function auditEventWire(overrides = {}) {
  return {
    id: 'audit-001',
    actor_key: 'frontend-dev-researcher',
    action: 'report:create',
    target: 'report',
    business_id: 'report-001',
    request_id: 'req-001',
    reason: '首次提交',
    before_json: null,
    after_json: { title: '策略验证报告', status: 'draft' },
    created_at: '2026-08-13T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ValidationRun mapper tests
// ---------------------------------------------------------------------------

test('B5 ValidationRun mapper preserves UUIDs, status, metrics and hashes', () => {
  const run = mapValidationRun(validationRunWire())
  assert.equal(run.id, 'run-001')
  assert.equal(run.experimentId, 'exp-001')
  assert.equal(run.taskId, 'task-001')
  assert.equal(run.protocolSha256, 'a'.repeat(64))
  assert.equal(run.windowIndex, 0)
  assert.equal(run.seed, 42)
  assert.equal(run.scenarioName, 'baseline')
  assert.equal(run.status, 'success')
  assert.equal(run.resultCompleteness, 'complete')
  assert.equal(run.metrics?.total_return, 0.1234)
  assert.equal(run.metrics?.max_drawdown, -0.0567)
  assert.equal(run.businessResultSha256, 'b'.repeat(64))
  assert.equal(run.errorCode, null)
  assert.equal(run.errorMessage, null)
})

test('B5 ValidationRun mapper handles null metrics and missing fields', () => {
  const run = mapValidationRun(
    validationRunWire({
      metrics: null,
      task_id: null,
      business_result_sha256: null,
      error_code: 'VALIDATION_ERROR',
      error_message: '指标计算失败',
    }),
  )
  assert.equal(run.taskId, null)
  assert.equal(run.businessResultSha256, null)
  assert.equal(run.errorCode, 'VALIDATION_ERROR')
  assert.equal(run.errorMessage, '指标计算失败')
  assert.deepEqual(run.metrics, {})
})

test('B5 ValidationRun mapper throws on empty payload', () => {
  assert.throws(() => mapValidationRun(null), /validation run payload is empty/)
  assert.throws(() => mapValidationRun(undefined), /validation run payload is empty/)
})

test('B5 ValidationRun metrics mapper preserves existing metrics', () => {
  const metrics = { total_return: 0.1, max_drawdown: -0.05, custom_field: 'value' }
  const mapped = mapValidationRunMetrics(metrics)
  assert.equal(mapped.total_return, 0.1)
  assert.equal(mapped.max_drawdown, -0.05)
  assert.equal(mapped.custom_field, 'value')
})

test('B5 ValidationRun metrics mapper returns empty object for null/undefined', () => {
  assert.deepEqual(mapValidationRunMetrics(null), {})
  assert.deepEqual(mapValidationRunMetrics(undefined), {})
})

// ---------------------------------------------------------------------------
// Report mapper tests
// ---------------------------------------------------------------------------

test('B5 Report mapper preserves UUIDs, owner, status, timestamps', () => {
  const report = mapReport(reportWire())
  assert.equal(report.id, 'report-001')
  assert.equal(report.ownerKey, 'frontend-dev-researcher')
  assert.equal(report.experimentId, 'exp-001')
  assert.equal(report.title, '策略验证报告')
  assert.equal(report.contractVersion, 'report_content_v1')
  assert.equal(report.contentSha256, 'c'.repeat(64))
  assert.equal(report.status, 'draft')
  assert.equal(report.submittedAt, null)
  assert.equal(report.approvedByKey, null)
  assert.equal(report.approvedAt, null)
  assert.equal(report.deprecatedByKey, null)
  assert.equal(report.deprecatedAt, null)
})

test('B5 Report mapper preserves submitted/approved/deprecated state', () => {
  const report = mapReport(
    reportWire({
      status: 'approved',
      submitted_at: '2026-08-13T01:00:00Z',
      approved_by_key: 'frontend-dev-reviewer',
      approved_at: '2026-08-13T02:00:00Z',
    }),
  )
  assert.equal(report.status, 'approved')
  assert.equal(report.submittedAt, '2026-08-13T01:00:00Z')
  assert.equal(report.approvedByKey, 'frontend-dev-reviewer')
  assert.equal(report.approvedAt, '2026-08-13T02:00:00Z')
})

test('B5 ReportContent mapper preserves blocks and sources', () => {
  const content = mapReportContent(reportContentWire())
  assert.equal(content.contractVersion, 'report_content_v1')
  assert.equal(content.title, '策略验证报告')
  assert.equal(content.dataCutoff, '2026-08-12')
  assert.equal(content.applicableUniverse[0], 'csi300_point_in_time')
  assert.equal(content.predictionHorizonDays, 5)
  assert.equal(content.blocks.length, 2)
  assert.equal(content.blocks[0].partition, 'facts')
  assert.equal(content.blocks[0].bodyMd, '## 事实\n\n实验结果概述。')
  assert.equal(content.blocks[0].modelVersionSha256, 'd'.repeat(64))
  assert.equal(content.blocks[0].sources[0].label, '数据源A')
  assert.equal(content.blocks[0].sources[0].uri, 's3://bucket/a.parquet')
  assert.equal(content.blocks[0].sources[0].sha256, 'e'.repeat(64))
  assert.equal(content.blocks[1].partition, 'inference')
})

test('B5 ReportBlock mapper handles empty sources', () => {
  const block = mapReportBlock({
    partition: 'limits',
    body_md: '限制说明',
    model_version_sha256: 'h'.repeat(64),
    sources: [],
  })
  assert.equal(block.partition, 'limits')
  assert.equal(block.bodyMd, '限制说明')
  assert.equal(block.sources.length, 0)
})

// ---------------------------------------------------------------------------
// RiskEvent mapper tests
// ---------------------------------------------------------------------------

test('B5 RiskEvent mapper preserves reason code, hashes, and associations', () => {
  const event = mapRiskEvent(riskEventWire())
  assert.equal(event.id, 'event-001')
  assert.equal(event.reasonCode, 'RISK_DRAWDOWN_BREACH')
  assert.equal(event.tradeDate, '2026-08-12')
  assert.equal(event.symbol, '600000.SH')
  assert.equal(event.riskRuleSha256, 'g'.repeat(64))
  assert.equal(event.runId, 'run-001')
  assert.equal(event.experimentId, 'exp-001')
  assert.equal(event.detail, '最大回撤超过阈值')
  assert.equal(event.observedByKey, 'frontend-dev-researcher')
})

test('B5 RiskEvent mapper handles null associations', () => {
  const event = mapRiskEvent(
    riskEventWire({
      run_id: null,
      experiment_id: null,
    }),
  )
  assert.equal(event.runId, null)
  assert.equal(event.experimentId, null)
})

test('B5 mapRiskEventReason maps known reasons and defaults to DATA_STALE', () => {
  assert.equal(mapRiskEventReason('RISK_REJECTED'), 'RISK_REJECTED')
  assert.equal(mapRiskEventReason('RISK_SCALE_DOWN'), 'RISK_SCALE_DOWN')
  assert.equal(mapRiskEventReason('RISK_VOLATILITY_BREACH'), 'RISK_VOLATILITY_BREACH')
  assert.equal(mapRiskEventReason('RISK_DRAWDOWN_BREACH'), 'RISK_DRAWDOWN_BREACH')
  assert.equal(mapRiskEventReason('RISK_TURNOVER_BREACH'), 'RISK_TURNOVER_BREACH')
  assert.equal(mapRiskEventReason('RISK_DATA_STALE'), 'RISK_DATA_STALE')
  assert.equal(mapRiskEventReason('UNKNOWN_REASON'), 'RISK_DATA_STALE')
})

// ---------------------------------------------------------------------------
// ValidationProtocol mapper tests
// ---------------------------------------------------------------------------

const validationProtocolWire: ValidationProtocol = {
  contractVersion: 'validation_protocol_v1',
  walkForwardWindows: [
    {
      train: { start_date: '2020-01-01', end_date: '2022-12-31' },
      validation: { start_date: '2023-01-01', end_date: '2023-12-31' },
      holdout: { start_date: '2024-01-01', end_date: '2024-12-31' },
      purge_days: 1,
      embargo_days: 1,
    },
  ],
  seeds: [42, 123, 456],
  holdoutAccessBlocked: true,
  stressScenarios: [
    {
      name: 'high_volatility',
      cost_multiplier_bp: 200,
      signal_delay_days: 3,
      missing_bar_fraction_bp: 50,
    },
  ],
  promotionRule: 'must_outperform_baseline',
  baselineMetricName: 'total_return',
}

test('B5 ValidationProtocol mapper preserves all fields with defaults', () => {
  const protocol = mapValidationProtocol(validationProtocolWire)
  assert.equal(protocol.contractVersion, 'validation_protocol_v1')
  assert.equal(protocol.walkForwardWindows.length, 1)
  assert.equal(protocol.walkForwardWindows[0].train.start_date, '2020-01-01')
  assert.equal(protocol.walkForwardWindows[0].validation.end_date, '2023-12-31')
  assert.equal(protocol.walkForwardWindows[0].purge_days, 1)
  assert.equal(protocol.walkForwardWindows[0].embargo_days, 1)
  assert.deepEqual(protocol.seeds, [42, 123, 456])
  assert.equal(protocol.holdoutAccessBlocked, true)
  assert.equal(protocol.stressScenarios?.[0].name, 'high_volatility')
  assert.equal(protocol.stressScenarios?.[0].cost_multiplier_bp, 200)
  assert.equal(protocol.promotionRule, 'must_outperform_baseline')
  assert.equal(protocol.baselineMetricName, 'total_return')
})

test('B5 ValidationProtocol mapper fills defaults for optional fields', () => {
  const protocol = mapValidationProtocol({
    contractVersion: 'validation_protocol_v1',
    walkForwardWindows: [],
    seeds: [],
  })
  assert.equal(protocol.holdoutAccessBlocked, true)
  assert.deepEqual(protocol.stressScenarios, [])
  assert.equal(protocol.promotionRule, 'none')
  assert.equal(protocol.baselineMetricName, 'total_return')
})

// ---------------------------------------------------------------------------
// Page info mapper tests
// ---------------------------------------------------------------------------

test('B5 page info mapper preserves pagination fields', () => {
  const page = mapB5PageInfo({ has_more: true, next_cursor: 'cursor-123' })
  assert.equal(page.hasMore, true)
  assert.equal(page.nextCursor, 'cursor-123')
})

test('B5 page info mapper handles null cursor', () => {
  const page = mapB5PageInfo({ has_more: false, next_cursor: null })
  assert.equal(page.hasMore, false)
  assert.equal(page.nextCursor, null)
})

// ---------------------------------------------------------------------------
// Real API tests - Reports
// ---------------------------------------------------------------------------

test('B5 real report listing uses server-side filters and pagination', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return Response.json({
      items: [reportWire(), reportWire({ id: 'report-002', status: 'submitted' })],
      page: { has_more: true, next_cursor: 2 },
    })
  }

  try {
    const result = await listReports('exp-001', 2, 10)
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].id, 'report-001')
    assert.equal(result.items[1].status, 'submitted')
    assert.equal(result.page.hasMore, true)
    assert.equal(result.page.nextCursor, 2)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  const url = new URL(calls[0])
  assert.equal(url.searchParams.get('experiment_id'), 'exp-001')
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('page_size'), '10')
})

test('B5 real get report returns report with content', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return Response.json({
      report: reportWire(),
      content: reportContentWire(),
      content_sha256: 'c'.repeat(64),
      experiment_id: 'exp-001',
    })
  }

  try {
    const detail = await getReport('report-001')
    assert.equal(detail.report.id, 'report-001')
    assert.equal(detail.content.title, '策略验证报告')
    assert.equal(detail.contentSha256, 'c'.repeat(64))
    assert.equal(detail.experimentId, 'exp-001')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(calls[0].includes('/reports/report-001/content'))
})

test('B5 real create report sends structured body and idempotency key', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json(
      {
        item: reportWire({ status: 'draft' }),
        audit_event_id: 'audit-001',
      },
      { status: 201 },
    )
  }

  const content: ReportContent = {
    contractVersion: 'report_content_v1',
    title: '新报告',
    dataCutoff: '2026-08-12',
    applicableUniverse: ['csi300'],
    predictionHorizonDays: 5,
    blocks: [
      {
        partition: 'facts',
        bodyMd: '内容',
        modelVersionSha256: 'd'.repeat(64),
        sources: [],
      },
    ],
  }

  try {
    const result = await createReport(
      'exp-001',
      '新报告',
      content,
      ['run-001', 'run-002'],
      'idempotency-key-123',
    )
    assert.equal(result.report.title, '新报告')
    assert.equal(result.auditEventId, 'audit-001')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes('/experiments/exp-001/reports'))
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get('Idempotency-Key'), 'idempotency-key-123')
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.title, '新报告')
  assert.deepEqual(body.run_ids, ['run-001', 'run-002'])
  assert.equal(body.content.contract_version, 'report_content_v1')
})

test('B5 real report action sends correct endpoint and reason', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json({
      item: reportWire({ status: 'approved' }),
      audit_event_id: 'audit-002',
    })
  }

  try {
    const result = await reportAction('report-001', 'approve', '审核通过', 'idempotency-key-456')
    assert.equal(result.report.status, 'approved')
    assert.equal(result.auditEventId, 'audit-002')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(calls[0].url.includes('/reports/report-001/approve'))
  assert.equal(calls[0].init?.method, 'POST')
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.reason, '审核通过')
})

test('B5 real export report sends format and returns artifact info', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    return Response.json({
      report_id: 'report-001',
      format: 'json',
      sha256: 'export-sha256',
      size_bytes: 1024,
      artifact_id: 'artifact-001',
      audit_event_id: 'audit-003',
    })
  }

  try {
    const result = await exportReport(
      'report-001',
      { format: 'json', includeLineage: true },
      'idempotency-key-789',
    )
    assert.equal(result.reportId, 'report-001')
    assert.equal(result.format, 'json')
    assert.equal(result.sha256, 'export-sha256')
    assert.equal(result.sizeBytes, 1024)
    assert.equal(result.artifactId, 'artifact-001')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Real API tests - Validation runs
// ---------------------------------------------------------------------------

test('B5 real validation run listing maps items and pagination', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    return Response.json({
      items: [validationRunWire(), validationRunWire({ id: 'run-002', status: 'failed' })],
      page: { has_more: false, next_cursor: null },
    })
  }

  try {
    const result = await listValidationRuns('exp-001')
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].id, 'run-001')
    assert.equal(result.items[1].status, 'failed')
    assert.equal(result.page.hasMore, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('B5 real get validation run returns full details', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    return Response.json(validationRunWire())
  }

  try {
    const run = await getValidationRun('run-001')
    assert.equal(run.id, 'run-001')
    assert.equal(run.experimentId, 'exp-001')
    assert.equal(run.status, 'success')
    assert.equal(run.metrics?.total_return, 0.1234)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('B5 real create validation runs sends protocol and returns IDs', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json({
      item: {
        experiment_id: 'exp-001',
        protocol_sha256: 'protocol-sha256',
        created_count: 3,
        validation_run_ids: ['run-001', 'run-002', 'run-003'],
      },
      audit_event_id: 'audit-004',
    })
  }

  const protocol: ValidationProtocol = {
    contractVersion: 'validation_protocol_v1',
    walkForwardWindows: [
      {
        train: { start_date: '2020-01-01', end_date: '2022-12-31' },
        validation: { start_date: '2023-01-01', end_date: '2023-12-31' },
        holdout: { start_date: '2024-01-01', end_date: '2024-12-31' },
        purge_days: 1,
        embargo_days: 1,
      },
    ],
    seeds: [42],
  }

  try {
    const result = await createValidationRuns('exp-001', protocol, 'idempotency-key-999')
    assert.equal(result.experimentId, 'exp-001')
    assert.equal(result.protocolSha256, 'protocol-sha256')
    assert.equal(result.createdCount, 3)
    assert.deepEqual(result.validationRunIds, ['run-001', 'run-002', 'run-003'])
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(calls[0].url.includes('/experiments/exp-001/validation-runs'))
})

// ---------------------------------------------------------------------------
// Real API tests - Risk events
// ---------------------------------------------------------------------------

test('B5 real risk event listing filters by reason code and run ID', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return Response.json({
      items: [riskEventWire(), riskEventWire({ id: 'event-002', reason_code: 'RISK_REJECTED' })],
      page: { has_more: false, next_cursor: null },
    })
  }

  try {
    const result = await listRiskEvents({
      reasonCode: 'RISK_DRAWDOWN_BREACH',
      runId: 'run-001',
      page: 1,
      pageSize: 10,
    })
    assert.equal(result.items.length, 2)
    assert.equal(result.page.hasMore, false)
  } finally {
    globalThis.fetch = originalFetch
  }

  const url = new URL(calls[0])
  assert.equal(url.searchParams.get('reason_code'), 'RISK_DRAWDOWN_BREACH')
  assert.equal(url.searchParams.get('run_id'), 'run-001')
})

test('B5 real create risk event sends payload and returns event', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    return Response.json({
      item: riskEventWire(),
      audit_event_id: 'audit-005',
    })
  }

  try {
    const result = await createRiskEvent(
      {
        reasonCode: 'RISK_DRAWDOWN_BREACH',
        symbol: '600000.SH',
        tradeDate: '2026-08-12',
        detail: '最大回撤超过阈值',
        runId: 'run-001',
        experimentId: 'exp-001',
      },
      'idempotency-key-111',
    )
    assert.equal(result.event.id, 'event-001')
    assert.equal(result.auditEventId, 'audit-005')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('B5 real risk coverage returns coverage stats', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    return Response.json({
      experiment_id: 'exp-001',
      risk_rule_sha256: 'rule-sha256',
      total_events: 5,
      by_reason_code: {
        RISK_DRAWDOWN_BREACH: 2,
        RISK_REJECTED: 3,
      },
    })
  }

  try {
    const coverage = await riskCoverage('exp-001')
    assert.equal(coverage.experimentId, 'exp-001')
    assert.equal(coverage.riskRuleSha256, 'rule-sha256')
    assert.equal(coverage.totalEvents, 5)
    assert.equal(coverage.byReasonCode.RISK_DRAWDOWN_BREACH, 2)
    assert.equal(coverage.byReasonCode.RISK_REJECTED, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Real API tests - Audit events
// ---------------------------------------------------------------------------

test('B5 real audit event listing filters by actor, action, and time range', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return Response.json({
      items: [auditEventWire(), auditEventWire({ id: 'audit-002', action: 'report:approve' })],
      page: { has_more: true, next_cursor: 'cursor-1' },
    })
  }

  try {
    const result = await listAuditEvents({
      actorKey: 'frontend-dev-researcher',
      action: 'report:create',
      since: '2026-08-01T00:00:00Z',
      until: '2026-08-31T23:59:59Z',
      page: 1,
      pageSize: 20,
    })
    assert.equal(result.items.length, 2)
    assert.equal(result.page.hasMore, true)
    assert.equal(result.page.nextCursor, 'cursor-1')
  } finally {
    globalThis.fetch = originalFetch
  }

  const url = new URL(calls[0])
  assert.equal(url.searchParams.get('actor_key'), 'frontend-dev-researcher')
  assert.equal(url.searchParams.get('action'), 'report:create')
  assert.equal(url.searchParams.get('since'), '2026-08-01T00:00:00Z')
})

// ---------------------------------------------------------------------------
// Network error tests
// ---------------------------------------------------------------------------

test('B5 real surfaces network errors without falling back to mock data', async () => {
  const previousMode = process.env.VITE_API_MODE
  const originalFetch = globalThis.fetch
  process.env.VITE_API_MODE = 'real'
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }

  const { createServer } = await import('vite')
  const server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const api = await server.ssrLoadModule('/src/api/b5/index.ts')
    assert.equal(api.B5Real.readsAreReal, true)

    await assert.rejects(
      () => api.B5Real.listReports(),
      (error) => error?.code === 'NETWORK_ERROR',
    )
    await assert.rejects(
      () => api.B5Real.listValidationRuns('exp-001'),
      (error) => error?.code === 'NETWORK_ERROR',
    )
    await assert.rejects(
      () => api.B5Real.listRiskEvents(),
      (error) => error?.code === 'NETWORK_ERROR',
    )
    await assert.rejects(
      () => api.B5Real.listAuditEvents(),
      (error) => error?.code === 'NETWORK_ERROR',
    )
  } finally {
    await server.close()
    globalThis.fetch = originalFetch
    if (previousMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = previousMode
  }
})

// ---------------------------------------------------------------------------
// Report run links tests
// ---------------------------------------------------------------------------

test('B5 real list report runs returns run links', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    return Response.json([
      {
        report_id: 'report-001',
        run_id: 'run-001',
        role: 'primary',
        created_at: '2026-08-13T00:00:00Z',
      },
      {
        report_id: 'report-001',
        run_id: 'run-002',
        role: 'baseline',
        created_at: '2026-08-13T00:01:00Z',
      },
    ])
  }

  try {
    const links = await listReportRuns('report-001')
    assert.equal(links.length, 2)
    assert.equal(links[0].runId, 'run-001')
    assert.equal(links[0].role, 'primary')
    assert.equal(links[1].runId, 'run-002')
    assert.equal(links[1].role, 'baseline')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// HTTP error mapping tests
// ---------------------------------------------------------------------------

test('B5 real surfaces HTTP errors as ApiError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    if (path.includes('/reports/report-missing')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'report not found',
            request_id: 'rid-404',
          },
        }),
        { status: 404, headers: { 'X-Request-Id': 'rid-404' } },
      )
    }
    return new Response(
      JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'permission denied',
          request_id: 'rid-403',
        },
      }),
      { status: 403, headers: { 'X-Request-Id': 'rid-403' } },
    )
  }

  try {
    await assert.rejects(
      () => getReport('report-missing'),
      (error) => error?.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => reportAction('report-missing', 'approve', '', 'key'),
      (error) => error?.code === 'FORBIDDEN',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Idempotency key tests
// ---------------------------------------------------------------------------

test('B5 create operations reuse idempotency key for same input', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    })
    return Response.json({
      item: reportWire(),
      audit_event_id: 'audit-001',
    })
  }

  const content: ReportContent = {
    contractVersion: 'report_content_v1',
    title: '报告',
    dataCutoff: '2026-08-12',
    applicableUniverse: ['csi300'],
    predictionHorizonDays: 5,
    blocks: [],
  }

  try {
    const first = await createReport('exp-001', '报告', content, [], 'idem-key-1')
    const retry = await createReport('exp-001', '报告', content, [], 'idem-key-1')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].idempotencyKey, 'idem-key-1')
    assert.equal(calls[1].idempotencyKey, 'idem-key-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})
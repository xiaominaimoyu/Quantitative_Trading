import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mapDataSource,
  mapDataset,
  mapDatasetVersion,
  mapLineage,
  mapQualityRun,
  mapSnapshotTask,
} from '../src/api/datasets/mapper.ts'
import {
  createDatasetSnapshot,
  getDatasetVersion,
  getSnapshotTask,
  getVersionLineage,
  listDataSources,
  listDatasets,
  listQualityRuns,
} from '../src/api/datasets/real.ts'
import {
  isDatasetVersionTerminal,
  isSnapshotTaskTerminal,
} from '../src/api/datasets/polling.ts'
import { resolveSnapshotSubmission } from '../src/api/datasets/submission.ts'

const datasetWire = {
  id: 'dataset-id',
  slug: 'a-share-bars',
  name: 'A 股日频行情',
  market: 'CN',
  frequency: 'daily',
  schema_version: 'market_bar_v1',
  license: 'development-only',
  status: 'active',
  source_id: 'source-id',
  source: 'Deterministic fixture',
  latest_version_id: 'version-id',
  latest_version_no: 3,
  latest_version_status: 'available',
  latest_quality_status: 'passed',
  time_range: '2020-01-01 ~ 2025-12-31',
  row_count: 10,
  latest_logical_content_sha256: 'logical-sha',
  eligible_for_formal_use: true,
  gate_decision: 'eligible',
  gate_reasons: [],
  created_at: '2026-08-09T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
}

const versionWire = {
  id: 'version-id',
  dataset_id: 'dataset-id',
  version_no: 3,
  parent_version_id: 'parent-version-id',
  task_id: 'task-id',
  status: 'available',
  quality_status: 'passed',
  quality_summary: '全部规则通过',
  time_range: '2020-01-01 ~ 2025-12-31',
  row_count: 10,
  logical_content_sha256: 'logical-sha',
  manifest_sha256: 'manifest-sha',
  eligible_for_formal_use: true,
  gate_decision: 'eligible',
  gate_reasons: [],
  created_at: '2026-08-09T00:00:00Z',
  manifest: {
    manifest_version: '1',
    schema_version: 'market_bar_v1',
    dataset_id: 'dataset-id',
    dataset_version_id: 'version-id',
    parent_version_id: 'parent-version-id',
    source: {
      name: 'Deterministic fixture',
      revision: 'fixture-v1',
      license_ref: 'development-only',
    },
    market: 'CN',
    frequency: 'daily',
    timezone: 'Asia/Shanghai',
    adjustment: 'backward',
    schema_fingerprint: 'schema-sha',
    primary_key: ['symbol', 'exchange', 'event_time'],
    sort_key: ['event_time', 'symbol', 'exchange'],
    row_count: 10,
    time_range: { start: '2020-01-01', end: '2025-12-31' },
    partitions: [
      {
        relative_path: 'market=CN/interval=1d/year=2025/part-000.parquet',
        row_count: 10,
        size_bytes: 1024,
        time_range: { start: '2025-01-01', end: '2025-12-31' },
        symbol_range: { start: '000001', end: '600000' },
        file_sha256: 'file-sha',
      },
    ],
    writer_profile: {
      parquet_version: '2.6',
      compression: 'zstd',
      compression_level: 3,
      use_dictionary: ['symbol', 'exchange'],
      write_statistics: true,
      row_group_size: 65536,
      data_page_version: '2.0',
      timestamp_unit: 'us',
    },
    generation: {
      task_id: 'task-id',
      code_version: 'commit-sha',
      config_hash: 'config-sha',
    },
    quality: {
      rule_set: 'market_bar_v1.0',
      status: 'passed',
      run_id: 'quality-run-id',
      report_artifact_id: 'quality-report-id',
      report_relative_path: 'quality/report.json',
      report_sha256: 'quality-report-sha',
    },
    logical_content_sha256: 'logical-sha',
    manifest_sha256: 'manifest-sha',
  },
}

test('B2 mappers preserve real source, eligibility, manifest hashes and partitions', () => {
  const source = mapDataSource({
    id: 'source-id',
    name: 'Deterministic fixture',
    adapter: 'deterministic_fixture',
    license_ref: 'development-only',
    status: 'active',
  })
  assert.deepEqual(source, {
    id: 'source-id',
    name: 'Deterministic fixture',
    adapter: 'deterministic_fixture',
    license: 'development-only',
    status: 'active',
  })

  const dataset = mapDataset(datasetWire)
  assert.equal(dataset.sourceId, 'source-id')
  assert.equal(dataset.source, 'Deterministic fixture')
  assert.equal(dataset.latestVersionId, 'version-id')
  assert.equal(dataset.logicalContentSha256, 'logical-sha')
  assert.equal(dataset.eligibleForFormalUse, true)

  const version = mapDatasetVersion(versionWire)
  assert.equal(version.parentVersionId, 'parent-version-id')
  assert.equal(version.taskId, 'task-id')
  assert.equal(version.eligibleForFormalUse, true)
  assert.deepEqual(version.gateReasons, [])
  assert.equal(version.logicalContentSha256, 'logical-sha')
  assert.equal(version.manifestSha256, 'manifest-sha')
  assert.equal(version.manifest?.timezone, 'Asia/Shanghai')
  assert.equal(version.manifest?.partitions[0].fileSha256, 'file-sha')
  assert.equal(version.manifest?.writerProfile.compression, 'zstd')
  assert.equal(version.manifest?.quality.reportSha256, 'quality-report-sha')
})

test('B2 mappers do not invent absent real values or client-side eligibility', () => {
  const dataset = mapDataset({
    ...datasetWire,
    source_id: null,
    source: null,
    latest_logical_content_sha256: null,
    eligible_for_formal_use: false,
    gate_decision: 'not_eligible',
    gate_reasons: ['quality_pending'],
  })
  assert.equal(dataset.sourceId, null)
  assert.equal(dataset.source, null)
  assert.equal(dataset.logicalContentSha256, null)
  assert.equal(dataset.eligibleForFormalUse, false)

  const version = mapDatasetVersion({
    ...versionWire,
    status: 'available',
    quality_status: 'warning',
    eligible_for_formal_use: false,
    gate_reasons: ['warning_not_allowed'],
    manifest: null,
    logical_content_sha256: null,
    manifest_sha256: null,
  })
  assert.equal(version.eligibleForFormalUse, false)
  assert.deepEqual(version.gateReasons, ['warning_not_allowed'])
  assert.equal(version.manifest, null)
  assert.equal(version.logicalContentSha256, null)

  assert.equal(mapDataset({ ...datasetWire, gate_decision: 'accepted' }).gateDecision, null)
  assert.equal(mapDatasetVersion({ ...versionWire, gate_decision: 'rejected' }).gateDecision, null)
})

test('real B2 directory calls use server-side filters and one paginated response', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    if (String(input).includes('/data-sources')) {
      return Response.json({
        items: [{
          id: 'source-id',
          name: 'Deterministic fixture',
          adapter: 'deterministic_fixture',
          license_ref: 'development-only',
          status: 'active',
        }],
        page: { has_more: false, next_cursor: null },
      })
    }
    return Response.json({
      items: [datasetWire],
      page: { has_more: true, next_cursor: 3 },
    })
  }

  try {
    const sources = await listDataSources()
    assert.equal(sources.items[0].adapter, 'deterministic_fixture')
    const page = await listDatasets({
      page: 2,
      pageSize: 25,
      name: '行情',
      market: 'CN',
      frequency: 'daily',
      status: 'available',
      sourceId: 'source-id',
    })
    assert.equal(page.items[0].id, 'dataset-id')
    assert.equal(page.page.hasMore, true)
    assert.equal(page.page.nextCursor, 3)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 2)
  const url = new URL(calls[1])
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('page_size'), '25')
  assert.equal(url.searchParams.get('name'), '行情')
  assert.equal(url.searchParams.get('market'), 'CN')
  assert.equal(url.searchParams.get('frequency'), 'daily')
  assert.equal(url.searchParams.get('status'), 'available')
  assert.equal(url.searchParams.get('data_source_id'), 'source-id')
})

test('real snapshot creation sends the frozen structured body and stable idempotency key', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json(
      { dataset_version_id: 'version-id', task_id: 'task-id' },
      { status: 202 },
    )
  }

  const input = {
    datasetId: 'dataset-id',
    dataSourceId: 'source-id',
    timeStart: '2020-01-01',
    timeEnd: '2025-12-31',
    symbols: ['600000.SH', '000001.SZ'],
    adjustment: 'backward',
    parentVersionId: 'parent-version-id',
  }
  const first = resolveSnapshotSubmission(input)
  const retry = resolveSnapshotSubmission(input, first)
  const changed = resolveSnapshotSubmission({ ...input, timeEnd: '2026-01-01' }, first)
  assert.equal(retry.idempotencyKey, first.idempotencyKey)
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey)

  try {
    const accepted = await createDatasetSnapshot(input, {
      idempotencyKey: first.idempotencyKey,
    })
    assert.deepEqual(accepted, {
      datasetVersionId: 'version-id',
      taskId: 'task-id',
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/datasets\/dataset-id\/versions$/)
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get('Idempotency-Key'), first.idempotencyKey)
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    data_source_id: 'source-id',
    time_start: '2020-01-01',
    time_end: '2025-12-31',
    symbols: ['600000.SH', '000001.SZ'],
    adjustment: 'backward',
    parent_version_id: 'parent-version-id',
  })
})

test('real version observation reads version, task, quality runs and lineage without mock data', async () => {
  const originalFetch = globalThis.fetch
  const paths = []
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    paths.push(path)
    if (path.endsWith('/dataset-versions/version-id')) return Response.json(versionWire)
    if (path.endsWith('/tasks/task-id')) {
      return Response.json({
        id: 'task-id',
        task_type: 'data_ingest',
        status: 'success',
        progress: 100,
        attempt_count: 1,
        error_code: null,
        error_message: null,
        created_at: '2026-08-09T00:00:00Z',
        updated_at: '2026-08-09T00:01:00Z',
        completed_at: '2026-08-09T00:01:00Z',
      })
    }
    if (path.endsWith('/quality-runs')) {
      return Response.json({
        items: [{
          id: 'quality-run-id',
          version_id: 'version-id',
          task_id: 'quality-task-id',
          rule_set_version: 'market_bar_v1.0',
          status: 'passed',
          created_at: '2026-08-09T00:00:30Z',
          completed_at: '2026-08-09T00:00:59Z',
          blocking_count: 0,
          warning_count: 0,
          report_artifact_id: 'quality-report-id',
          results: [{
            rule_id: 'schema_exact',
            rule_version: '1',
            severity: 'blocking',
            status: 'passed',
            count: 0,
            message: null,
            samples: [],
          }],
        }],
        page: { has_more: false, next_cursor: null },
      })
    }
    return Response.json({
      nodes: [
        { id: 'parent-version-id', dataset_id: 'dataset-id', version_no: 2, status: 'available' },
        { id: 'version-id', dataset_id: 'dataset-id', version_no: 3, status: 'available' },
      ],
      edges: [
        { parent_version_id: 'parent-version-id', child_version_id: 'version-id', relation_type: 'derived_from' },
      ],
    })
  }

  try {
    const [version, task, quality, lineage] = await Promise.all([
      getDatasetVersion('version-id'),
      getSnapshotTask('task-id'),
      listQualityRuns('version-id'),
      getVersionLineage('version-id'),
    ])
    assert.equal(version.manifest?.logicalContentSha256, 'logical-sha')
    assert.equal(task.status, 'success')
    assert.equal(quality.items[0].results[0].ruleId, 'schema_exact')
    assert.equal(lineage.edges[0].relationType, 'derived_from')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(paths.sort(), [
    '/api/v1/dataset-versions/version-id',
    '/api/v1/dataset-versions/version-id/lineage',
    '/api/v1/dataset-versions/version-id/quality-runs',
    '/api/v1/tasks/task-id',
  ].sort())
})

test('quality, lineage and task mappers preserve backend decisions and errors', () => {
  const quality = mapQualityRun({
    id: 'quality-run-id',
    version_id: 'version-id',
    task_id: 'quality-task-id',
    rule_set_version: 'market_bar_v1.0',
    status: 'blocked',
    created_at: '2026-08-09T00:00:00Z',
    completed_at: '2026-08-09T00:01:00Z',
    blocking_count: 1,
    warning_count: 0,
    report_artifact_id: 'report-id',
    results: [{
      rule_id: 'positive_price',
      rule_version: '1',
      severity: 'blocking',
      status: 'failed',
      count: 2,
      message: '价格必须为正',
      samples: [{ symbol: '600000.SH' }],
    }],
  })
  assert.equal(quality.blockedCount, 1)
  assert.equal(quality.results[0].count, 2)

  const lineage = mapLineage({
    nodes: [{ id: 'version-id', dataset_id: 'dataset-id', version_no: 3, status: 'available' }],
    edges: [],
  })
  assert.equal(lineage.nodes[0].version, 3)

  const task = mapSnapshotTask({
    id: 'task-id',
    task_type: 'data_ingest',
    status: 'failed',
    progress: 45,
    attempt_count: 1,
    error_code: 'QUALITY_GATE_BLOCKED',
    error_message: '质量门阻断',
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:01:00Z',
    completed_at: '2026-08-09T00:01:00Z',
  })
  assert.equal(task.errorCode, 'QUALITY_GATE_BLOCKED')
})

test('polling terminal sets match the frozen B2 state machines', () => {
  for (const status of ['available', 'failed', 'deprecated']) {
    assert.equal(isDatasetVersionTerminal(status), true)
  }
  for (const status of ['draft', 'validating']) {
    assert.equal(isDatasetVersionTerminal(status), false)
  }
  for (const status of ['success', 'failed', 'canceled']) {
    assert.equal(isSnapshotTaskTerminal(status), true)
  }
  for (const status of ['queued', 'claimed', 'running']) {
    assert.equal(isSnapshotTaskTerminal(status), false)
  }
})

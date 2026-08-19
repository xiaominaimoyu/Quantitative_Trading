import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ApiError, apiErrorFromResponse } from '../src/api/client.ts'
import { apiRequest } from '../src/api/http.ts'
import {
  mapDataset,
  mapDatasetVersion,
} from '../src/api/datasets/mapper.ts'
import { listDatasets as listRealDatasets } from '../src/api/datasets/real.ts'
import { API_OPERATIONS } from '../src/api/generated/schema.ts'
import {
  requestDevSession,
  resetDevSession,
} from '../src/api/session.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function datasetResponse(id, name) {
  return {
    id,
    slug: id,
    name,
    market: 'A 股',
    frequency: 'daily',
    schema_version: '1.0',
    license: 'internal',
    status: 'active',
    latest_version_status: 'available',
    latest_quality_status: 'passed',
    time_range: '2020-01-01 ~ 2025-12-31',
    row_count: 10,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  }
}

test('generated OpenAPI artifacts are current', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-api.mjs', '--check'], {
    cwd: frontendRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('generated operation list contains the real integration surface', () => {
  const operations = new Set(
    API_OPERATIONS.map(({ method, path }) => `${method} ${path}`),
  )
  for (const operation of [
    'POST /api/v1/auth/dev-session',
    'GET /api/v1/auth/me',
    'GET /api/v1/datasets',
    'GET /api/v1/datasets/{dataset_id}',
    'GET /api/v1/datasets/{dataset_id}/versions',
    'POST /api/v1/datasets/{dataset_id}/versions',
    'GET /api/v1/dataset-versions/{version_id}',
    'GET /api/v1/data-sources',
    'GET /api/v1/dataset-versions/{version_id}/quality-runs',
    'POST /api/v1/dataset-versions/{version_id}/quality-runs',
    'GET /api/v1/dataset-versions/{version_id}/lineage',
    'POST /api/v1/dataset-versions/{version_id}/query',
    'POST /api/v1/dataset-versions/{version_id}/aggregate',
  ]) {
    assert.ok(operations.has(operation), `missing ${operation}`)
  }
})

test('backend errors map 401/403/404/409/422 through the same contract', async (t) => {
  for (const [status, code] of [
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'DATASET_NOT_FOUND'],
    [409, 'IDEMPOTENCY_KEY_CONFLICT'],
    [422, 'VALIDATION_ERROR'],
  ]) {
    await t.test(String(status), async () => {
      const response = new Response(
        JSON.stringify({
          error: {
            code,
            message: `HTTP ${status}`,
            request_id: `rid-${status}`,
            details: [{ field: 'dataset_id', reason: 'invalid' }],
          },
        }),
        { status, headers: { 'X-Request-Id': 'rid-header' } },
      )
      const error = await apiErrorFromResponse(response)
      assert.ok(error instanceof ApiError)
      assert.equal(error.code, code)
      assert.equal(error.message, `HTTP ${status}`)
      assert.equal(error.requestId, `rid-${status}`)
    })
  }
})

test('API requests send client request IDs', async () => {
  const originalFetch = globalThis.fetch
  const requestIds = []
  globalThis.fetch = async (_input, init) => {
    requestIds.push(new Headers(init?.headers).get('X-Request-Id'))
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await apiRequest('/probe')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestIds.length, 1)
  for (const requestId of requestIds) {
    assert.match(requestId ?? '', /^REQ-\d{8}-[A-F0-9]{4}$/)
  }
})

test('dev-session is verified through auth/me before its token is cached', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), headers })
    if (String(input).endsWith('/auth/dev-session')) {
      return new Response(
        JSON.stringify({
          token: 'test-token',
          expires_at: '2099-01-01T00:00:00Z',
          role: 'researcher',
          scopes: ['dataset:read'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        login_name: 'frontend-dev-researcher',
        role: 'researcher',
        scopes: ['dataset:read'],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    resetDevSession()
    await requestDevSession('researcher')
  } finally {
    resetDevSession()
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /\/auth\/dev-session$/)
  assert.equal(calls[0].headers.get('Authorization'), null)
  assert.match(calls[1].url, /\/auth\/me$/)
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer test-token')
  const requestIds = calls.map(({ headers }) => headers.get('X-Request-Id'))
  for (const requestId of requestIds) {
    assert.match(requestId ?? '', /^REQ-\d{8}-[A-F0-9]{4}$/)
  }
  assert.notEqual(requestIds[0], requestIds[1])
})

test('dataset mapper makes missing fields explicit and localizes frequency', () => {
  const mapped = mapDataset({
    id: '4e75270a-b1c8-4de8-91a3-7a99b95de44b',
    slug: 'ds-ashare',
    name: 'A 股日频行情',
    market: 'A 股',
    frequency: 'daily',
    schema_version: '1.0',
    license: 'internal',
    status: 'active',
    latest_version_status: 'available',
    latest_quality_status: 'passed',
    time_range: null,
    row_count: 10,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  })
  assert.equal(mapped.source, null)
  assert.equal(mapped.frequency, '日频')
  assert.equal(mapped.timeRange, null)
})

test('real dataset listing returns one server-managed page', async () => {
  const originalFetch = globalThis.fetch
  const pages = []
  globalThis.fetch = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'))
    pages.push(page)
    return new Response(
      JSON.stringify({
        items: [datasetResponse(`dataset-${page}`, `数据集 ${page}`)],
        page: { has_more: true, next_cursor: 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const datasets = await listRealDatasets()
    assert.deepEqual(pages, [1])
    assert.deepEqual(datasets.items.map(({ id }) => id), ['dataset-1'])
    assert.equal(datasets.page.nextCursor, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('mock facade remains the default and keeps snapshot behavior', async () => {
  const previousMode = process.env.VITE_API_MODE
  process.env.VITE_API_MODE = 'mock'
  const { createServer } = await import('vite')
  const server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    const api = await server.ssrLoadModule('/src/api/datasets/index.ts')
    assert.equal(api.datasetReadsAreReal, false)
    const before = await api.listDatasetVersions('ds-ashare')
    const input = {
      datasetId: 'ds-ashare',
      dataSourceId: 'src-fixture',
      timeStart: '2020-01-01',
      timeEnd: '2026-08-09',
      symbols: ['000001.SZ'],
      adjustment: 'backward',
      parentVersionId: 'ds-ashare-v3',
    }
    const requestOptions = { idempotencyKey: 'snapshot-contract-test' }
    const created = await api.createDatasetSnapshot(input, requestOptions)
    const replay = await api.createDatasetSnapshot(input, requestOptions)
    assert.deepEqual(replay, created)
    await assert.rejects(
      () => api.createDatasetSnapshot({ ...input, timeEnd: '2026-08-10' }, requestOptions),
      (error) => error?.code === 'IDEMPOTENCY_KEY_CONFLICT',
    )
    const after = await api.listDatasetVersions('ds-ashare')
    assert.equal(after.items.length, before.items.length + 1)
    assert.equal(after.items[0].id, created.datasetVersionId)
    const validating = await api.getDatasetVersion(created.datasetVersionId)
    const available = await api.getDatasetVersion(created.datasetVersionId)
    assert.equal(validating.status, 'validating')
    assert.equal(available.status, 'available')
    assert.equal(available.eligibleForFormalUse, true)
  } finally {
    await server.close()
    if (previousMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = previousMode
  }
})

test('real facade surfaces network failure without falling back to mock data', async () => {
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
    const api = await server.ssrLoadModule('/src/api/datasets/index.ts')
    assert.equal(api.datasetReadsAreReal, true)
    await assert.rejects(
      () => api.listDatasets(),
      (error) => error?.code === 'NETWORK_ERROR',
    )
  } finally {
    await server.close()
    globalThis.fetch = originalFetch
    if (previousMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = previousMode
  }
})

test('dataset version mapper converts snake_case without inventing quality data', () => {
  const mapped = mapDatasetVersion({
    id: 'version-id',
    dataset_id: 'dataset-id',
    version_no: 3,
    adjustment: 'none',
    data_source_id: null,
    eligible_for_formal_use: false,
    gate_decision: 'not_eligible',
    gate_reasons: ['quality_pending'],
    logical_content_sha256: null,
    manifest_sha256: null,
    parent_version_id: null,
    status: 'draft',
    quality_status: 'unknown-value',
    quality_summary: null,
    source: null,
    task_id: null,
    time_end: null,
    time_range: null,
    time_start: null,
    timezone: 'Asia/Shanghai',
    row_count: 0,
    created_at: '2026-08-09T00:00:00Z',
  })
  assert.equal(mapped.datasetId, 'dataset-id')
  assert.equal(mapped.version, 3)
  assert.equal(mapped.qualityStatus, 'unknown')
  assert.equal(mapped.qualitySummary, null)
})

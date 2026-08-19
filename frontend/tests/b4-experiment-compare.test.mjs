/**
 * B4 模型 / 运行比较：real API 客户端 + mock 比较门面 + 反选择性偏差设计测试。
 *
 * 覆盖点：
 * 1. mock listExperimentRuns 返回预期的运行摘要（按 createdAt 降序，反偏差）；
 * 2. real listExperimentRuns 正确映射 RunListOut → RunSummary（snake→camel）；
 * 3. 比较页保持反偏差设计（Alert + 无 defaultSortOrder）；
 * 4. ExperimentCompare.tsx 使用 isRealApiMode + lazy，不直接导入 mock；
 * 5. ExperimentCompareReal.tsx 使用 real API + DisabledNotice。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import { listExperimentRuns as listRealExperimentRuns } from '../src/api/runs.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Mock 门面：通过 Vite SSR 加载（mock 模块依赖 import.meta.env）。
// ---------------------------------------------------------------------------

let server
let listMockExperimentRuns

test.before(async () => {
  server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ listExperimentRuns: listMockExperimentRuns } = await server.ssrLoadModule(
    '/src/api/mock/experiments.ts',
  ))
})

test.after(async () => {
  await server?.close()
})

// ---------------------------------------------------------------------------
// 1. Mock 门面：返回预期摘要、按 createdAt 降序、不按收益排序
// ---------------------------------------------------------------------------

test('mock comparison facade returns run summaries sorted by createdAt desc (anti-bias)', async () => {
  const runs = await listMockExperimentRuns('exp-momentum-0042', { latencyMs: 0 })
  assert.ok(runs.length >= 3, 'exp-momentum-0042 should have at least 3 runs')

  for (const run of runs) {
    assert.equal(run.experimentId, 'exp-momentum-0042')
    assert.ok(run.id, 'run.id must be present')
    assert.ok(run.createdAt, 'run.createdAt must be present')
    assert.ok(run.status, 'run.status must be present')
  }

  // Sorted by createdAt descending
  for (let i = 1; i < runs.length; i++) {
    assert.ok(
      runs[i - 1].createdAt >= runs[i].createdAt,
      `runs must be sorted by createdAt desc: ${runs[i - 1].createdAt} >= ${runs[i].createdAt}`,
    )
  }
})

test('mock comparison facade does NOT sort by annualReturn (anti-bias)', async () => {
  const runs = await listMockExperimentRuns('exp-momentum-0042', { latencyMs: 0 })
  const ids = runs.map((r) => r.id)
  const annualReturns = runs.map((r) => r.annualReturn ?? -Infinity)

  // If sorted by annualReturn desc, the first run would be R-0041 (12.3%)
  // Instead, the first run should be R-0040 (createdAt 11:05, no annualReturn)
  assert.notEqual(
    ids[0],
    'R-0041',
    'first run must NOT be the one with highest annualReturn (anti-bias)',
  )

  // The array is NOT sorted by annualReturn descending
  const sortedByReturn = [...annualReturns].sort((a, b) => b - a)
  assert.notDeepEqual(
    annualReturns,
    sortedByReturn,
    'runs must NOT be sorted by annualReturn desc',
  )
})

test('mock comparison facade returns expected run IDs for exp-momentum-0042', async () => {
  const runs = await listMockExperimentRuns('exp-momentum-0042', { latencyMs: 0 })
  const ids = runs.map((r) => r.id)
  assert.deepEqual(ids, ['R-0040', 'R-0042', 'R-0041'])

  // R-0041 is the only successful run with metrics
  const r0041 = runs.find((r) => r.id === 'R-0041')
  assert.equal(r0041.status, 'success')
  assert.equal(r0041.annualReturn, 12.3)
  assert.equal(r0041.maxDrawdown, -8.4)
  assert.equal(r0041.sharpe, 1.02)
  assert.equal(r0041.modelName, '线性回归 v1')
})

test('mock comparison facade returns empty for unknown experiment', async () => {
  const runs = await listMockExperimentRuns('exp-nonexistent', { latencyMs: 0 })
  assert.equal(runs.length, 0)
})

// ---------------------------------------------------------------------------
// 2. Real 门面：映射 RunListOut → RunSummary、按 createdAt 降序、网络错误不回退
// ---------------------------------------------------------------------------

function runOut(id, createdAt, modelVersionId = null) {
  return {
    id,
    experiment_id: 'exp-001',
    task_id: `task-${id}`,
    source_run_id: null,
    fingerprint: 'a'.repeat(64),
    run_manifest: modelVersionId ? { model_version_id: modelVersionId } : {},
    run_manifest_sha256: 'b'.repeat(64),
    status: 'success',
    result_completeness: 'complete',
    business_result_sha256: null,
    error_code: null,
    error_message: null,
    created_at: createdAt,
    started_at: '2026-08-08T09:00:00Z',
    completed_at: '2026-08-08T10:00:00Z',
  }
}

test('real listExperimentRuns maps RunListOut to RunSummary and sorts by createdAt desc', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({
        // Backend returns runs in arbitrary order; client must sort.
        items: [
          runOut('run-002', '2026-08-08T08:00:00Z', 'model-uuid-002'),
          runOut('run-001', '2026-08-08T10:00:00Z', 'model-uuid-001'),
        ],
        page: { next_cursor: null, has_more: false },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const runs = await listRealExperimentRuns('exp-001')

    // Exactly one fetch to the experiments runs endpoint
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/experiments\/exp-001\/runs/)
    assert.match(calls[0], /page_size=100/)

    // Sorted by createdAt desc: run-001 (10:00) before run-002 (08:00)
    assert.equal(runs.length, 2)
    assert.equal(runs[0].id, 'run-001')
    assert.equal(runs[1].id, 'run-002')

    // snake_case → camelCase mapping
    assert.equal(runs[0].experimentId, 'exp-001')
    assert.equal(runs[0].status, 'success')
    assert.equal(runs[0].resultCompleteness, 'complete')
    assert.equal(runs[0].createdAt, '2026-08-08T10:00:00Z')

    // modelName from run_manifest.model_version_id
    assert.equal(runs[0].modelName, 'model-uuid-001')
    assert.equal(runs[1].modelName, 'model-uuid-002')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listExperimentRuns handles empty items list', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ items: [], page: { next_cursor: null, has_more: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  try {
    const runs = await listRealExperimentRuns('exp-empty')
    assert.equal(runs.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listExperimentRuns surfaces network errors without falling back to mock', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }
  try {
    await assert.rejects(
      () => listRealExperimentRuns('exp-001'),
      (error) => error?.code === 'NETWORK_ERROR',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listExperimentRuns surfaces HTTP errors as ApiError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'experiment not found',
          request_id: 'rid-404',
        },
      }),
      { status: 404, headers: { 'X-Request-Id': 'rid-404' } },
    )
  try {
    await assert.rejects(
      () => listRealExperimentRuns('exp-missing'),
      (error) => error?.code === 'NOT_FOUND',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 3. 反偏差设计：页面源码断言
// ---------------------------------------------------------------------------

test('comparison pages contain anti-bias Alert and no default return sort', () => {
  for (const page of [
    'ExperimentCompareMock.tsx',
    'ExperimentCompareReal.tsx',
  ]) {
    const source = readFileSync(resolve(frontendRoot, 'src/pages', page), 'utf8')
    // Anti-bias Alert is present
    assert.match(
      source,
      /比较视图默认不按收益指标排序/,
      `${page} must contain the anti-bias Alert`,
    )
    // annualReturn column must not have defaultSortOrder (anti-bias: sort is opt-in)
    assert.doesNotMatch(
      source,
      /annualReturn[^)\]]*defaultSortOrder/,
      `${page} must not default-sort by annualReturn`,
    )
    // "默认按创建时间排序" subtitle is present
    assert.match(
      source,
      /默认按创建时间排序/,
      `${page} must mention default sort by createdAt`,
    )
  }
})

test('ExperimentCompare.tsx uses isRealApiMode + lazy, no direct mock imports', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/ExperimentCompare.tsx'),
    'utf8',
  )
  assert.match(source, /isRealApiMode/, 'must use isRealApiMode')
  assert.match(source, /lazy\(\(\) => import\(/, 'must lazy-load sub-pages')
  assert.match(source, /Suspense/, 'must wrap in Suspense')
  assert.doesNotMatch(source, /api\/mock\//, 'must not import mock directly')
})

test('ExperimentCompareReal.tsx uses real API facades and DisabledNotice for NAV chart', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/ExperimentCompareReal.tsx'),
    'utf8',
  )
  assert.match(source, /from '@\/api\/runs'/, 'must import from real API')
  assert.match(source, /listExperimentRuns/, 'must use listExperimentRuns')
  assert.match(source, /listRunMetrics/, 'must use listRunMetrics for metrics')
  assert.match(source, /DisabledNotice/, 'must use DisabledNotice for NAV chart')
  assert.doesNotMatch(source, /api\/mock\//, 'must not import mock directly')
  assert.doesNotMatch(
    source,
    /getRunNavSeries/,
    'must not call mock NAV series in real mode',
  )
})

test('ExperimentCompareMock.tsx preserves NAV chart and mock facades', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/ExperimentCompareMock.tsx'),
    'utf8',
  )
  assert.match(source, /from '@\/api\/mock\/experiments'/, 'must use mock experiments')
  assert.match(source, /from '@\/api\/mock\/runs'/, 'must use mock runs')
  assert.match(source, /getRunNavSeries/, 'must use getRunNavSeries for NAV chart')
  assert.match(source, /ChartPanel/, 'must render ChartPanel for NAV chart')
  assert.match(
    source,
    /比较视图默认不按收益指标排序/,
    'must contain anti-bias Alert',
  )
})

test('comparison pages keep the required table columns', () => {
  for (const page of ['ExperimentCompareMock.tsx', 'ExperimentCompareReal.tsx']) {
    const source = readFileSync(resolve(frontendRoot, 'src/pages', page), 'utf8')
    for (const column of ['运行', '模型', '状态', '年化收益', '最大回撤', 'Sharpe']) {
      assert.match(
        source,
        new RegExp(column),
        `${page} must have column "${column}"`,
      )
    }
  }
})

test('runs.ts exports RunSummary type and listExperimentRuns function', async () => {
  // Verify the real API module exports the expected symbols
  const realServer = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    const api = await realServer.ssrLoadModule('/src/api/runs.ts')
    assert.equal(typeof api.listExperimentRuns, 'function')
    // RunSummary is a type (erased at runtime), so we verify via source inspection
    const source = readFileSync(
      resolve(frontendRoot, 'src/api/runs.ts'),
      'utf8',
    )
    assert.match(source, /export interface RunSummary/, 'must export RunSummary type')
    assert.match(source, /export async function listExperimentRuns/, 'must export listExperimentRuns')
    // RunSummary has the required fields
    assert.match(source, /experimentId/, 'RunSummary has experimentId')
    assert.match(source, /resultCompleteness/, 'RunSummary has resultCompleteness')
    assert.match(source, /modelName/, 'RunSummary has modelName')
  } finally {
    await realServer.close()
  }
})

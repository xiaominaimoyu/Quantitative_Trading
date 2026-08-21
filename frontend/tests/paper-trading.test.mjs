/**
 * G5 模拟盘：real API 客户端 + mock 门面 + 页面切分测试。
 *
 * 覆盖点：
 * 1. mock getPaperTradingSnapshot 返回预期沙箱快照形状；
 * 2. real getPaperTradingSnapshot 正确映射 snake_case → camelCase、buy/sell → 买入/卖出；
 * 3. real manualStopPaperTrading POST /paper-trading/stop 带 Idempotency-Key；
 * 4. real listPaperOrders / listReconciliations 命中正确端点并支持分页；
 * 5. real getReconciliationDetail 命中 /reconciliations/{id}；
 * 6. real getDailyReport 支持 date 参数；
 * 7. real 门面网络错误不回退 mock，HTTP 错误以 ApiError 抛出；
 * 8. PaperTrading.tsx 使用 isRealApiMode + lazy，不直接导入 mock；
 * 9. PaperTradingReal.tsx 使用 real API、保留隔离 Alert；
 * 10. PaperTradingMock.tsx 保留 mock 门面与原 UI。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import {
  getDailyReport as realGetDailyReport,
  getPaperTradingSnapshot as realGetSnapshot,
  getReconciliationDetail as realGetReconciliationDetail,
  listPaperOrders as realListPaperOrders,
  listReconciliations as realListReconciliations,
  mapPaperOrderStatus,
  manualStopPaperTrading as realManualStop,
} from '../src/api/paperTrading.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Mock 门面：通过 Vite SSR 加载（mock 模块依赖 import.meta.env）。
// ---------------------------------------------------------------------------

let server
let mockGetSnapshot
let mockManualStop

test.before(async () => {
  server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({
    getPaperTradingSnapshot: mockGetSnapshot,
    manualStopPaperTrading: mockManualStop,
  } = await server.ssrLoadModule('/src/api/mock/paperTrading.ts'))
})

test.after(async () => {
  await server?.close()
})

// ---------------------------------------------------------------------------
// 1. Mock 门面：返回预期沙箱快照
// ---------------------------------------------------------------------------

test('mock paper trading facade returns expected snapshot shape', async () => {
  const snapshot = await mockGetSnapshot({ latencyMs: 0 })
  assert.equal(snapshot.status, 'running')
  assert.ok(Array.isArray(snapshot.positions))
  assert.ok(Array.isArray(snapshot.orders))
  assert.ok(Array.isArray(snapshot.reconciliations))
  assert.ok(snapshot.account.total > 0)
  assert.ok(snapshot.updatedAt, 'snapshot.updatedAt must be present')

  for (const order of snapshot.orders) {
    assert.ok(['accepted', 'partial', 'filled', 'unknown', 'rejected'].includes(order.status))
    assert.ok(['买入', '卖出'].includes(order.direction))
  }
})

test('mock manual stop requires a reason and transitions status to stopped', async () => {
  await assert.rejects(
    () => mockManualStop('   ', { latencyMs: 0 }),
    (error) => error?.code === 'PAPER-400',
  )

  const result = await mockManualStop('回测验证完成', { latencyMs: 0 })
  assert.equal(result.snapshot.status, 'stopped')
  assert.ok(result.auditId, 'audit id must be present')
  assert.match(result.auditId, /^AUD-/)
})

// ---------------------------------------------------------------------------
// 2. Real 门面：snake_case → camelCase、buy/sell → 买入/卖出 映射
// ---------------------------------------------------------------------------

function snapshotResponse() {
  return {
    status: 'running',
    account: {
      total: 10_000_000,
      available: 6_280_000,
      market_value: 3_720_000,
      day_pnl: 18_600,
      day_pnl_pct: 0.19,
    },
    positions: [
      {
        symbol: '600519.SH',
        name: '贵州茅台',
        quantity: 1200,
        market_value: 2_025_840,
        pnl: 32_400,
        pnl_pct: 1.62,
      },
    ],
    orders: [
      {
        id: 'PO-20260808-0001',
        symbol: '600519.SH',
        direction: 'buy',
        quantity: 1200,
        filled_quantity: 1200,
        price: 1688.2,
        status: 'filled',
        submitted_at: '2026-08-08T09:31:00+08:00',
      },
      {
        id: 'PO-20260808-0002',
        symbol: '601318.SH',
        direction: 'sell',
        quantity: 1500,
        filled_quantity: 0,
        price: 42.18,
        status: 'unknown',
        submitted_at: '2026-08-08T09:35:00+08:00',
      },
    ],
    updated_at: '2026-08-08T09:40:00+08:00',
  }
}

test('real getPaperTradingSnapshot maps snake_case → camelCase and translates direction', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    return new Response(JSON.stringify(snapshotResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const snapshot = await realGetSnapshot()

    // Exactly one GET to /paper-trading/snapshot
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/snapshot$/)

    // Status passthrough
    assert.equal(snapshot.status, 'running')

    // Account camelCase mapping
    assert.equal(snapshot.account.marketValue, 3_720_000)
    assert.equal(snapshot.account.dayPnl, 18_600)
    assert.equal(snapshot.account.dayPnlPct, 0.19)

    // Position camelCase mapping
    assert.equal(snapshot.positions[0].symbol, '600519.SH')
    assert.equal(snapshot.positions[0].marketValue, 2_025_840)
    assert.equal(snapshot.positions[0].pnlPct, 1.62)

    // Order camelCase mapping + direction translation
    assert.equal(snapshot.orders[0].direction, '买入')
    assert.equal(snapshot.orders[0].filledQuantity, 1200)
    assert.equal(snapshot.orders[0].submittedAt, '2026-08-08T09:31:00+08:00')
    assert.equal(snapshot.orders[1].direction, '卖出')
    assert.equal(snapshot.orders[1].filledQuantity, 0)

    // updatedAt mapping
    assert.equal(snapshot.updatedAt, '2026-08-08T09:40:00+08:00')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real facade converts fixed-point strings and preserves nullable market-order fields', async () => {
  const originalFetch = globalThis.fetch
  const response = snapshotResponse()
  response.account.total = '10000000.50'
  response.account.available = '6280000.25'
  response.account.market_value = '3720000.25'
  response.account.day_pnl = '18600.10'
  response.account.day_pnl_pct = '0.19'
  response.positions[0].quantity = '1200.00'
  response.positions[0].market_value = '2025840.00'
  response.positions[0].pnl = '32400.00'
  response.positions[0].pnl_pct = '1.62'
  response.orders[0].quantity = '1200.00'
  response.orders[0].filled_quantity = '1200.00'
  response.orders[0].price = null
  response.orders[0].submitted_at = null
  globalThis.fetch = async () => new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  try {
    const snapshot = await realGetSnapshot()
    assert.equal(snapshot.account.total, 10_000_000.5)
    assert.equal(snapshot.positions[0].quantity, 1200)
    assert.equal(snapshot.orders[0].price, null)
    assert.equal(snapshot.orders[0].submittedAt, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real facade compresses complete backend G5 order states without changing UI status types', () => {
  assert.equal(mapPaperOrderStatus('planned'), 'accepted')
  assert.equal(mapPaperOrderStatus('submitting'), 'accepted')
  assert.equal(mapPaperOrderStatus('submitted'), 'accepted')
  assert.equal(mapPaperOrderStatus('cancel_pending'), 'accepted')
  assert.equal(mapPaperOrderStatus('partially_filled'), 'partial')
  assert.equal(mapPaperOrderStatus('filled'), 'filled')
  assert.equal(mapPaperOrderStatus('unknown'), 'unknown')
  assert.equal(mapPaperOrderStatus('blocked'), 'rejected')
  assert.equal(mapPaperOrderStatus('cancelled'), 'rejected')
  assert.equal(mapPaperOrderStatus('rejected'), 'rejected')
})

// ---------------------------------------------------------------------------
// 3. Real manualStopPaperTrading: POST /paper-trading/stop + Idempotency-Key
// ---------------------------------------------------------------------------

test('real manualStopPaperTrading posts to /paper-trading/stop with idempotency key and reason', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({
      url,
      method: init?.method,
      idempotencyKey: headers.get('Idempotency-Key'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return new Response(
      JSON.stringify({
        snapshot: snapshotResponse(),
        audit_event_id: 'AUD-20260808-0001',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const result = await realManualStop('回测验证完成，需对账')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'POST')
    assert.match(calls[0].url, /\/paper-trading\/stop$/)
    assert.ok(calls[0].idempotencyKey, 'Idempotency-Key must be sent')
    assert.match(calls[0].idempotencyKey, /^paper-stop-\d+-[a-f0-9]+$/)
    assert.equal(calls[0].body.reason, '回测验证完成，需对账')

    // Result mapping
    assert.equal(result.auditId, 'AUD-20260808-0001')
    assert.equal(result.snapshot.status, 'running')
    assert.equal(result.snapshot.account.marketValue, 3_720_000)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 4. Real listPaperOrders / listReconciliations: 分页参数
// ---------------------------------------------------------------------------

test('real listPaperOrders hits /paper-trading/orders with pagination params', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({
        items: [
          {
            id: 'PO-1',
            symbol: '600519.SH',
            direction: 'buy',
            quantity: 100,
            filled_quantity: 100,
            price: 1688.2,
            status: 'filled',
            submitted_at: '2026-08-08T09:31:00+08:00',
          },
        ],
        page: { next_cursor: 2, has_more: true },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const page = await realListPaperOrders({ pageSize: 50, cursor: 1 })

    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/orders\?/)
    assert.match(calls[0], /page_size=50/)
    assert.match(calls[0], /cursor=1/)

    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].direction, '买入')
    assert.equal(page.items[0].filledQuantity, 100)
    assert.equal(page.page.nextCursor, 2)
    assert.equal(page.page.hasMore, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listPaperOrders omits query string when no params', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({ items: [], page: { next_cursor: null, has_more: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    await realListPaperOrders()
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/orders$/)
    assert.doesNotMatch(calls[0], /\?/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listReconciliations hits /paper-trading/reconciliations', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({
        items: [
          {
            id: 'REC-0001',
            status: 'completed',
            result_status: 'difference',
            execution_status: 'completed',
            started_at: '2026-08-08T09:40:00+08:00',
            completed_at: '2026-08-08T09:42:00+08:00',
            checked_targets_count: 12,
            differences_count: 1,
            summary: '订单 PO-3 状态未知',
          },
        ],
        page: { next_cursor: null, has_more: false },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const page = await realListReconciliations({ pageSize: 20 })

    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/reconciliations\?page_size=20/)

    const run = page.items[0]
    assert.equal(run.id, 'REC-0001')
    assert.equal(run.status, 'difference')
    assert.equal(run.startedAt, '2026-08-08T09:40:00+08:00')
    assert.equal(run.completedAt, '2026-08-08T09:42:00+08:00')
    assert.equal(run.checkedTargetsCount, 12)
    assert.equal(run.differencesCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 5. Real getReconciliationDetail: 命中 /reconciliations/{id} 并映射差异项
// ---------------------------------------------------------------------------

test('real getReconciliationDetail maps run + discrepancy items', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({
        run: {
          id: 'REC-0001',
          status: 'completed',
          result_status: 'difference',
          execution_status: 'completed',
          started_at: '2026-08-08T09:40:00+08:00',
          completed_at: '2026-08-08T09:42:00+08:00',
          checked_targets_count: 12,
          differences_count: 1,
          summary: '订单 PO-3 状态未知',
        },
        items: [
          {
            target: '订单 PO-3',
            type: 'difference',
            local_value: 'unknown',
            remote_value: 'filled',
            difference: 'local vs remote mismatch',
            summary: '回报状态未知，等待对账确认',
            checked_at: '2026-08-08T09:41:00+08:00',
          },
          {
            target: '账户资金',
            type: 'matched',
            local_value: '6280000',
            remote_value: '6280000',
            difference: null,
            summary: '本地账本与沙箱账户一致',
            checked_at: '2026-08-08T09:41:00+08:00',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const detail = await realGetReconciliationDetail('REC-0001')

    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/reconciliations\/REC-0001$/)

    assert.equal(detail.run.id, 'REC-0001')
    assert.equal(detail.run.checkedTargetsCount, 12)

    assert.equal(detail.items.length, 2)
    assert.equal(detail.items[0].target, '订单 PO-3')
    assert.equal(detail.items[0].type, 'difference')
    assert.equal(detail.items[0].localValue, 'unknown')
    assert.equal(detail.items[0].remoteValue, 'filled')
    assert.equal(detail.items[0].difference, 'local vs remote mismatch')
    assert.equal(detail.items[1].difference, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 6. Real getDailyReport: 支持 date 参数
// ---------------------------------------------------------------------------

test('real getDailyReport omits query string without date', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({
        date: '2026-08-08',
        day_pnl: 18_600,
        day_pnl_pct: 0.19,
        turnover: 0.42,
        total_fees: 1234.56,
        filled_orders_count: 12,
        unknown_orders_count: 1,
        notes: '正常交易日',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const report = await realGetDailyReport()
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/daily-report$/)
    assert.doesNotMatch(calls[0], /\?/)

    assert.equal(report.date, '2026-08-08')
    assert.equal(report.dayPnl, 18_600)
    assert.equal(report.dayPnlPct, 0.19)
    assert.equal(report.turnover, 0.42)
    assert.equal(report.totalFees, 1234.56)
    assert.equal(report.filledOrdersCount, 12)
    assert.equal(report.unknownOrdersCount, 1)
    assert.equal(report.notes, '正常交易日')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real getDailyReport passes date param when provided', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({
        date: '2026-08-07',
        day_pnl: -3200,
        day_pnl_pct: -0.03,
        turnover: 0.18,
        total_fees: 240.0,
        filled_orders_count: 4,
        unknown_orders_count: 0,
        notes: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  try {
    const report = await realGetDailyReport('2026-08-07')
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/paper-trading\/daily-report\?date=2026-08-07$/)
    assert.equal(report.dayPnl, -3200)
    assert.equal(report.filledOrdersCount, 4)
    assert.equal(report.notes, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 7. Real 门面错误处理：网络错误不回退 mock，HTTP 错误以 ApiError 抛出
// ---------------------------------------------------------------------------

test('real getPaperTradingSnapshot surfaces network errors without falling back to mock', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }
  try {
    await assert.rejects(
      () => realGetSnapshot(),
      (error) => error?.code === 'NETWORK_ERROR',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real manualStopPaperTrading surfaces network errors without falling back to mock', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }
  try {
    await assert.rejects(
      () => realManualStop('reason'),
      (error) => error?.code === 'NETWORK_ERROR',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real listPaperOrders surfaces HTTP errors as ApiError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'auditor cannot list paper orders',
          request_id: 'rid-403',
        },
      }),
      { status: 403, headers: { 'X-Request-Id': 'rid-403' } },
    )
  try {
    await assert.rejects(
      () => realListPaperOrders(),
      (error) => error?.code === 'FORBIDDEN' && error?.requestId === 'rid-403',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('real getReconciliationDetail surfaces 404 as ApiError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 'RECONCILIATION_NOT_FOUND',
          message: 'reconciliation run not found',
          request_id: 'rid-404',
        },
      }),
      { status: 404, headers: { 'X-Request-Id': 'rid-404' } },
    )
  try {
    await assert.rejects(
      () => realGetReconciliationDetail('REC-missing'),
      (error) => error?.code === 'RECONCILIATION_NOT_FOUND',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 8. PaperTrading.tsx: isRealApiMode + lazy，不直接导入 mock
// ---------------------------------------------------------------------------

test('PaperTrading.tsx uses isRealApiMode + lazy, no direct mock imports', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/PaperTrading.tsx'),
    'utf8',
  )
  assert.match(source, /isRealApiMode/, 'must use isRealApiMode')
  assert.match(source, /lazy\(\(\) => import\(/, 'must lazy-load sub-pages')
  assert.match(source, /Suspense/, 'must wrap in Suspense')
  assert.match(source, /PaperTradingMock/, 'must lazy-import PaperTradingMock')
  assert.match(source, /PaperTradingReal/, 'must lazy-import PaperTradingReal')
  assert.doesNotMatch(source, /api\/mock\//, 'must not import mock directly')
})

// ---------------------------------------------------------------------------
// 9. PaperTradingReal.tsx: 使用 real API、保留隔离 Alert
// ---------------------------------------------------------------------------

test('PaperTradingReal.tsx uses real API facades and isolation warning', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/PaperTradingReal.tsx'),
    'utf8',
  )
  assert.match(source, /from '@\/api\/paperTrading'/, 'must import from real API')
  assert.match(source, /getPaperTradingSnapshot/, 'must use snapshot facade')
  assert.match(source, /manualStopPaperTrading/, 'must use manual stop facade')
  assert.match(source, /listReconciliations/, 'must use reconciliation list facade')
  assert.match(source, /getReconciliationDetail/, 'must use reconciliation detail facade')
  assert.match(source, /getDailyReport/, 'must use daily report facade')
  assert.doesNotMatch(source, /api\/mock\//, 'must not import mock directly')
  // Isolation warning Alert kept
  assert.match(source, /与真实账户、券商、下单接口完全隔离/, 'must keep isolation Alert')
  // 人工停机 button present
  assert.match(source, /人工停机/, 'must keep manual stop button')
  assert.match(source, /value === null \? '市价'/, 'must display nullable market order price as 市价')
  assert.match(source, /: '—'/, 'must display nullable submitted time as —')
  // Expandable reconciliation detail
  assert.match(source, /expandedRowRender/, 'must render expanded discrepancy detail')
})

// ---------------------------------------------------------------------------
// 10. PaperTradingMock.tsx: 保留 mock 门面与原 UI
// ---------------------------------------------------------------------------

test('PaperTradingMock.tsx preserves mock facade and original UI', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/pages/PaperTradingMock.tsx'),
    'utf8',
  )
  assert.match(source, /from '@\/api\/mock\/paperTrading'/, 'must use mock facade')
  assert.match(source, /getPaperTradingSnapshot/, 'must use getPaperTradingSnapshot')
  assert.match(source, /manualStopPaperTrading/, 'must use manualStopPaperTrading')
  // Isolation warning Alert kept
  assert.match(
    source,
    /当前仅为模拟盘演示数据，不连接真实账户、券商或下单接口/,
    'must keep mock isolation Alert',
  )
  assert.match(source, /人工停机/, 'must keep manual stop button')
  assert.doesNotMatch(source, /api\/paperTrading'/, 'must not import real facade')
})

// ---------------------------------------------------------------------------
// 11. paperTrading.ts 模块结构与类型导出
// ---------------------------------------------------------------------------

test('paperTrading.ts exports required types and functions', async () => {
  const realServer = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    const api = await realServer.ssrLoadModule('/src/api/paperTrading.ts')
    for (const fn of [
      'getPaperTradingSnapshot',
      'manualStopPaperTrading',
      'listPaperOrders',
      'listReconciliations',
      'getReconciliationDetail',
      'getDailyReport',
    ]) {
      assert.equal(typeof api[fn], 'function', `${fn} must be a function`)
    }
  } finally {
    await realServer.close()
  }

  const source = readFileSync(
    resolve(frontendRoot, 'src/api/paperTrading.ts'),
    'utf8',
  )
  for (const iface of [
    'PaperTradingSnapshot',
    'PaperOrder',
    'PaperPosition',
    'ManualStopResult',
    'ReconciliationRun',
    'ReconciliationDetail',
    'ReconciliationDiscrepancy',
    'PaperOrdersPage',
    'ReconciliationsPage',
    'DailyReport',
  ]) {
    assert.match(source, new RegExp(`export interface ${iface}`), `must export ${iface}`)
  }

  // snake_case → camelCase mapping must be explicit (no auto-camel library)
  assert.match(source, /market_value/, 'must reference snake_case market_value')
  assert.match(source, /marketValue/, 'must produce camelCase marketValue')
  assert.match(source, /submitted_at/, 'must reference snake_case submitted_at')
  assert.match(source, /submittedAt/, 'must produce camelCase submittedAt')

  // Direction translation must be explicit
  assert.match(source, /'buy' | 'sell'/, 'raw direction type must be buy/sell')
  assert.match(source, /'买入' | '卖出'/, 'mapped direction type must be 买入/卖出')
})

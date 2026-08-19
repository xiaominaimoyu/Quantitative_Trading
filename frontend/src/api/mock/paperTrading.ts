/** 模拟盘 Mock：仅展示沙箱状态，不连接真实交易接口。 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'

export type PaperOrderStatus = 'accepted' | 'partial' | 'filled' | 'unknown' | 'rejected'

export interface PaperPosition {
  symbol: string
  name: string
  quantity: number
  marketValue: number
  pnl: number
  pnlPct: number
}

export interface PaperOrder {
  id: string
  symbol: string
  direction: '买入' | '卖出'
  quantity: number
  filledQuantity: number
  price: number
  status: PaperOrderStatus
  submittedAt: string
}

export interface ReconciliationItem {
  id: string
  type: 'matched' | 'difference'
  target: string
  summary: string
  checkedAt: string
}

export interface PaperTradingSnapshot {
  status: 'running' | 'stopped'
  account: { total: number; available: number; marketValue: number; dayPnl: number; dayPnlPct: number }
  positions: PaperPosition[]
  orders: PaperOrder[]
  reconciliations: ReconciliationItem[]
  updatedAt: string
}

let MOCK_SNAPSHOT: PaperTradingSnapshot = {
  status: 'running',
  account: { total: 10_000_000, available: 6_280_000, marketValue: 3_720_000, dayPnl: 18_600, dayPnlPct: 0.19 },
  positions: [
    { symbol: '600519.SH', name: '贵州茅台', quantity: 1200, marketValue: 2_025_840, pnl: 32_400, pnlPct: 1.62 },
    { symbol: '000858.SZ', name: '五粮液', quantity: 8000, marketValue: 1_694_160, pnl: -13_800, pnlPct: -0.81 },
  ],
  orders: [
    { id: 'PO-20260808-0001', symbol: '600519.SH', direction: '买入', quantity: 1200, filledQuantity: 1200, price: 1688.2, status: 'filled', submittedAt: '2026-08-08T09:31:00+08:00' },
    { id: 'PO-20260808-0002', symbol: '300750.SZ', direction: '买入', quantity: 500, filledQuantity: 200, price: 188.6, status: 'partial', submittedAt: '2026-08-08T09:32:00+08:00' },
    { id: 'PO-20260808-0003', symbol: '601318.SH', direction: '卖出', quantity: 1500, filledQuantity: 0, price: 42.18, status: 'unknown', submittedAt: '2026-08-08T09:35:00+08:00' },
  ],
  reconciliations: [
    { id: 'REC-0001', type: 'matched', target: '账户资金', summary: '本地账本与沙箱账户一致', checkedAt: '2026-08-08T09:40:00+08:00' },
    { id: 'REC-0002', type: 'difference', target: '订单 PO-20260808-0003', summary: '回报状态未知，等待对账确认', checkedAt: '2026-08-08T09:40:00+08:00' },
  ],
  updatedAt: '2026-08-08T09:40:00+08:00',
}

export function getPaperTradingSnapshot(options?: MockRequestOptions): Promise<PaperTradingSnapshot> {
  return mockRequest(
    () => ({
      ...MOCK_SNAPSHOT,
      account: { ...MOCK_SNAPSHOT.account },
      positions: MOCK_SNAPSHOT.positions.map((position) => ({ ...position })),
      orders: MOCK_SNAPSHOT.orders.map((order) => ({ ...order })),
      reconciliations: MOCK_SNAPSHOT.reconciliations.map((item) => ({ ...item })),
    }),
    options,
  )
}

export function manualStopPaperTrading(
  reason: string,
  options?: MockRequestOptions,
): Promise<{ snapshot: PaperTradingSnapshot; auditId: string }> {
  return mockRequest(
    () => {
      if (!reason.trim()) {
        throw new ApiError({
          code: 'PAPER-400',
          message: '人工停机必须填写原因',
          requestId: generateRequestId(),
        })
      }
      MOCK_SNAPSHOT = { ...MOCK_SNAPSHOT, status: 'stopped', updatedAt: new Date().toISOString() }
      return {
        snapshot: MOCK_SNAPSHOT,
        auditId: `AUD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-PAPER`,
      }
    },
    options,
  )
}

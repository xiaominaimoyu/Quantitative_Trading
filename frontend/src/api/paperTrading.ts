/**
 * G5 模拟盘 real API 客户端。
 *
 * 后端端点（paper_trading.py）：
 * - GET  /paper-trading/snapshot             → PaperTradingSnapshotOut（账户 + 订单 + 持仓）
 * - POST /paper-trading/stop                  → PaperStopMutationOut（人工停机，admin）
 * - GET  /paper-trading/orders                → PaperOrderPageOut（分页订单）
 * - GET  /paper-trading/reconciliations       → ReconciliationRunPageOut（对账批次）
 * - GET  /paper-trading/reconciliations/{id}  → ReconciliationRunDetailOut（对账明细）
 * - GET  /paper-trading/daily-report          → DailyReportOut（每日报告摘要）
 *
 * Real 模式专用；mock 模式继续使用 api/mock/paperTrading.ts。
 *
 * 与 mock 的差异：
 * - 真实端点用 snake_case 字段，本模块统一映射为 camelCase；
 * - 订单方向后端用 'buy' / 'sell'，UI 仍期望 '买入' / '卖出'，本模块显式翻译；
 * - 对账分两个端点：列表（批次）与详情（差异项），快照不再内嵌对账。
 * - 错误一律以 ApiError 抛出，绝不回退到 mock。
 */
import { apiRequest } from './http.ts'
import { mutationInit } from './research/http.ts'

/** 与 mock 共享的订单状态词表。 */
export type PaperOrderStatus = 'accepted' | 'partial' | 'filled' | 'unknown' | 'rejected'

/** 订单方向：UI 仍以中文展示，real facade 负责将后端 'buy'/'sell' 翻译为 '买入'/'卖出'。 */
export type PaperOrderDirection = '买入' | '卖出'

export type PaperTradingStatus = 'running' | 'stopped'

export type ReconciliationRunStatus = 'matched' | 'difference' | 'unknown'

/** 单个对账项的结论（与 mock 的 ReconciliationItem.type 一致）。 */
export type ReconciliationItemType = 'matched' | 'difference'

/** 分页游标信息。 */
export interface PageInfo {
  nextCursor: number | null
  hasMore: boolean
}

export interface PaperTradingAccount {
  total: number
  available: number
  marketValue: number
  dayPnl: number
  dayPnlPct: number
}

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
  direction: PaperOrderDirection
  quantity: number
  filledQuantity: number
  price: number
  status: PaperOrderStatus
  submittedAt: string
}

/** 模拟盘整体快照：账户 + 持仓 + 最近订单（与 mock 字段对齐，但不含对账）。 */
export interface PaperTradingSnapshot {
  status: PaperTradingStatus
  account: PaperTradingAccount
  positions: PaperPosition[]
  orders: PaperOrder[]
  updatedAt: string
}

/** 人工停机返回：最新快照 + 审计事件编号。 */
export interface ManualStopResult {
  snapshot: PaperTradingSnapshot
  auditId: string
}

/** 订单分页结果。 */
export interface PaperOrdersPage {
  items: PaperOrder[]
  page: PageInfo
}

/** 对账批次摘要（来自 /reconciliations 列表端点）。 */
export interface ReconciliationRun {
  id: string
  status: ReconciliationRunStatus
  startedAt: string
  completedAt: string | null
  checkedTargetsCount: number
  differencesCount: number
  summary: string
}

/** 对账差异项（来自 /reconciliations/{id} 详情端点的展开内容）。 */
export interface ReconciliationDiscrepancy {
  target: string
  type: ReconciliationItemType
  localValue: string | null
  remoteValue: string | null
  difference: string | null
  summary: string
  checkedAt: string
}

/** 对账批次详情：批次元信息 + 差异项列表。 */
export interface ReconciliationDetail {
  run: ReconciliationRun
  items: ReconciliationDiscrepancy[]
}

/** 对账批次分页结果。 */
export interface ReconciliationsPage {
  items: ReconciliationRun[]
  page: PageInfo
}

/** 每日报告摘要。 */
export interface DailyReport {
  date: string
  dayPnl: number
  dayPnlPct: number
  turnover: number
  totalFees: number
  filledOrdersCount: number
  unknownOrdersCount: number
  notes: string | null
}

// ---------------------------------------------------------------------------
// 后端原始响应类型（snake_case）。仅供本模块内部使用。
// ---------------------------------------------------------------------------

interface RawPaperTradingAccount {
  total: number
  available: number
  market_value: number
  day_pnl: number
  day_pnl_pct: number
}

interface RawPaperPosition {
  symbol: string
  name: string
  quantity: number
  market_value: number
  pnl: number
  pnl_pct: number
}

interface RawPaperOrder {
  id: string
  symbol: string
  direction: 'buy' | 'sell'
  quantity: number
  filled_quantity: number
  price: number
  status: PaperOrderStatus
  submitted_at: string
}

interface RawReconciliationItem {
  target: string
  type: ReconciliationItemType
  local_value: string | null
  remote_value: string | null
  difference: string | null
  summary: string
  checked_at: string
}

interface RawPaperTradingSnapshot {
  status: PaperTradingStatus
  account: RawPaperTradingAccount
  positions: RawPaperPosition[]
  orders: RawPaperOrder[]
  updated_at: string
}

interface RawPaperStopMutation {
  snapshot: RawPaperTradingSnapshot
  audit_event_id: string
}

interface RawPageInfo {
  next_cursor: number | null
  has_more: boolean
}

interface RawPaperOrdersPage {
  items: RawPaperOrder[]
  page: RawPageInfo
}

interface RawReconciliationRun {
  id: string
  status: ReconciliationRunStatus
  started_at: string
  completed_at: string | null
  checked_targets_count: number
  differences_count: number
  summary: string
}

interface RawReconciliationRunDetail {
  run: RawReconciliationRun
  items: RawReconciliationItem[]
}

interface RawReconciliationsPage {
  items: RawReconciliationRun[]
  page: RawPageInfo
}

interface RawDailyReport {
  date: string
  day_pnl: number
  day_pnl_pct: number
  turnover: number
  total_fees: number
  filled_orders_count: number
  unknown_orders_count: number
  notes: string | null
}

// ---------------------------------------------------------------------------
// 映射：snake_case → camelCase；后端 'buy'/'sell' → UI '买入'/'卖出'。
// ---------------------------------------------------------------------------

function mapDirection(raw: 'buy' | 'sell'): PaperOrderDirection {
  return raw === 'buy' ? '买入' : '卖出'
}

function mapPaperTradingAccount(raw: RawPaperTradingAccount): PaperTradingAccount {
  return {
    total: raw.total,
    available: raw.available,
    marketValue: raw.market_value,
    dayPnl: raw.day_pnl,
    dayPnlPct: raw.day_pnl_pct,
  }
}

function mapPaperPosition(raw: RawPaperPosition): PaperPosition {
  return {
    symbol: raw.symbol,
    name: raw.name,
    quantity: raw.quantity,
    marketValue: raw.market_value,
    pnl: raw.pnl,
    pnlPct: raw.pnl_pct,
  }
}

function mapPaperOrder(raw: RawPaperOrder): PaperOrder {
  return {
    id: raw.id,
    symbol: raw.symbol,
    direction: mapDirection(raw.direction),
    quantity: raw.quantity,
    filledQuantity: raw.filled_quantity,
    price: raw.price,
    status: raw.status,
    submittedAt: raw.submitted_at,
  }
}

function mapPageInfo(raw: RawPageInfo): PageInfo {
  return {
    nextCursor: raw.next_cursor,
    hasMore: raw.has_more,
  }
}

function mapPaperTradingSnapshot(raw: RawPaperTradingSnapshot): PaperTradingSnapshot {
  return {
    status: raw.status,
    account: mapPaperTradingAccount(raw.account),
    positions: raw.positions.map(mapPaperPosition),
    orders: raw.orders.map(mapPaperOrder),
    updatedAt: raw.updated_at,
  }
}

function mapReconciliationRun(raw: RawReconciliationRun): ReconciliationRun {
  return {
    id: raw.id,
    status: raw.status,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    checkedTargetsCount: raw.checked_targets_count,
    differencesCount: raw.differences_count,
    summary: raw.summary,
  }
}

function mapReconciliationDiscrepancy(raw: RawReconciliationItem): ReconciliationDiscrepancy {
  return {
    target: raw.target,
    type: raw.type,
    localValue: raw.local_value,
    remoteValue: raw.remote_value,
    difference: raw.difference,
    summary: raw.summary,
    checkedAt: raw.checked_at,
  }
}

function mapReconciliationDetail(raw: RawReconciliationRunDetail): ReconciliationDetail {
  return {
    run: mapReconciliationRun(raw.run),
    items: raw.items.map(mapReconciliationDiscrepancy),
  }
}

function mapDailyReport(raw: RawDailyReport): DailyReport {
  return {
    date: raw.date,
    dayPnl: raw.day_pnl,
    dayPnlPct: raw.day_pnl_pct,
    turnover: raw.turnover,
    totalFees: raw.total_fees,
    filledOrdersCount: raw.filled_orders_count,
    unknownOrdersCount: raw.unknown_orders_count,
    notes: raw.notes,
  }
}

interface ListPageParams {
  pageSize?: number
  cursor?: number
}

function pageQuery(params: ListPageParams | undefined): string {
  if (!params) return ''
  const search = new URLSearchParams()
  if (params.pageSize !== undefined) search.set('page_size', String(params.pageSize))
  if (params.cursor !== undefined) search.set('cursor', String(params.cursor))
  const text = search.toString()
  return text ? `?${text}` : ''
}

// ---------------------------------------------------------------------------
// Real API 函数。失败时直接抛 ApiError，绝不回退到 mock。
// ---------------------------------------------------------------------------

/** 拉取模拟盘当前快照（账户 + 持仓 + 最近订单）。 */
export async function getPaperTradingSnapshot(): Promise<PaperTradingSnapshot> {
  const raw = await apiRequest<RawPaperTradingSnapshot>('/paper-trading/snapshot')
  return mapPaperTradingSnapshot(raw)
}

/**
 * 人工停机（admin only）。
 *
 * 后端要求 Idempotency-Key 头部以便重复请求安全；调用方应保证 key 唯一，
 * 这里以「paper-stop-{timestamp}-{随机}」生成，确保每次点击都是独立请求，
 * 但同一按钮触发不会自动重放。
 */
export async function manualStopPaperTrading(reason: string): Promise<ManualStopResult> {
  const idempotencyKey = `paper-stop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const raw = await apiRequest<RawPaperStopMutation>(
    '/paper-trading/stop',
    mutationInit({ reason }, idempotencyKey),
  )
  return {
    snapshot: mapPaperTradingSnapshot(raw.snapshot),
    auditId: raw.audit_event_id,
  }
}

/** 分页列出订单。 */
export async function listPaperOrders(
  params?: ListPageParams,
): Promise<PaperOrdersPage> {
  const raw = await apiRequest<RawPaperOrdersPage>(
    `/paper-trading/orders${pageQuery(params)}`,
  )
  return {
    items: raw.items.map(mapPaperOrder),
    page: mapPageInfo(raw.page),
  }
}

/** 分页列出对账批次。 */
export async function listReconciliations(
  params?: ListPageParams,
): Promise<ReconciliationsPage> {
  const raw = await apiRequest<RawReconciliationsPage>(
    `/paper-trading/reconciliations${pageQuery(params)}`,
  )
  return {
    items: raw.items.map(mapReconciliationRun),
    page: mapPageInfo(raw.page),
  }
}

/** 获取对账批次详情（含差异项）。 */
export async function getReconciliationDetail(
  id: string,
): Promise<ReconciliationDetail> {
  const raw = await apiRequest<RawReconciliationRunDetail>(
    `/paper-trading/reconciliations/${encodeURIComponent(id)}`,
  )
  return mapReconciliationDetail(raw)
}

/** 获取每日报告摘要；date 为 YYYY-MM-DD，省略表示最新。 */
export async function getDailyReport(date?: string): Promise<DailyReport> {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  const raw = await apiRequest<RawDailyReport>(`/paper-trading/daily-report${query}`)
  return mapDailyReport(raw)
}

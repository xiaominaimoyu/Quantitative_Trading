/**
 * 共享组件统一出口。
 *
 * 全部为命名导出（配合 TS 严格 + 按需导入）；
 * 页面级组件（各 Route 的 default export）不在此列。
 */

export { default as StatusTag } from './StatusTag'
export { default as MarketValue } from './MarketValue'
export { default as MetricCard } from './MetricCard'
export { default as ChartPanel } from './ChartPanel'
export { default as PageHeader } from './PageHeader'
export { default as LineageChain } from './LineageChain'
export { default as ConfirmModal } from './ConfirmModal'
export { default as CopyableId } from './CopyableId'
export { generateAuditId } from './ConfirmModal'
export * from './task-center'

export * from './page-state'

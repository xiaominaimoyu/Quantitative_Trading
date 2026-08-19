/**
 * 审计日志 facade：real 模式调用 B5 `/audit-events`，mock 模式回退到本地样本。
 * 统一返回 AuditLogEntry（页面消费的稳定形状），屏蔽 B5 AuditEvent 与 mock 之间的 schema 差异。
 */
import { API_MODE } from './config.ts'
import * as mock from './mock/audit.ts'
import * as real from './b5/real.ts'

export interface AuditLogEntry {
  id: string
  timestamp: string
  actor: string
  action: string
  target: string
  relatedId: string
  summary: string
}

export interface AuditLogQuery {
  actorKey?: string
  action?: string
  target?: string
  since?: string
  until?: string
  page?: number
  pageSize?: number
}

const useReal = API_MODE === 'real'

function summarize(action: string, target: string, reason: string | null): string {
  if (reason) return reason
  if (target) return `${action} · ${target}`
  return action
}

export async function listAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
  if (useReal) {
    const paged = await real.listAuditEvents({
      actorKey: query.actorKey || undefined,
      action: query.action || undefined,
      target: query.target || undefined,
      since: query.since,
      until: query.until,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    })
    return paged.items.map((event) => ({
      id: event.id,
      timestamp: event.createdAt,
      actor: event.actorKey,
      action: event.action,
      target: event.target,
      relatedId: event.businessId || event.requestId || '',
      summary: summarize(event.action, event.target, event.reason),
    }))
  }
  return mock.listAuditLogs()
}

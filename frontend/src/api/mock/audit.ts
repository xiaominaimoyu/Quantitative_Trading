/**
 * 审计日志 Mock。
 */

import { mockRequest, type MockRequestOptions } from '@/api/client'

export interface AuditLogEntry {
  id: string
  timestamp: string
  actor: string
  action: string
  target: string
  relatedId: string
  summary: string
}

const MOCK_AUDIT: AuditLogEntry[] = [
  {
    id: 'AUD-20260808-0001',
    timestamp: '2026-08-08T10:24:00+08:00',
    actor: '陈默',
    action: '提交实验',
    target: '实验 exp-momentum-0043',
    relatedId: 'R-0050',
    summary: '预注册协议已冻结，运行已排队',
  },
  {
    id: 'AUD-20260805-0012',
    timestamp: '2026-08-05T15:00:00+08:00',
    actor: '审计员',
    action: '批准报告',
    target: '报告 RP-0101',
    relatedId: 'RP-0101',
    summary: '报告已批准，阅读者可见',
  },
  {
    id: 'AUD-20260801-0008',
    timestamp: '2026-08-01T09:30:00+08:00',
    actor: '陈默',
    action: '创建策略版本',
    target: 'st-momentum-v3',
    relatedId: 'st-momentum-v2',
    summary: '基于已冻结版本 v2 创建草稿 v3',
  },
  {
    id: 'AUD-20260728-0003',
    timestamp: '2026-07-28T16:00:00+08:00',
    actor: '陈默',
    action: '冻结实验协议',
    target: 'exp-momentum-0042',
    relatedId: 'exp-momentum-0042',
    summary: '预注册协议已冻结，不可修改',
  },
]

export function listAuditLogs(options?: MockRequestOptions): Promise<AuditLogEntry[]> {
  return mockRequest(
    () => MOCK_AUDIT.map((e) => ({ ...e })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    options,
  )
}

/**
 * 报告 Mock：列表与详情（研究版 / 阅读版结构化内容）。
 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'

export type ReportStatus = 'draft' | 'pending_approval' | 'approved' | 'archived'

export interface ReportSummary {
  id: string
  title: string
  experimentId: string
  runId: string
  status: ReportStatus
  dataCutoff: string
  approver?: string
  approvedAt?: string
  updatedAt: string
}

export interface ReportSection {
  type: 'facts' | 'inference' | 'attribution' | 'counter' | 'risk'
  title: string
  items: Array<{ text: string; source?: string; sourceLink?: string }>
}

export interface ReportDetail extends ReportSummary {
  universe: string
  timeSpan: string
  lineage: string
  sections: ReportSection[]
  contentHash: string
}

const MOCK_REPORTS: ReportDetail[] = [
  {
    id: 'RP-0101',
    title: '动量因子样本外验证',
    experimentId: 'exp-momentum-0042',
    runId: 'R-0041',
    status: 'approved',
    dataCutoff: '2026-07-31',
    approver: '审计员',
    approvedAt: '2026-08-05T15:00:00+08:00',
    updatedAt: '2026-08-05T14:30:00+08:00',
    universe: '沪深300 成分',
    timeSpan: '2015–2025',
    lineage: '数据 v3 › 运行 R-0041 › 报告 RP-0101',
    contentHash: '9f2e8a1b',
    sections: [
      {
        type: 'facts',
        title: '可核验事实',
        items: [
          { text: '回测覆盖 2,432 个交易日', source: '数据 v3', sourceLink: '/datasets/ds-ashare/versions/ds-ashare-v3' },
          { text: '共 1,204 笔成交，费用合计 1.82%', source: 'R-0041', sourceLink: '/experiments/exp-momentum-0042/runs/R-0041' },
        ],
      },
      {
        type: 'inference',
        title: '模型推断',
        items: [
          { text: '信号与未来 5 日收益呈弱正相关（区间 0.02–0.08，非点估计）' },
          { text: '历史校准：覆盖率 92%（目标 90%）· 校准误差 0.03' },
        ],
      },
      {
        type: 'attribution',
        title: '主要驱动',
        items: [
          { text: '＋ 20 日动量、换手率变化' },
          { text: '－ 波动率突增' },
        ],
      },
      {
        type: 'counter',
        title: '相反证据与适用限制',
        items: [
          { text: '2020 年后效应减弱；成本加倍后增量消失' },
          { text: '不适用于小盘股与复牌首日' },
        ],
      },
      {
        type: 'risk',
        title: '风险提示与禁止用途',
        items: [
          { text: '本报告为研究结果，不构成投资建议，不承诺任何收益。' },
          { text: '禁止用于实盘交易决策或对外营销。' },
        ],
      },
    ],
  },
  {
    id: 'RP-0098',
    title: '价值因子季度再平衡',
    experimentId: 'exp-value-0012',
    runId: 'R-0030',
    status: 'pending_approval',
    dataCutoff: '2026-06-30',
    updatedAt: '2026-07-18T10:00:00+08:00',
    universe: '中证500',
    timeSpan: '2015–2025',
    lineage: '数据 v2 › 运行 R-0030 › 报告 RP-0098',
    contentHash: '3c7d1e9f',
    sections: [
      {
        type: 'facts',
        title: '可核验事实',
        items: [{ text: '回测覆盖 2,180 个交易日', source: '数据 v2' }],
      },
      {
        type: 'inference',
        title: '模型推断',
        items: [{ text: '低估值因子在样本外仍具统计显著性（p < 0.05）' }],
      },
      {
        type: 'risk',
        title: '风险提示与禁止用途',
        items: [{ text: '本报告为研究结果，不构成投资建议。' }],
      },
    ],
  },
]

let reportAuditSeq = 1

function generateReportAuditId(date = new Date()): string {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AUD-${ymd}-${String(reportAuditSeq++).padStart(4, '0')}`
}

function copyReport(report: ReportDetail): ReportDetail {
  return {
    ...report,
    sections: report.sections.map((s) => ({
      ...s,
      items: s.items.map((i) => ({ ...i })),
    })),
  }
}

export function listReports(options?: MockRequestOptions): Promise<ReportSummary[]> {
  return mockRequest(
    () =>
      MOCK_REPORTS.map(({ sections: _s, ...r }) => ({ ...r })).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    options,
  )
}

export function getReport(id: string, options?: MockRequestOptions): Promise<ReportDetail> {
  return mockRequest(
    () => {
      const report = MOCK_REPORTS.find((r) => r.id === id)
      if (!report) {
        throw new ApiError({
          code: 'IR-0404',
          message: `报告不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      return copyReport(report)
    },
    options,
  )
}

/** 批准待审核报告，并返回审计编号。 */
export function approveReport(
  id: string,
  actor: string,
  reason: string,
  options?: MockRequestOptions,
): Promise<{ report: ReportDetail; auditId: string }> {
  return mockRequest(
    () => {
      const report = MOCK_REPORTS.find((r) => r.id === id)
      if (!report) {
        throw new ApiError({
          code: 'IR-0404',
          message: `报告不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      if (report.status !== 'pending_approval') {
        throw new ApiError({
          code: 'RPT-409',
          message: '只有待批准报告可以执行批准操作',
          requestId: generateRequestId(),
        })
      }
      if (!reason.trim()) {
        throw new ApiError({
          code: 'RPT-400',
          message: '批准操作必须填写原因',
          requestId: generateRequestId(),
        })
      }

      const now = new Date().toISOString()
      report.status = 'approved'
      report.approver = actor
      report.approvedAt = now
      report.updatedAt = now
      return { report: copyReport(report), auditId: generateReportAuditId() }
    },
    options,
  )
}

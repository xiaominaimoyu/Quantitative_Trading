/** 报告详情：研究版 / 阅读版（B5 ReportContent 五分区） */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Dropdown, Radio, Result, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  exportReport,
  getReport,
  listReportRuns,
  reportAction,
} from '@/api/reports'
import type { ReportBlock, ReportPartition } from '@/api/b5/types'
import { useAuth } from '@/app/AuthContext'
import { ConfirmModal, CopyableId, LineageChain, PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

type ReportView = 'reader' | 'research'
type ExportFormat = 'json' | 'markdown' | 'html'

/** B5 五分区：事实 / 推断 / 不确定性 / 来源 / 限制 */
const PARTITION_STYLE: Record<ReportPartition, { border: string; background: string }> = {
  facts: { border: '#1677FF', background: 'rgba(22,119,255,0.04)' },
  inference: { border: '#D48806', background: 'rgba(212,136,6,0.06)' },
  uncertainty: { border: '#722ED1', background: 'rgba(114,46,209,0.05)' },
  sources: { border: '#389E0D', background: 'rgba(56,158,13,0.04)' },
  limits: { border: '#CF1322', background: 'rgba(207,19,34,0.04)' },
}

const PARTITION_BADGE: Record<ReportPartition, string> = {
  facts: '事实',
  inference: '推断 ≠ 事实',
  uncertainty: '不确定性',
  sources: '来源',
  limits: '相反证据与限制',
}

const PARTITION_ORDER: ReportPartition[] = ['facts', 'inference', 'uncertainty', 'sources', 'limits']

function partitionRank(p: ReportPartition): number {
  const idx = PARTITION_ORDER.indexOf(p)
  return idx === -1 ? PARTITION_ORDER.length : idx
}

function blocksMarkdown(title: string, dataCutoff: string, universe: string[], blocks: ReportBlock[]): string {
  const body = blocks
    .map((b) => `## ${PARTITION_BADGE[b.partition]}\n\n${b.bodyMd || '- 证据不足，不生成结论'}`)
    .join('\n\n')
  return `# ${title}\n\n数据截止：${dataCutoff}\n适用范围：${universe.join('、')}\n\n${body}\n`
}

function downloadBlob(content: string, format: ExportFormat, id: string) {
  const mime = format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown'
  const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${id}.${ext}`
  anchor.click()
  URL.revokeObjectURL(url)
}

function BlockCard({ block, researchView }: { block: ReportBlock; researchView: boolean }) {
  const style = PARTITION_STYLE[block.partition]
  return (
    <Card
      size="small"
      title={
        <Space>
          <span>{PARTITION_BADGE[block.partition]}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {block.partition}
          </Typography.Text>
        </Space>
      }
      style={{ borderInlineStart: `4px solid ${style.border}`, background: style.background }}
      styles={{ body: { padding: researchView ? 16 : '20px 24px' } }}
    >
      {block.bodyMd ? (
        <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{block.bodyMd}</Typography.Paragraph>
      ) : (
        <Typography.Text type="warning">证据不足，不生成结论</Typography.Text>
      )}
      {researchView ? (
        <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            模型版本：{block.modelVersionSha256 ? <CopyableId id={block.modelVersionSha256} maxLength={12} /> : '—'}
          </Typography.Text>
          {block.sources.length > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              来源：{block.sources.map((s, i) => (
                <span key={i}>
                  {s.uri ? <Link to={s.uri}>{s.label}</Link> : s.label}
                  {i < block.sources.length - 1 ? '、' : ''}
                </span>
              ))}
            </Typography.Text>
          ) : null}
        </Space>
      ) : null}
    </Card>
  )
}

export default function ReportDetailPage() {
  const { reportId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [actionModal, setActionModal] = useState<null | 'submit' | 'approve' | 'deprecate'>(null)
  const queryClient = useQueryClient()
  const auth = useAuth()
  const view: ReportView = params.get('view') === 'research' ? 'research' : 'reader'

  const canRead = auth.hasScope('report:read')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId),
    enabled: !!reportId && canRead,
  })
  const { data: runLinks } = useQuery({
    queryKey: ['reportRuns', reportId],
    queryFn: () => listReportRuns(reportId),
    enabled: !!reportId && canRead,
  })

  if (!canRead) {
    return <Result status="403" title="权限不足" subTitle="报告详情仅对具备 report:read 权限的角色开放。" />
  }
  if (isLoading) return <PageLoading rows={10} />
  if (error) return <PageError error={error} retry={() => void refetch()} />
  if (!data) return null

  const { report, content, contentSha256, experimentId } = data
  const sortedBlocks = [...content.blocks].sort((a, b) => partitionRank(a.partition) - partitionRank(b.partition))
  const primaryRun = runLinks?.[0]?.runId ?? ''

  const canSubmit = report.status === 'draft' && auth.hasScope('report:submit')
  const canApprove = report.status === 'submitted' && auth.hasScope('report:approve')
  const canDeprecate = (report.status === 'approved' || report.status === 'submitted') && auth.hasScope('report:deprecate')

  const exportMenuItems: MenuProps['items'] = [
    { key: 'markdown', label: '导出 Markdown' },
    { key: 'html', label: '导出 HTML' },
    { key: 'json', label: '导出 JSON' },
  ]

  const onViewChange = (nextView: ReportView) => {
    const next = new URLSearchParams(params)
    next.set('view', nextView)
    setParams(next)
  }

  const onExport: MenuProps['onClick'] = async ({ key }) => {
    const format = key as ExportFormat
    try {
      const result = await exportReport(report.id, { format, includeLineage: view === 'research' }, crypto.randomUUID())
      // 真实模式返回产物句柄；此处仍生成本地预览副本以便即时查看
      const md = blocksMarkdown(content.title, content.dataCutoff, content.applicableUniverse, sortedBlocks)
      const body =
        format === 'json'
          ? JSON.stringify({ report, content, artifactId: result.artifactId }, null, 2)
          : format === 'html'
            ? `<article><h1>${content.title}</h1><pre>${md.replaceAll('<', '&lt;')}</pre></article>`
            : md
      downloadBlob(body, format, report.id)
    } catch {
      const md = blocksMarkdown(content.title, content.dataCutoff, content.applicableUniverse, sortedBlocks)
      downloadBlob(md, format, report.id)
    }
  }

  const actionLabels = {
    submit: { title: '提交报告审批', desc: '提交后报告进入待批准状态，审计员可批准或驳回。该操作会写入审计日志。', confirm: '提交并留痕', danger: false },
    approve: { title: '批准研究报告', desc: '批准后报告可进入阅读版并对有权限的阅读者可见。该操作会写入审计日志。', confirm: '批准并留痕', danger: true },
    deprecate: { title: '停用报告', desc: '停用后报告不再对外可见。该操作会写入审计日志。', confirm: '停用并留痕', danger: true },
  } as const

  const lineageItems = [
    { key: 'experiment', label: `实验 ${experimentId}`, to: `/experiments/${experimentId}` },
    ...(primaryRun ? [{ key: 'run', label: `运行 ${primaryRun}`, to: `/experiments/${experimentId}/runs/${primaryRun}` }] : []),
    { key: 'report', label: `报告 ${report.id}`, disabled: true },
  ]

  return (
    <div>
      <PageHeader
        title={content.title}
        subtitle="结构化研究报告：事实、推断、不确定性、来源与限制"
        meta={[
          <CopyableId key="id" id={report.id} maxLength={0} />,
          <StatusTag key="status" status={report.status} domain="report" />,
          `数据截止 ${content.dataCutoff}`,
        ]}
        extra={
          <Space wrap>
            <Radio.Group
              size="small"
              value={view}
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: '阅读版', value: 'reader' },
                { label: '研究版', value: 'research' },
              ]}
              onChange={(e) => onViewChange(e.target.value as ReportView)}
            />
            <Dropdown menu={{ items: exportMenuItems, onClick: onExport }}>
              <Button>导出</Button>
            </Dropdown>
            {canSubmit ? <Button type="primary" onClick={() => setActionModal('submit')}>提交审批</Button> : null}
            {canApprove ? <Button type="primary" onClick={() => setActionModal('approve')}>批准报告</Button> : null}
            {canDeprecate ? <Button danger onClick={() => setActionModal('deprecate')}>停用</Button> : null}
          </Space>
        }
      />

      <Alert
        style={{ marginTop: 16 }}
        type="warning"
        showIcon
        message="本报告为研究结果，不构成投资建议，不承诺任何收益。"
        description={
          <Space wrap>
            <span>适用范围：{content.applicableUniverse.join('、') || '—'}</span>
            <span>预测周期：{content.predictionHorizonDays} 日</span>
            <span>批准状态：{report.approvedByKey ? `${report.approvedByKey} · ${formatDateTime(report.approvedAt ?? report.updatedAt, { zone: false })}` : '待批准'}</span>
          </Space>
        }
      />

      {report.status !== 'approved' ? (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="报告尚未批准"
          description="只有批准后的报告才适合作为阅读版对外分享；当前仍保留研究版内容供审核。"
        />
      ) : null}

      <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
        <Descriptions.Item label="实验">
          <Link to={`/experiments/${experimentId}`}>{experimentId}</Link>
        </Descriptions.Item>
        <Descriptions.Item label="运行">
          {primaryRun ? <Link to={`/experiments/${experimentId}/runs/${primaryRun}`}>{primaryRun}</Link> : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="合约版本" span={2}>{content.contractVersion}</Descriptions.Item>
        <Descriptions.Item label="内容哈希" span={2}>
          <CopyableId id={contentSha256} maxLength={0} />
        </Descriptions.Item>
      </Descriptions>

      <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
        {sortedBlocks.map((block, index) => (
          <BlockCard key={`${block.partition}-${index}`} block={block} researchView={view === 'research'} />
        ))}
        {sortedBlocks.length === 0 ? (
          <Alert type="warning" showIcon message="报告暂无内容分区" description="该报告尚未写入任何 block。" />
        ) : null}
      </Space>

      <LineageChain style={{ marginTop: 20 }} items={lineageItems} />

      {actionModal ? (
        <ConfirmModal
          open
          title={actionLabels[actionModal].title}
          description={actionLabels[actionModal].desc}
          confirmText={actionLabels[actionModal].confirm}
          danger={actionLabels[actionModal].danger}
          onCancel={() => setActionModal(null)}
          onOk={async (reason) => {
            const result = await reportAction(report.id, actionModal, reason, crypto.randomUUID())
            await queryClient.invalidateQueries({ queryKey: ['report', report.id] })
            await queryClient.invalidateQueries({ queryKey: ['reports'] })
            return result.auditEventId
          }}
        />
      ) : null}
    </div>
  )
}

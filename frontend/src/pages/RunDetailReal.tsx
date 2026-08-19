/** Real 模式运行详情：基于 B4 /runs/{id}、/metrics、/artifacts 渲染。
 *
 * 与 mock 模式 RunDetailMock 的差异：
 * - B4 不提供净值序列 / 交易明细 / 血缘 / 验证窗口，因此本页只展示
 *   运行元数据、状态、错误、关键指标、产物列表与取消操作。
 * - 验证窗口在 B5 是实验级（ExperimentDetail 已接入），运行级不再重复。
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Space, Table, Tag } from 'antd'
import { Link, useNavigate, useParams } from 'react-router'
import { cancelRun, getRun, listRunArtifacts, listRunMetrics } from '@/api/runs'
import {
  ConfirmModal,
  CopyableId,
  LineageChain,
  MetricCard,
  PageHeader,
  StatusTag,
} from '@/components'
import { PageError, PageLoading, PartialResultsBanner } from '@/components/page-state'
import { formatDateTime, formatDurationSec } from '@/shared/format'

const ACTIVE_STATUSES = new Set(['queued', 'claimed', 'running', 'cancel_requested'])

const METRIC_LABEL: Record<string, { label: string; unit: string }> = {
  total_return: { label: '总收益', unit: '%' },
  max_drawdown: { label: '最大回撤', unit: '%' },
  turnover: { label: '换手率', unit: '%' },
  total_fees: { label: '总费用', unit: '元' },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function RunDetailRealPage() {
  const { expId = '', runId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)

  const detailQ = useQuery({
    queryKey: ['runDetailReal', runId],
    queryFn: () => getRun(runId),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && ACTIVE_STATUSES.has(q.state.data.status) ? 4000 : false),
  })
  const metricsQ = useQuery({
    queryKey: ['runMetricsReal', runId],
    queryFn: () => listRunMetrics(runId),
    enabled: !!runId && detailQ.data?.status === 'success',
  })
  const artifactsQ = useQuery({
    queryKey: ['runArtifactsReal', runId],
    queryFn: () => listRunArtifacts(runId),
    enabled: !!runId && (detailQ.data?.status === 'success' || detailQ.data?.resultCompleteness !== 'none'),
  })

  if (detailQ.isLoading) return <PageLoading rows={10} />
  if (detailQ.error) return <PageError error={detailQ.error} retry={() => void detailQ.refetch()} />

  const run = detailQ.data!
  const manifest = run.runManifest
  const running = ACTIVE_STATUSES.has(run.status)
  const failed = run.status === 'failed'
  const partial = run.resultCompleteness === 'partial'
  const durationSec =
    run.startedAt && run.completedAt
      ? Math.max(0, (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : 0

  return (
    <div>
      <PageHeader
        parent="实验"
        title={`运行 ${run.id}`}
        subtitle={`实验 ${run.experimentId}`}
        meta={[
          <StatusTag key="st" status={run.status} domain="run" />,
          running ? '运行中' : formatDurationSec(durationSec),
          <CopyableId key="fp" id={run.fingerprint} maxLength={8} />,
        ]}
        extra={
          running ? (
            <Button danger onClick={() => setCancelOpen(true)}>
              请求取消
            </Button>
          ) : null
        }
      />

      <LineageChain
        style={{ marginTop: 12 }}
        items={[
          { key: 'ds', label: `数据 ${manifest.datasetVersionId.slice(0, 8)}`, to: `/datasets/ds-ashare/versions/${manifest.datasetVersionId}` },
          { key: 'st', label: `策略 ${manifest.strategyVersionId.slice(0, 8)}`, to: `/strategies/st-momentum/versions/${manifest.strategyVersionId}` },
          { key: 'md', label: `模型 ${manifest.modelVersionId.slice(0, 8)}` },
          { key: 'rc', label: `风控 ${manifest.riskRuleVersionId.slice(0, 8)}` },
          { key: 'seed', label: `种子 ${manifest.seed}` },
          { key: 'code', label: manifest.codeVersion.slice(0, 12) },
        ]}
      />

      {partial ? (
        <PartialResultsBanner
          reason={run.errorMessage ?? '部分产物已生成，结果尚未完整'}
          style={{ marginTop: 16 }}
        />
      ) : null}
      {failed && run.errorMessage ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message={`运行失败${run.errorCode ? ` [${run.errorCode}]` : ''}`}
          description={run.errorMessage}
        />
      ) : null}

      <Card size="small" title="运行元数据" style={{ marginTop: 16 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="运行 ID">
            <CopyableId id={run.id} maxLength={0} />
          </Descriptions.Item>
          <Descriptions.Item label="任务 ID">
            <CopyableId id={run.taskId} maxLength={8} />
          </Descriptions.Item>
          <Descriptions.Item label="实验">
            <Link to={`/experiments/${run.experimentId}`}>{run.experimentId}</Link>
          </Descriptions.Item>
          <Descriptions.Item label="来源运行">
            {run.sourceRunId ? <CopyableId id={run.sourceRunId} maxLength={8} /> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDateTime(run.createdAt, { zone: false })}</Descriptions.Item>
          <Descriptions.Item label="开始时间">
            {run.startedAt ? formatDateTime(run.startedAt, { zone: false }) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="完成时间">
            {run.completedAt ? formatDateTime(run.completedAt, { zone: false }) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="结果完整性">
            <Tag color={run.resultCompleteness === 'complete' ? 'success' : run.resultCompleteness === 'partial' ? 'warning' : 'default'}>
              {run.resultCompleteness === 'complete' ? '完整' : run.resultCompleteness === 'partial' ? '部分' : '无结果'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="运行清单 SHA256" span={2}>
            <CopyableId id={run.runManifestSha256} maxLength={12} />
          </Descriptions.Item>
          {run.businessResultSha256 ? (
            <Descriptions.Item label="业务结果 SHA256" span={2}>
              <CopyableId id={run.businessResultSha256} maxLength={12} />
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      </Card>

      <Card size="small" title="关键指标" style={{ marginTop: 16 }}>
        {metricsQ.isLoading ? (
          <PageLoading withTitle={false} rows={3} />
        ) : metricsQ.error ? (
          <PageError error={metricsQ.error} retry={() => void metricsQ.refetch()} />
        ) : (metricsQ.data ?? []).length === 0 ? (
          <Alert type="info" showIcon message="暂无指标" description="运行成功完成后将展示 total_return / max_drawdown / turnover / total_fees。" />
        ) : (
          <Space wrap style={{ display: 'flex' }}>
            {(metricsQ.data ?? []).map((m) => {
              const meta = METRIC_LABEL[m.metricName] ?? { label: m.metricName, unit: m.unit }
              const numeric = Number(m.value)
              return (
                <MetricCard
                  key={m.metricName}
                  title={meta.label}
                  value={Number.isFinite(numeric) ? numeric : 0}
                  valueType={meta.unit === '元' ? 'number' : 'percent'}
                  unit={meta.unit === '元' ? '元' : undefined}
                  caveat={`${m.unit} · ${m.schemaVersion}`}
                />
              )
            })}
          </Space>
        )}
      </Card>

      <Card size="small" title="产物" style={{ marginTop: 16 }}>
        {artifactsQ.isLoading ? (
          <PageLoading withTitle={false} rows={4} />
        ) : artifactsQ.error ? (
          <PageError error={artifactsQ.error} retry={() => void artifactsQ.refetch()} />
        ) : (artifactsQ.data ?? []).length === 0 ? (
          <Alert type="info" showIcon message="暂无产物" description="运行产生产物后将在此列出。" />
        ) : (
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey="id"
              dataSource={artifactsQ.data ?? []}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              columns={[
                { title: '类型', dataIndex: 'artifactType', width: 140 },
                { title: '格式', dataIndex: 'format', width: 100 },
                { title: '大小', dataIndex: 'sizeBytes', width: 110, render: (v: number) => formatBytes(v) },
                { title: '行数', dataIndex: 'rowCount', width: 100, render: (v: number | null) => (v ?? '—') },
                { title: '完整性', dataIndex: 'completeness', width: 90, render: (v: string) => <Tag color={v === 'complete' ? 'success' : 'warning'}>{v === 'complete' ? '完整' : '部分'}</Tag> },
                { title: '存储', dataIndex: 'storageKind', width: 90, render: (v: string) => (v === 'data' ? '数据卷' : '产物目录') },
                { title: 'SHA256', dataIndex: 'sha256', width: 160, render: (v: string | null) => (v ? <CopyableId id={v} maxLength={10} /> : '—') },
                { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v, { zone: false }) },
              ]}
            />
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Button onClick={() => navigate(`/experiments/${expId}`)}>返回实验</Button>
      </div>

      <ConfirmModal
        open={cancelOpen}
        title="请求取消运行"
        description="运行将在安全检查点停止；已经提交的部分产物会保留并标注为部分结果。"
        confirmText="请求取消并留痕"
        danger
        onCancel={() => setCancelOpen(false)}
        onOk={async (reason) => {
          const result = await cancelRun(run.id, reason, `cancel-${run.id}-${Date.now()}`)
          await queryClient.invalidateQueries({ queryKey: ['runDetailReal', run.id] })
          return result.auditEventId ?? ''
        }}
      />
    </div>
  )
}

/** 实验详情 */

import { useQuery } from '@tanstack/react-query'
import { Button, Card, Descriptions, Space, Table, Tabs, Tag } from 'antd'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { getExperiment, listExperimentRuns } from '@/api/mock/experiments'
import * as B5Real from '@/api/b5/real'
import { isRealApiMode } from '@/api/config'
import { useAuth } from '@/app/AuthContext'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import { DisabledNotice, PageError, PageLoading } from '@/components/page-state'
import { formatDateTime, formatDurationSec } from '@/shared/format'
import { MarketValue } from '@/components'

const COMPLETENESS_LABEL: Record<string, { label: string; color: string }> = {
  none: { label: '无结果', color: 'default' },
  partial: { label: '部分', color: 'warning' },
  complete: { label: '完整', color: 'success' },
}

export default function ExperimentDetailPage() {
  const { expId = '' } = useParams()
  const navigate = useNavigate()
  const { hasScope } = useAuth()
  const canReadValidation = hasScope('validation:read')
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'validation' ? 'validation' : 'runs'

  const expQ = useQuery({
    queryKey: ['experiment', expId],
    queryFn: () => getExperiment(expId),
    enabled: !!expId,
  })
  const runsQ = useQuery({
    queryKey: ['experimentRuns', expId],
    queryFn: () => listExperimentRuns(expId),
    enabled: !!expId,
  })
  const validationQ = useQuery({
    queryKey: ['experimentValidationRuns', expId],
    queryFn: () => B5Real.listValidationRuns(expId, 1, 50),
    enabled: !!expId && canReadValidation && isRealApiMode && activeTab === 'validation',
  })

  if (expQ.isLoading || runsQ.isLoading) return <PageLoading />
  if (expQ.error || runsQ.error) {
    return (
      <PageError
        error={expQ.error ?? runsQ.error}
        retry={() => {
          void expQ.refetch()
          void runsQ.refetch()
        }}
      />
    )
  }

  const exp = expQ.data!
  const runs = runsQ.data ?? []
  const protocol = exp.protocol
  const validationRuns = validationQ.data?.items ?? []

  return (
    <div>
      <PageHeader
        title={exp.name}
        subtitle={exp.hypothesisSummary}
        meta={[
          <CopyableId key="id" id={exp.id} maxLength={0} />,
          `负责人 ${exp.owner}`,
          `冻结于 ${formatDateTime(exp.frozenAt, { zone: false })}`,
        ]}
        extra={
          <Space>
            <Button onClick={() => navigate(`/experiments/${expId}/compare`)}>比较运行</Button>
            <Button type="primary" onClick={() => navigate('/experiments/new')}>复现实验</Button>
          </Space>
        }
      />

      <Card size="small" title="预注册协议摘要" style={{ marginTop: 16 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="研究假设" span={2}>
            {protocol.hypothesis.statement}
          </Descriptions.Item>
          <Descriptions.Item label="主要指标">
            {protocol.hypothesis.primaryMetrics.join('、')}
          </Descriptions.Item>
          <Descriptions.Item label="数据版本">
            <Link to={`/datasets/ds-ashare/versions/${protocol.datasetVersionId}`}>
              {protocol.datasetVersionId}
            </Link>
          </Descriptions.Item>
          <Descriptions.Item label="策略版本">
            <Link to={`/strategies/st-momentum/versions/${protocol.strategyVersionId}`}>
              {protocol.strategyVersionId}
            </Link>
          </Descriptions.Item>
          <Descriptions.Item label="标的池">{protocol.universe}</Descriptions.Item>
          <Descriptions.Item label="测试区间">
            {protocol.split.testStart} ~ {protocol.split.testEnd}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        style={{ marginTop: 24 }}
        activeKey={activeTab}
        onChange={(tab) => {
          const next = new URLSearchParams(params)
          if (tab === 'validation') next.set('tab', 'validation')
          else next.delete('tab')
          setParams(next)
        }}
        items={[
          {
            key: 'runs',
            label: `回测运行（${runs.length}）`,
            children: (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={runs}
                  columns={[
                    {
                      title: '运行号',
                      dataIndex: 'id',
                      render: (id) => (
                        <Link to={`/experiments/${expId}/runs/${id}`}>{id}</Link>
                      ),
                    },
                    { title: '模型', dataIndex: 'modelName' },
                    {
                      title: '种子',
                      dataIndex: 'seeds',
                      render: (s: number[]) => s.join(', '),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (s) => <StatusTag status={s} domain="run" />,
                    },
                    {
                      title: '年化收益',
                      dataIndex: 'annualReturn',
                      width: 100,
                      render: (v) => (v != null ? <MarketValue value={v} /> : '—'),
                    },
                    {
                      title: '最大回撤',
                      dataIndex: 'maxDrawdown',
                      width: 100,
                      render: (v) => (v != null ? `${v}%` : '—'),
                    },
                    {
                      title: 'Sharpe',
                      dataIndex: 'sharpe',
                      width: 80,
                      render: (v) => (v != null ? v.toFixed(2) : '—'),
                    },
                    {
                      title: '耗时',
                      dataIndex: 'durationSec',
                      width: 100,
                      render: formatDurationSec,
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'validation',
            label: `验证运行${validationQ.data ? `（${validationQ.data.items.length}）` : ''}`,
            children: !canReadValidation ? (
              <DisabledNotice
                title="验证运行查询权限不足"
                readOnly={false}
                reason="当前角色未授予 validation:read 权限。"
              />
            ) : !isRealApiMode ? (
              <DisabledNotice
                title="验证运行仅在 real 模式可用"
                readOnly={false}
                reason="B5 验证运行依赖后端 /experiments/{id}/validation-runs；mock 模式不提供样本。"
              />
            ) : validationQ.isLoading ? (
              <PageLoading rows={6} />
            ) : validationQ.error ? (
              <PageError error={validationQ.error} retry={() => void validationQ.refetch()} />
            ) : validationRuns.length === 0 ? (
              <DisabledNotice
                title="暂无验证运行"
                readOnly={true}
                reason="该实验尚未创建 B5 验证运行（walk-forward / 压力场景）。"
              />
            ) : (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={validationRuns}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  columns={[
                    {
                      title: '验证运行',
                      dataIndex: 'id',
                      render: (id) => <CopyableId id={id} maxLength={18} />,
                    },
                    { title: '窗口序号', dataIndex: 'windowIndex', width: 90 },
                    { title: '种子', dataIndex: 'seed', width: 90 },
                    { title: '场景', dataIndex: 'scenarioName', width: 150, ellipsis: true },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (s) => <StatusTag status={s} domain="run" />,
                    },
                    {
                      title: '完整度',
                      dataIndex: 'resultCompleteness',
                      width: 100,
                      render: (v: string) => {
                        const meta = COMPLETENESS_LABEL[v] ?? { label: v, color: 'default' }
                        return <Tag color={meta.color}>{meta.label}</Tag>
                      },
                    },
                    {
                      title: '总收益',
                      width: 100,
                      render: (_, row) => {
                        const v = row.metrics.total_return
                        return v != null ? (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : String(v)) : '—'
                      },
                    },
                    {
                      title: '最大回撤',
                      width: 100,
                      render: (_, row) => {
                        const v = row.metrics.max_drawdown
                        return v != null ? (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : String(v)) : '—'
                      },
                    },
                    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v) => formatDateTime(v, { zone: false }) },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

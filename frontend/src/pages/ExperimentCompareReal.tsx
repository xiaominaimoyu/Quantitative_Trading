/**
 * 运行比较视图（real 模式）——基于 B4 /experiments/{id}/runs 与 /runs/{id}/metrics。
 *
 * 与 mock 模式的差异：
 * - B4 不提供净值序列端点，因此不渲染叠加净值曲线（改用 DisabledNotice）；
 * - 指标来自 /runs/{id}/metrics（total_return / max_drawdown / turnover / total_fees），
 *   B4 暂无 Sharpe 与年化收益，对应列显示 —；
 * - 运行列表默认按 createdAt 降序（反选择性偏差，与 mock 一致）。
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Table } from 'antd'
import { Link, useParams } from 'react-router'
import { listExperimentRuns, listRunMetrics, type RunMetric, type RunSummary } from '@/api/runs'
import { MarketValue, PageHeader, StatusTag } from '@/components'
import { DisabledNotice, PageError, PageLoading } from '@/components/page-state'

/** 将 B4 指标映射为比较表展示字段。 */
function metricsToRowFields(
  metrics: RunMetric[],
): { annualReturn?: number; maxDrawdown?: number; sharpe?: number } {
  const fields: { annualReturn?: number; maxDrawdown?: number; sharpe?: number } = {}
  for (const m of metrics) {
    const value = Number(m.value)
    if (!Number.isFinite(value)) continue
    if (m.metricName === 'total_return') fields.annualReturn = value
    else if (m.metricName === 'max_drawdown') fields.maxDrawdown = value
    // B4 暂无 Sharpe 指标，sharpe 列保持 undefined（表格显示 —）
  }
  return fields
}

interface CompareRow extends RunSummary {
  annualReturn?: number
  maxDrawdown?: number
  sharpe?: number
}

export default function ExperimentCompareRealPage() {
  const { expId = '' } = useParams()

  const runsQ = useQuery({
    queryKey: ['experimentRunsReal', expId],
    queryFn: () => listExperimentRuns(expId),
    enabled: !!expId,
  })

  const successRunIds = useMemo(
    () => (runsQ.data ?? []).filter((r) => r.status === 'success').map((r) => r.id),
    [runsQ.data],
  )

  // 并行获取所有成功运行的指标；单条失败不影响其他行展示。
  const metricsQ = useQuery({
    queryKey: ['compareMetricsReal', successRunIds],
    queryFn: async () => {
      const settled = await Promise.allSettled(
        successRunIds.map(async (id) => ({ id, metrics: await listRunMetrics(id) })),
      )
      const map = new Map<string, RunMetric[]>()
      for (const entry of settled) {
        if (entry.status === 'fulfilled') map.set(entry.value.id, entry.value.metrics)
      }
      return map
    },
    enabled: successRunIds.length > 0,
  })

  const displayRows: CompareRow[] = useMemo(() => {
    const runs = runsQ.data ?? []
    const metricsMap = metricsQ.data ?? new Map<string, RunMetric[]>()
    return runs.map((r) => ({
      ...r,
      ...(metricsMap.get(r.id) ? metricsToRowFields(metricsMap.get(r.id)!) : {}),
    }))
  }, [runsQ.data, metricsQ.data])

  if (runsQ.isLoading) return <PageLoading />
  if (runsQ.error) return <PageError error={runsQ.error} retry={() => void runsQ.refetch()} />

  return (
    <div>
      <PageHeader
        parent="实验"
        title="模型 / 运行比较"
        subtitle="同一协议下的公平比较 · 默认按创建时间排序"
        extra={
          <Button onClick={() => window.location.reload()}>重置排序</Button>
        }
      />

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="比较视图默认不按收益指标排序，防止「按最佳结果挑选」的视觉诱导。"
      />

      <div className="qt-table-scroll" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          dataSource={displayRows}
          pagination={false}
          columns={[
            {
              title: '运行',
              dataIndex: 'id',
              render: (id) => (
                <Link to={`/experiments/${expId}/runs/${id}`}>{id}</Link>
              ),
            },
            {
              title: '模型',
              dataIndex: 'modelName',
              render: (v: string | null) => v ?? '—',
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
              sorter: (a: CompareRow, b: CompareRow) =>
                (a.annualReturn ?? 0) - (b.annualReturn ?? 0),
              render: (v: number | undefined) =>
                v != null ? <MarketValue value={v} /> : '—',
            },
            {
              title: '最大回撤',
              dataIndex: 'maxDrawdown',
              render: (v: number | undefined) => (v != null ? `${v}%` : '—'),
            },
            {
              title: 'Sharpe',
              dataIndex: 'sharpe',
              render: (v: number | undefined) => (v ?? '—'),
            },
          ]}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <DisabledNotice
          title="叠加净值曲线（real 模式暂未开放）"
          readOnly={false}
          reason="B4 暂无净值序列端点；real 模式仅展示指标比较表。切换到 mock 模式可查看叠加净值曲线示例。"
        />
      </div>
    </div>
  )
}

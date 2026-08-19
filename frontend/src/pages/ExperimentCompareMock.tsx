/** 运行比较视图（mock 模式）——叠加净值曲线 + 指标比较表。 */

import { useMemo, type Key } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Table } from 'antd'
import { Link, useParams, useSearchParams } from 'react-router'
import type { EChartsOption } from 'echarts'
import { listExperimentRuns } from '@/api/mock/experiments'
import { getRunNavSeries } from '@/api/mock/runs'
import { ChartPanel, MarketValue, PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'

export default function ExperimentCompareMockPage() {
  const { expId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const selectedRunsParam = params.get('runs') ?? ''
  const selectedIds = useMemo(
    () => selectedRunsParam.split(',').filter(Boolean),
    [selectedRunsParam],
  )

  const runsQ = useQuery({
    queryKey: ['experimentRuns', expId],
    queryFn: () => listExperimentRuns(expId),
    enabled: !!expId,
  })

  const navQ = useQuery({
    queryKey: ['compareNav', selectedIds],
    queryFn: async () => {
      const series = await Promise.all(
        selectedIds.map(async (id) => ({ id, points: await getRunNavSeries(id) })),
      )
      return series
    },
    enabled: selectedIds.length > 0,
  })

  const displayRuns = useMemo(() => {
    const all = runsQ.data ?? []
    if (selectedIds.length === 0) return all.filter((r) => r.status === 'success' || r.status === 'failed')
    return all.filter((r) => selectedIds.includes(r.id))
  }, [runsQ.data, selectedIds])

  const updateSelectedRuns = (keys: Key[]) => {
    const next = new URLSearchParams(params)
    const ids = keys.map(String)
    if (ids.length > 0) next.set('runs', ids.join(','))
    else next.delete('runs')
    setParams(next)
  }

  const chartOption: EChartsOption = useMemo(() => {
    if (!navQ.data?.length) return { series: [] }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: navQ.data.map((s) => s.id) },
      xAxis: { type: 'category', data: navQ.data[0]?.points.map((p) => p.date) ?? [] },
      yAxis: { type: 'value', name: '净值' },
      series: navQ.data.map((s) => ({
        name: s.id,
        type: 'line',
        data: s.points.map((p) => p.nav),
        showSymbol: false,
      })),
    }
  }, [navQ.data])

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
          dataSource={displayRuns}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: updateSelectedRuns,
            getCheckboxProps: (record) => ({
              disabled: record.status !== 'success' && record.status !== 'failed',
            }),
          }}
          columns={[
            {
              title: '运行',
              dataIndex: 'id',
              render: (id) => (
                <Link to={`/experiments/${expId}/runs/${id}`}>{id}</Link>
              ),
            },
            { title: '模型', dataIndex: 'modelName' },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s) => <StatusTag status={s} domain="run" />,
            },
            {
              title: '年化收益',
              dataIndex: 'annualReturn',
              sorter: (a, b) => (a.annualReturn ?? 0) - (b.annualReturn ?? 0),
              render: (v) => (v != null ? <MarketValue value={v} /> : '—'),
            },
            {
              title: '最大回撤',
              dataIndex: 'maxDrawdown',
              render: (v) => (v != null ? `${v}%` : '—'),
            },
            { title: 'Sharpe', dataIndex: 'sharpe', render: (v) => (v ?? '—') },
          ]}
        />
      </div>

      <ChartPanel
        title="叠加净值曲线"
        chartOption={chartOption}
        height={360}
        dataCutoff="2026-07-31"
        downsampleNote={`已降采样：显示 ${navQ.data?.[0]?.points.length ?? 0} 点`}
        style={{ marginTop: 16 }}
      />
    </div>
  )
}

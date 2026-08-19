/** Mock 模式运行详情；real 模式不会加载此模块。 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Progress, Space, Steps, Table, Tabs, Tag } from 'antd'
import type { EChartsOption } from 'echarts'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { cancelRun, getRunDetail, getRunNavSeries, listRunTrades, listRunValidation } from '@/api/mock/runs'
import { listRiskEvents } from '@/api/mock/risk'
import {
  ChartPanel,
  ConfirmModal,
  LineageChain,
  MarketValue,
  MetricCard,
  PageHeader,
  PartialResultsBanner,
  StatusTag,
} from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime, formatDurationSec } from '@/shared/format'
import { isActiveTaskStatus } from '@/api/mock/tasks'

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'trades', label: '交易明细' },
  { key: 'validation', label: '验证' },
  { key: 'risk', label: '风险事件' },
  { key: 'lineage', label: '血缘' },
]

export default function RunDetailPage() {
  const { expId = '', runId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'

  const detailQ = useQuery({
    queryKey: ['runDetail', runId],
    queryFn: () => getRunDetail(runId),
    enabled: !!runId,
    refetchInterval: (q) => {
      const st = q.state.data?.status
      return st && isActiveTaskStatus(st) ? 4000 : false
    },
  })
  const navQ = useQuery({
    queryKey: ['runNav', runId],
    queryFn: () => getRunNavSeries(runId),
    enabled: !!runId && detailQ.data?.status === 'success',
  })
  const tradesQ = useQuery({
    queryKey: ['runTrades', runId],
    queryFn: () => listRunTrades(runId),
    enabled: !!runId && tab === 'trades',
  })
  const validationQ = useQuery({
    queryKey: ['runValidation', runId],
    queryFn: () => listRunValidation(runId),
    enabled: !!runId && tab === 'validation',
  })
  const riskQ = useQuery({
    queryKey: ['runRiskEvents', runId],
    queryFn: () => listRiskEvents(),
    enabled: !!runId && tab === 'risk',
  })

  const chartOption: EChartsOption = useMemo(() => {
    const points = navQ.data ?? []
    if (!points.length) return { series: [] }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['策略', '基准'] },
      grid: [{ left: 50, right: 20, height: '35%' }, { left: 50, right: 20, top: '55%', height: '30%' }],
      xAxis: [
        { type: 'category', data: points.map((p) => p.date), gridIndex: 0 },
        { type: 'category', data: points.map((p) => p.date), gridIndex: 1 },
      ],
      yAxis: [
        { type: 'value', name: '净值', gridIndex: 0 },
        { type: 'value', name: '回撤%', gridIndex: 1 },
      ],
      series: [
        { name: '策略', type: 'line', data: points.map((p) => p.nav), xAxisIndex: 0, yAxisIndex: 0, showSymbol: false },
        { name: '基准', type: 'line', data: points.map((p) => p.benchmark), xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, lineStyle: { type: 'dashed' } },
        { name: '回撤', type: 'line', data: points.map((p) => p.drawdown), xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, areaStyle: {} },
      ],
    }
  }, [navQ.data])

  if (detailQ.isLoading) return <PageLoading rows={10} />
  if (detailQ.error) return <PageError error={detailQ.error} retry={() => void detailQ.refetch()} />

  const run = detailQ.data!
  const metrics = run.metrics
  const running = isActiveTaskStatus(run.status)
  const failed = run.status === 'failed'

  return (
    <div>
      <PageHeader
        parent="实验"
        title={`运行 ${run.id}`}
        subtitle={run.experimentName}
        meta={[
          <StatusTag key="st" status={run.status} domain="run" />,
          running ? `${run.progress}%` : formatDurationSec(0),
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
          { key: 'ds', label: '数据 v3', to: `/datasets/ds-ashare/versions/${run.datasetVersionId}` },
          { key: 'st', label: '策略 v2', to: `/strategies/st-momentum/versions/${run.strategyVersionId}` },
          {
            key: 'md',
            label: '模型 v1',
            to: `/models/${run.modelVersionId.replace(/-v\d+$/, '')}/versions/${run.modelVersionId}`,
          },
          { key: 'rc', label: '风控 v1' },
          { key: 'seed', label: `种子 ${run.seeds.join('/')}` },
          { key: 'code', label: run.codeCommit },
        ]}
      />

      {run.partialResult ? (
        <PartialResultsBanner
          reason={run.errorSummary ?? '部分产物已生成，结果尚未完整'}
          style={{ marginTop: 16 }}
        />
      ) : null}
      {failed && run.errorSummary ? (
        <Alert type="error" showIcon message="运行失败" description={run.errorSummary} style={{ marginTop: 16 }} />
      ) : null}

      <Tabs
        style={{ marginTop: 16 }}
        activeKey={tab}
        onChange={(k) => {
          const next = new URLSearchParams(params)
          next.set('tab', k)
          setParams(next)
        }}
        items={TABS.map((t) => ({ key: t.key, label: t.label }))}
      />

      {tab === 'overview' ? (
        <>
          <Steps
            size="small"
            style={{ margin: '16px 0' }}
            current={running ? 2 : failed ? 2 : 3}
            items={[
              { title: '排队', status: 'finish' },
              { title: '领取', status: 'finish' },
              { title: '运行中', status: running ? 'process' : failed ? 'error' : 'finish' },
              { title: '完成', status: run.status === 'success' ? 'finish' : 'wait' },
            ]}
          />
          {running ? (
            <Progress percent={run.progress} status="active" style={{ marginBottom: 16 }} />
          ) : null}
          {metrics ? (
            <>
              <Space wrap style={{ display: 'flex', marginBottom: 16 }}>
                <MetricCard title="年化收益" value={metrics.annualReturn} valueType="percent" extra={<MarketValue value={metrics.annualReturn} size="small" />} caveat="样本外区间，含成本" />
                <MetricCard title="最大回撤" value={Math.abs(metrics.maxDrawdown)} valueType="percent" unit="%" caveat="峰值到谷底" />
                <MetricCard title="Sharpe" value={metrics.sharpe} valueType="number" caveat="无风险利率 2%" />
                <MetricCard title="换手率" value={metrics.turnover} valueType="percent" unit="%" />
                <MetricCard title="成本贡献" value={metrics.costContribution} valueType="percent" unit="%" />
              </Space>
              <ChartPanel
                title="净值与回撤"
                chartOption={chartOption}
                height={400}
                dataCutoff={metrics.dataCutoff}
                versionLabel="v3"
                downsampleNote={`已降采样：显示 ${navQ.data?.length ?? 0} / 原始 3652 点`}
              />
            </>
          ) : (
            <Alert type="info" showIcon message="结果尚未产生" description="运行完成后将展示指标与图表。" />
          )}
        </>
      ) : null}

      {tab === 'trades' ? (
        tradesQ.isLoading ? <PageLoading withTitle={false} rows={5} /> : tradesQ.error ? <PageError error={tradesQ.error} retry={() => void tradesQ.refetch()} /> : (tradesQ.data ?? []).length === 0 ? (
          <Alert type="info" showIcon message="暂无逐笔交易数据" description="该运行尚未产生可展示的订单或成交记录。" />
        ) : (
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey="id"
              dataSource={tradesQ.data}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              columns={[
                { title: '时间', dataIndex: 'timestamp', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
                { title: '标的', dataIndex: 'symbol', width: 110 },
                { title: '方向', dataIndex: 'direction', width: 80 },
                { title: '价格', dataIndex: 'price', width: 100, render: (value) => <span className="qt-tabular">{value.toFixed(2)}</span> },
                { title: '数量', dataIndex: 'quantity', width: 90, render: (value) => <span className="qt-tabular">{value.toLocaleString('zh-CN')}</span> },
                { title: '费用', dataIndex: 'fee', width: 90, render: (value) => `${value.toFixed(2)} 元` },
                { title: '滑点', dataIndex: 'slippage', width: 80, render: (value) => `${value.toFixed(2)}%` },
                { title: '订单状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'filled' ? 'success' : value === 'partial' ? 'warning' : 'error'}>{value === 'filled' ? '完全成交' : value === 'partial' ? '部分成交' : '拒绝'}</Tag> },
              ]}
            />
          </div>
        )
      ) : null}
      {tab === 'validation' ? (
        validationQ.isLoading ? <PageLoading withTitle={false} rows={5} /> : validationQ.error ? <PageError error={validationQ.error} retry={() => void validationQ.refetch()} /> : (validationQ.data ?? []).length === 0 ? (
          <Alert type="info" showIcon message="暂无验证结果" description="运行完成后将展示 Walk-forward、多种子分布和校准结果。" />
        ) : (
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey="id"
              dataSource={validationQ.data}
              columns={[
                { title: '窗口', dataIndex: 'label' },
                { title: '年化收益', dataIndex: 'annualReturn', width: 110, render: (value) => `${value.toFixed(2)}%` },
                { title: 'Sharpe', dataIndex: 'sharpe', width: 90, render: (value) => value.toFixed(2) },
                { title: '覆盖率', dataIndex: 'coverage', width: 100, render: (value) => `${(value * 100).toFixed(1)}%` },
                { title: '结论', dataIndex: 'status', width: 130, render: (value) => <StatusTag status={value} domain="validation" /> },
                { title: '说明', dataIndex: 'note', ellipsis: true },
              ]}
            />
          </div>
        )
      ) : null}
      {tab === 'risk' ? (
        riskQ.isLoading ? <PageLoading withTitle={false} rows={5} /> : riskQ.error ? <PageError error={riskQ.error} retry={() => void riskQ.refetch()} /> : (() => {
          const events = (riskQ.data ?? []).filter((event) => event.runId === run.id)
          return events.length === 0 ? (
            <Alert type="success" showIcon message="本次运行未触发风险事件" />
          ) : (
            <div className="qt-table-scroll">
              <Table
                size="small"
                rowKey="id"
                dataSource={events}
                columns={[
                  { title: '时间', dataIndex: 'timestamp', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
                  { title: '事件', dataIndex: 'type', width: 110, render: (value) => <StatusTag status={value} domain="riskEvent" /> },
                  { title: '标的', dataIndex: 'symbol', width: 110, render: (value) => value ?? '—' },
                  { title: '目标变化', width: 150, render: (_, row) => `${row.beforeTarget} → ${row.afterTarget}` },
                  { title: '原因', dataIndex: 'reason', ellipsis: true },
                  { title: '审计编号', dataIndex: 'auditId', width: 170 },
                ]}
              />
            </div>
          )
        })()
      ) : null}
      {tab === 'lineage' ? (
        <LineageChain
          direction="vertical"
          items={[
            { key: 'ds', label: `数据 ${run.datasetVersionId}`, to: `/datasets/ds-ashare/versions/${run.datasetVersionId}` },
            { key: 'st', label: `策略 ${run.strategyVersionId}`, to: `/strategies/st-momentum/versions/${run.strategyVersionId}` },
            { key: 'run', label: `运行 ${run.id}` },
            { key: 'report', label: '报告 RP-0101', to: '/reports/RP-0101' },
          ]}
        />
      ) : null}

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
          const result = await cancelRun(run.id, reason)
          await queryClient.invalidateQueries({ queryKey: ['runDetail', run.id] })
          await queryClient.invalidateQueries({ queryKey: ['dashboard', 'tasks'] })
          return result.auditId
        }}
      />
    </div>
  )
}

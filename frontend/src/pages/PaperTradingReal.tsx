/**
 * 模拟盘（real 模式）：基于 G5 真实端点渲染。
 *
 * 与 mock 模式的差异：
 * - 数据来自 /paper-trading/snapshot、/reconciliations、/daily-report；
 * - 对账分两段：列表（批次）与展开后的差异项详情；
 * - 订单方向后端用 buy/sell，facade 已翻译为 买入/卖出；
 * - 网络错误以 ApiError 形式抛出，不回退到 mock。
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag } from 'antd'
import { useAuth } from '@/app/AuthContext'
import {
  getDailyReport,
  getPaperTradingSnapshot,
  getReconciliationDetail,
  listReconciliations,
  manualStopPaperTrading,
  type ReconciliationRun,
} from '@/api/paperTrading'
import { ConfirmModal, CopyableId, PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  accepted: { label: '已接受', color: 'processing' },
  partial: { label: '部分成交', color: 'warning' },
  filled: { label: '完全成交', color: 'success' },
  unknown: { label: '未知，等待对账', color: 'error' },
  rejected: { label: '拒绝', color: 'error' },
}

const RECONCILIATION_STATUS: Record<string, { label: string; color: string }> = {
  matched: { label: '一致', color: 'success' },
  difference: { label: '存在差异', color: 'error' },
  unknown: { label: '未完成', color: 'processing' },
}

/** 对账批次展开行：拉取批次详情，展示差异项表格。 */
function ReconciliationRunDetail({ runId }: { runId: string }) {
  const detailQ = useQuery({
    queryKey: ['paperReconciliationDetail', runId],
    queryFn: () => getReconciliationDetail(runId),
    enabled: !!runId,
  })

  if (detailQ.isLoading) return <PageLoading withTitle={false} rows={2} />
  if (detailQ.error) return <PageError error={detailQ.error} retry={() => void detailQ.refetch()} />
  if (!detailQ.data) return null

  const items = detailQ.data.items
  if (items.length === 0) {
    return <Alert type="info" showIcon message="该批次无差异项明细" />
  }

  return (
    <div className="qt-table-scroll">
      <Table
        size="small"
        rowKey={(item) => `${item.target}-${item.checkedAt}`}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '对账项', dataIndex: 'target', width: 200 },
          {
            title: '结论',
            dataIndex: 'type',
            width: 110,
            render: (value: string) => (
              <Tag color={value === 'matched' ? 'success' : 'error'}>
                {value === 'matched' ? '一致' : '存在差异'}
              </Tag>
            ),
          },
          { title: '本地值', dataIndex: 'localValue', width: 140, render: (v: string | null) => v ?? '—' },
          { title: '远端值', dataIndex: 'remoteValue', width: 140, render: (v: string | null) => v ?? '—' },
          { title: '差异', dataIndex: 'difference', width: 140, render: (v: string | null) => v ?? '—' },
          { title: '说明', dataIndex: 'summary', ellipsis: true },
          {
            title: '检查时间',
            dataIndex: 'checkedAt',
            width: 180,
            render: (v: string) => formatDateTime(v, { zone: false }),
          },
        ]}
      />
    </div>
  )
}

export default function PaperTradingRealPage() {
  const [stopOpen, setStopOpen] = useState(false)
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const canStop = role === 'admin'

  const snapshotQ = useQuery({
    queryKey: ['paperTradingReal', 'snapshot'],
    queryFn: () => getPaperTradingSnapshot(),
    refetchInterval: 5000,
  })

  const reconciliationsQ = useQuery({
    queryKey: ['paperTradingReal', 'reconciliations'],
    queryFn: () => listReconciliations({ pageSize: 20 }),
  })

  const dailyReportQ = useQuery({
    queryKey: ['paperTradingReal', 'dailyReport'],
    queryFn: () => getDailyReport(),
  })

  if (snapshotQ.isLoading) return <PageLoading rows={10} />
  if (snapshotQ.error) return <PageError error={snapshotQ.error} retry={() => void snapshotQ.refetch()} />
  if (!snapshotQ.data) return null

  const snapshot = snapshotQ.data
  const hasUnknown = snapshot.orders.some((order) => order.status === 'unknown')

  return (
    <div>
      <PageHeader
        title="模拟盘"
        subtitle="与真实交易完全隔离的沙箱监控界面（real 模式）"
        meta={[
          <StatusTag
            key="status"
            status={snapshot.status}
            label={snapshot.status === 'running' ? '运行中' : '已停机'}
          />,
        ]}
        extra={
          <Button
            danger
            disabled={!canStop || snapshot.status === 'stopped'}
            onClick={() => setStopOpen(true)}
          >
            人工停机
          </Button>
        }
      />
      {!canStop ? (
        <Alert style={{ marginTop: 12 }} type="info" showIcon message="人工停机仅对管理员开放" />
      ) : null}

      <Alert
        style={{ marginTop: 16 }}
        type="warning"
        showIcon
        message="模拟盘与真实账户、券商、下单接口完全隔离；订单与对账数据均来自后端持久化事实。"
        description="订单状态以持久化事实和对账结果为准；未知状态不得被当作成交。"
      />
      {hasUnknown ? (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          message="存在未知订单状态，请先完成对账确认"
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="账户总资产" value={snapshot.account.total} suffix="元" precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="可用资金" value={snapshot.account.available} suffix="元" precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="持仓市值" value={snapshot.account.marketValue} suffix="元" precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic
              title="当日盈亏"
              value={snapshot.account.dayPnl}
              suffix="元"
              precision={2}
              valueStyle={{ color: snapshot.account.dayPnl >= 0 ? '#CF1322' : '#237804' }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="持仓" style={{ marginTop: 16 }}>
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="symbol"
            dataSource={snapshot.positions}
            pagination={false}
            columns={[
              {
                title: '标的',
                dataIndex: 'symbol',
                width: 120,
                render: (value, row) => (
                  <Space direction="vertical" size={0}>
                    <span>{row.name}</span>
                    <span className="qt-mono" style={{ fontSize: 12 }}>{value}</span>
                  </Space>
                ),
              },
              {
                title: '数量',
                dataIndex: 'quantity',
                width: 100,
                render: (value: number) => value.toLocaleString('zh-CN'),
              },
              {
                title: '市值',
                dataIndex: 'marketValue',
                width: 130,
                render: (value: number) => `${value.toLocaleString('zh-CN')} 元`,
              },
              {
                title: '盈亏',
                dataIndex: 'pnl',
                width: 120,
                render: (value: number) => (
                  <span style={{ color: value >= 0 ? '#CF1322' : '#237804' }}>
                    {value.toLocaleString('zh-CN')} 元
                  </span>
                ),
              },
              {
                title: '盈亏比例',
                dataIndex: 'pnlPct',
                width: 100,
                render: (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
              },
            ]}
          />
        </div>
      </Card>

      <Card size="small" title="订单与成交" style={{ marginTop: 16 }}>
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={snapshot.orders}
            pagination={false}
            columns={[
              {
                title: '订单号',
                dataIndex: 'id',
                width: 190,
                render: (value: string) => <CopyableId id={value} maxLength={18} />,
              },
              { title: '标的', dataIndex: 'symbol', width: 110 },
              { title: '方向', dataIndex: 'direction', width: 80 },
              {
                title: '委托/成交',
                width: 120,
                render: (_, row) => `${row.filledQuantity} / ${row.quantity}`,
              },
              {
                title: '价格',
                dataIndex: 'price',
                width: 100,
                render: (value: number | null) => value === null ? '市价' : value.toFixed(2),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 140,
                render: (value: string) => (
                  <Tag color={ORDER_STATUS[value]?.color}>
                    {ORDER_STATUS[value]?.label ?? value}
                  </Tag>
                ),
              },
              {
                title: '提交时间',
                dataIndex: 'submittedAt',
                width: 180,
                render: (value: string | null) => value ? formatDateTime(value, { zone: false }) : '—',
              },
            ]}
          />
        </div>
      </Card>

      <Card
        size="small"
        title="对账批次"
        style={{ marginTop: 16 }}
        extra={
          reconciliationsQ.isError ? (
            <span style={{ color: '#CF1322', fontSize: 12 }}>对账列表加载失败</span>
          ) : null
        }
      >
        {reconciliationsQ.isLoading ? (
          <PageLoading withTitle={false} rows={3} />
        ) : reconciliationsQ.error ? (
          <PageError
            error={reconciliationsQ.error}
            retry={() => void reconciliationsQ.refetch()}
          />
        ) : (reconciliationsQ.data?.items ?? []).length === 0 ? (
          <Alert type="info" showIcon message="暂无对账批次" description="对账运行后将在此展示。" />
        ) : (
          <div className="qt-table-scroll">
            <Table<ReconciliationRun>
              size="small"
              rowKey="id"
              dataSource={reconciliationsQ.data?.items ?? []}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              expandable={{
                expandedRowRender: (row) => <ReconciliationRunDetail runId={row.id} />,
                rowExpandable: (row) => row.differencesCount > 0,
              }}
              columns={[
                {
                  title: '批次',
                  dataIndex: 'id',
                  width: 180,
                  render: (value: string) => <CopyableId id={value} maxLength={18} />,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (value: string) => (
                    <Tag color={RECONCILIATION_STATUS[value]?.color ?? 'default'}>
                      {RECONCILIATION_STATUS[value]?.label ?? value}
                    </Tag>
                  ),
                },
                {
                  title: '检查项',
                  dataIndex: 'checkedTargetsCount',
                  width: 100,
                  render: (v: number) => v.toLocaleString('zh-CN'),
                },
                {
                  title: '差异项',
                  dataIndex: 'differencesCount',
                  width: 100,
                  render: (v: number) => (
                    <span style={{ color: v > 0 ? '#CF1322' : undefined }}>
                      {v.toLocaleString('zh-CN')}
                    </span>
                  ),
                },
                { title: '说明', dataIndex: 'summary', ellipsis: true },
                {
                  title: '开始时间',
                  dataIndex: 'startedAt',
                  width: 180,
                  render: (v: string) => formatDateTime(v, { zone: false }),
                },
                {
                  title: '完成时间',
                  dataIndex: 'completedAt',
                  width: 180,
                  render: (v: string | null) => (v ? formatDateTime(v, { zone: false }) : '—'),
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Card size="small" title="每日报告" style={{ marginTop: 16 }}>
        {dailyReportQ.isLoading ? (
          <PageLoading withTitle={false} rows={2} />
        ) : dailyReportQ.error ? (
          <PageError
            error={dailyReportQ.error}
            retry={() => void dailyReportQ.refetch()}
          />
        ) : dailyReportQ.data ? (
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="报告日期">{dailyReportQ.data.date}</Descriptions.Item>
            <Descriptions.Item label="当日盈亏">
              <span style={{ color: dailyReportQ.data.dayPnl >= 0 ? '#CF1322' : '#237804' }}>
                {dailyReportQ.data.dayPnl.toLocaleString('zh-CN')} 元
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="当日盈亏比例">
              {`${dailyReportQ.data.dayPnlPct >= 0 ? '+' : ''}${dailyReportQ.data.dayPnlPct.toFixed(2)}%`}
            </Descriptions.Item>
            <Descriptions.Item label="换手率">
              {`${dailyReportQ.data.turnover.toFixed(2)}%`}
            </Descriptions.Item>
            <Descriptions.Item label="总费用">
              {dailyReportQ.data.totalFees.toLocaleString('zh-CN')} 元
            </Descriptions.Item>
            <Descriptions.Item label="成交订单数">
              {dailyReportQ.data.filledOrdersCount.toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="未知订单数">
              <span style={{ color: dailyReportQ.data.unknownOrdersCount > 0 ? '#CF1322' : undefined }}>
                {dailyReportQ.data.unknownOrdersCount.toLocaleString('zh-CN')}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {dailyReportQ.data.notes ?? '—'}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert type="info" showIcon message="暂无每日报告" />
        )}
      </Card>

      <div style={{ marginTop: 12, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
        最近更新：{formatDateTime(snapshot.updatedAt, { zone: false })}
      </div>

      <ConfirmModal
        open={stopOpen}
        title="人工停机"
        description="停机后不再扩大风险；已提交订单和未知状态仍需单独完成对账。"
        confirmText="停机并留痕"
        danger
        onCancel={() => setStopOpen(false)}
        onOk={async (reason) => {
          const result = await manualStopPaperTrading(reason)
          await queryClient.invalidateQueries({ queryKey: ['paperTradingReal'] })
          return result.auditId
        }}
      />
    </div>
  )
}

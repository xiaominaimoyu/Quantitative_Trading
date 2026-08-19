/** 模拟盘（mock 模式）：沙箱账户、订单、对账与人工停机 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag } from 'antd'
import { useAuth } from '@/app/AuthContext'
import { getPaperTradingSnapshot, manualStopPaperTrading } from '@/api/mock/paperTrading'
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

export default function PaperTradingMockPage() {
  const [stopOpen, setStopOpen] = useState(false)
  const queryClient = useQueryClient()
  const { role } = useAuth()
  const canStop = role === 'admin'
  const snapshotQ = useQuery({ queryKey: ['paperTrading'], queryFn: () => getPaperTradingSnapshot(), refetchInterval: 5000 })

  if (snapshotQ.isLoading) return <PageLoading rows={10} />
  if (snapshotQ.error) return <PageError error={snapshotQ.error} retry={() => void snapshotQ.refetch()} />
  if (!snapshotQ.data) return null

  const snapshot = snapshotQ.data
  const hasUnknown = snapshot.orders.some((order) => order.status === 'unknown')

  return (
    <div>
      <PageHeader
        title="模拟盘"
        subtitle="与真实交易完全隔离的沙箱监控界面"
        meta={[<StatusTag key="status" status={snapshot.status} label={snapshot.status === 'running' ? '运行中' : '已停机'} />]}
        extra={<Button danger disabled={!canStop || snapshot.status === 'stopped'} onClick={() => setStopOpen(true)}>人工停机</Button>}
      />
      {!canStop ? <Alert style={{ marginTop: 12 }} type="info" showIcon message="人工停机仅对管理员开放" /> : null}

      <Alert
        style={{ marginTop: 16 }}
        type="warning"
        showIcon
        message="当前仅为模拟盘演示数据，不连接真实账户、券商或下单接口。"
        description="订单状态以持久化事实和对账结果为准；未知状态不得被当作成交。"
      />
      {hasUnknown ? <Alert style={{ marginTop: 12 }} type="error" showIcon message="存在未知订单状态，请先完成对账确认" /> : null}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="账户总资产" value={snapshot.account.total} suffix="元" precision={2} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="可用资金" value={snapshot.account.available} suffix="元" precision={2} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="持仓市值" value={snapshot.account.marketValue} suffix="元" precision={2} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="当日盈亏" value={snapshot.account.dayPnl} suffix="元" precision={2} valueStyle={{ color: snapshot.account.dayPnl >= 0 ? '#CF1322' : '#237804' }} /></Card></Col>
      </Row>

      <Card size="small" title="持仓" style={{ marginTop: 16 }}>
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="symbol"
            dataSource={snapshot.positions}
            pagination={false}
            columns={[
              { title: '标的', dataIndex: 'symbol', width: 120, render: (value, row) => <Space direction="vertical" size={0}><span>{row.name}</span><span className="qt-mono" style={{ fontSize: 12 }}>{value}</span></Space> },
              { title: '数量', dataIndex: 'quantity', width: 100, render: (value) => value.toLocaleString('zh-CN') },
              { title: '市值', dataIndex: 'marketValue', width: 130, render: (value) => `${value.toLocaleString('zh-CN')} 元` },
              { title: '盈亏', dataIndex: 'pnl', width: 120, render: (value) => <span style={{ color: value >= 0 ? '#CF1322' : '#237804' }}>{value.toLocaleString('zh-CN')} 元</span> },
              { title: '盈亏比例', dataIndex: 'pnlPct', width: 100, render: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` },
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
              { title: '订单号', dataIndex: 'id', width: 190, render: (value) => <CopyableId id={value} maxLength={18} /> },
              { title: '标的', dataIndex: 'symbol', width: 110 },
              { title: '方向', dataIndex: 'direction', width: 80 },
              { title: '委托/成交', width: 120, render: (_, row) => `${row.filledQuantity} / ${row.quantity}` },
              { title: '价格', dataIndex: 'price', width: 100, render: (value) => value.toFixed(2) },
              { title: '状态', dataIndex: 'status', width: 140, render: (value) => <Tag color={ORDER_STATUS[value]?.color}>{ORDER_STATUS[value]?.label ?? value}</Tag> },
              { title: '提交时间', dataIndex: 'submittedAt', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
            ]}
          />
        </div>
      </Card>

      <Card size="small" title="对账" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          dataSource={snapshot.reconciliations}
          pagination={false}
          columns={[
            { title: '对账项', dataIndex: 'target' },
            { title: '结论', dataIndex: 'type', width: 110, render: (value) => <Tag color={value === 'matched' ? 'success' : 'error'}>{value === 'matched' ? '一致' : '存在差异'}</Tag> },
            { title: '说明', dataIndex: 'summary' },
            { title: '检查时间', dataIndex: 'checkedAt', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
          ]}
        />
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
          await queryClient.invalidateQueries({ queryKey: ['paperTrading'] })
          return result.auditId
        }}
      />
    </div>
  )
}

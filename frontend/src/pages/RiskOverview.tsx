import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Space, Table, Tabs, Tag } from 'antd'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  createRiskRuleSet,
  listRiskEvents,
  listRiskRuleSets,
  RESEARCH_VERSION_STATUS_LABEL,
} from '@/api/risk'
import type { RiskEventReason } from '@/api/risk'
import { isForbiddenError } from '@/api/research/ui'
import { useAuth } from '@/app/AuthContext'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import ResearchContainerCreateModal from '@/components/research/ResearchContainerCreateModal'
import { DisabledNotice, PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

const RISK_EVENT_REASON_LABEL: Record<RiskEventReason, { label: string; color: string }> = {
  RISK_REJECTED: { label: '交易拒绝', color: 'error' },
  RISK_SCALE_DOWN: { label: '仓位缩减', color: 'warning' },
  RISK_VOLATILITY_BREACH: { label: '波动率突破', color: 'warning' },
  RISK_DRAWDOWN_BREACH: { label: '回撤突破', color: 'error' },
  RISK_TURNOVER_BREACH: { label: '换手率突破', color: 'warning' },
  RISK_DATA_STALE: { label: '数据陈旧', color: 'error' },
}

export default function RiskOverviewPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { hasScope } = useAuth()
  const canReadEvents = hasScope('risk-event:read')
  const [createOpen, setCreateOpen] = useState(false)
  const [lastAuditId, setLastAuditId] = useState<string | null>(null)
  const activeTab = params.get('tab') === 'events' ? 'events' : 'rules'
  const rulesQ = useQuery({ queryKey: ['riskRuleSets'], queryFn: () => listRiskRuleSets() })
  const eventsQ = useQuery({
    queryKey: ['riskEvents'],
    queryFn: () => listRiskEvents({ pageSize: 50 }),
    enabled: canReadEvents && activeTab === 'events',
  })

  if (rulesQ.isLoading) return <PageLoading rows={8} />
  if (isForbiddenError(rulesQ.error)) return <PageForbidden description="当前身份没有风险规则读取权限" />
  if (rulesQ.error) return <PageError error={rulesQ.error} retry={() => void rulesQ.refetch()} />
  const rules = rulesQ.data?.items ?? []

  return (
    <div>
      <PageHeader
        title="风险管理"
        subtitle="A 股日线风险规则的不可变版本注册中心"
        extra={hasScope('risk:create') ? <Button type="primary" onClick={() => setCreateOpen(true)}>新建规则集</Button> : undefined}
      />
      {lastAuditId ? <Alert style={{ marginTop: 16 }} type="success" showIcon message="风险规则集创建完成" description={<CopyableId id={lastAuditId} maxLength={0} />} /> : null}
      <Tabs
        style={{ marginTop: 16 }}
        activeKey={activeTab}
        onChange={(tab) => setParams(tab === 'events' ? { tab: 'events' } : {})}
        items={[
          {
            key: 'rules',
            label: `规则集（${rules.length}）`,
            children: rules.length === 0 ? (
              <PageEmpty title="暂无风险规则集" description="当前查询没有返回规则集" />
            ) : (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={rules}
                  onRow={(row) => ({
                    onClick: () => navigate(`/risk/rule-sets/${row.id}`),
                    style: { cursor: 'pointer' },
                  })}
                  columns={[
                    {
                      title: '规则集',
                      dataIndex: 'name',
                      render: (name, row) => (
                        <Space direction="vertical" size={0}>
                          <Link to={`/risk/rule-sets/${row.id}`} onClick={(event) => event.stopPropagation()}>{name}</Link>
                          <CopyableId id={row.id} maxLength={18} />
                        </Space>
                      ),
                    },
                    { title: '描述', dataIndex: 'description', ellipsis: true, render: (value) => value ?? '—' },
                    { title: 'Owner', dataIndex: 'ownerKey', ellipsis: true },
                    { title: '版本数', dataIndex: 'versionCount', width: 80 },
                    {
                      title: '最新版本',
                      width: 120,
                      render: (_, row) => row.latestVersionId ? (
                        <Link
                          to={`/risk/rule-sets/${row.id}/versions/${row.latestVersionId}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          v{row.latestVersionNo}
                        </Link>
                      ) : '—',
                    },
                    {
                      title: '状态',
                      width: 110,
                      render: (_, row) => row.latestVersionStatus ? <StatusTag status={row.latestVersionStatus} label={RESEARCH_VERSION_STATUS_LABEL[row.latestVersionStatus]} /> : '—',
                    },
                    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value) => formatDateTime(value, { zone: false }) },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'events',
            label: `风险事件${eventsQ.data ? `（${eventsQ.data.items.length}）` : ''}`,
            children: !canReadEvents ? (
              <DisabledNotice
                title="风险事件查询权限不足"
                readOnly={false}
                reason="当前角色未授予 risk-event:read 权限。"
              />
            ) : eventsQ.isLoading ? (
              <PageLoading rows={6} />
            ) : eventsQ.error ? (
              <PageError error={eventsQ.error} retry={() => void eventsQ.refetch()} />
            ) : eventsQ.data && eventsQ.data.items.length > 0 ? (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  dataSource={eventsQ.data.items}
                  columns={[
                    {
                      title: '原因',
                      dataIndex: 'reasonCode',
                      width: 130,
                      render: (value: RiskEventReason) => {
                        const meta = RISK_EVENT_REASON_LABEL[value] ?? { label: value, color: 'default' }
                        return <Tag color={meta.color}>{meta.label}</Tag>
                      },
                    },
                    { title: '交易日', dataIndex: 'tradeDate', width: 120 },
                    { title: '标的', dataIndex: 'symbol', width: 110 },
                    {
                      title: '运行',
                      dataIndex: 'runId',
                      width: 130,
                      render: (value, row) => value ? <Link to={`/experiments/${row.experimentId ?? ''}/runs/${value}`}>{value}</Link> : '—',
                    },
                    {
                      title: '实验',
                      dataIndex: 'experimentId',
                      width: 160,
                      render: (value) => value ? <Link to={`/experiments/${value}`}>{value}</Link> : '—',
                    },
                    { title: '详情', dataIndex: 'detail', ellipsis: true },
                    { title: '观察者', dataIndex: 'observedByKey', width: 130, ellipsis: true },
                    { title: '发生时间', dataIndex: 'createdAt', width: 170, render: (value) => formatDateTime(value, { zone: false }) },
                  ]}
                />
              </div>
            ) : (
              <PageEmpty title="暂无风险事件" description="运行触发风险规则后将在此展示；mock 模式不提供风险事件样本。" />
            ),
          },
        ]}
      />
      <ResearchContainerCreateModal
        open={createOpen}
        title="新建风险规则集"
        idempotencyPrefix="risk-rule-set-create"
        create={createRiskRuleSet}
        onCancel={() => setCreateOpen(false)}
        onCreated={async (result) => {
          setLastAuditId(result.auditEventId)
          setCreateOpen(false)
          await rulesQ.refetch()
          navigate(`/risk/rule-sets/${result.item.id}`, { state: { auditEventId: result.auditEventId } })
        }}
      />
    </div>
  )
}

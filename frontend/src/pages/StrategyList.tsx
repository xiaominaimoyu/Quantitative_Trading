import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Space, Table, Tabs } from 'antd'
import { Link, useNavigate } from 'react-router'
import { createStrategy, listStrategies, RESEARCH_VERSION_STATUS_LABEL } from '@/api/strategies'
import { createModel, listModels } from '@/api/models'
import { isForbiddenError } from '@/api/research/ui'
import { useAuth } from '@/app/AuthContext'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import ResearchContainerCreateModal from '@/components/research/ResearchContainerCreateModal'
import { PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

export default function StrategyListPage() {
  const navigate = useNavigate()
  const { hasScope } = useAuth()
  const [createKind, setCreateKind] = useState<'strategy' | 'model' | null>(null)
  const [lastAuditId, setLastAuditId] = useState<string | null>(null)
  const strategiesQ = useQuery({ queryKey: ['strategies'], queryFn: () => listStrategies() })
  const modelsQ = useQuery({ queryKey: ['models'], queryFn: () => listModels() })

  if (strategiesQ.isLoading || modelsQ.isLoading) return <PageLoading />
  const error = strategiesQ.error ?? modelsQ.error
  if (isForbiddenError(error)) return <PageForbidden description="当前身份没有策略与模型读取权限" />
  if (error) {
    return (
      <PageError
        error={error}
        retry={() => {
          void strategiesQ.refetch()
          void modelsQ.refetch()
        }}
      />
    )
  }

  const strategies = strategiesQ.data?.items ?? []
  const models = modelsQ.data?.items ?? []

  return (
    <div>
      <PageHeader
        title="策略实验室"
        subtitle="策略与无预测基线模型的不可变版本注册中心"
        extra={(
          <Space>
            {hasScope('strategy:create') ? <Button type="primary" onClick={() => setCreateKind('strategy')}>新建策略</Button> : null}
            {hasScope('model:create') ? <Button onClick={() => setCreateKind('model')}>新建模型</Button> : null}
          </Space>
        )}
      />
      {lastAuditId ? <Alert style={{ marginTop: 16 }} type="success" showIcon message="注册项创建完成" description={<CopyableId id={lastAuditId} maxLength={0} />} /> : null}
      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'strategies',
            label: `策略（${strategies.length}）`,
            children: strategies.length === 0 ? (
              <PageEmpty title="暂无策略" description="当前查询没有返回策略注册项" />
            ) : (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={strategies}
                  onRow={(row) => ({
                    onClick: () => navigate(`/strategies/${row.id}`),
                    style: { cursor: 'pointer' },
                  })}
                  columns={[
                    {
                      title: '名称',
                      dataIndex: 'name',
                      render: (name, row) => (
                        <Space direction="vertical" size={0}>
                          <Link to={`/strategies/${row.id}`} onClick={(event) => event.stopPropagation()}>{name}</Link>
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
                          to={`/strategies/${row.id}/versions/${row.latestVersionId}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          v{row.latestVersionNo}
                        </Link>
                      ) : '—',
                    },
                    {
                      title: '状态',
                      width: 110,
                      render: (_, row) => row.latestVersionStatus ? (
                        <StatusTag status={row.latestVersionStatus} label={RESEARCH_VERSION_STATUS_LABEL[row.latestVersionStatus]} />
                      ) : '—',
                    },
                    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value) => formatDateTime(value, { zone: false }) },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'models',
            label: `模型（${models.length}）`,
            children: models.length === 0 ? (
              <PageEmpty title="暂无模型" description="B3 只登记无预测基线元数据" />
            ) : (
              <div className="qt-table-scroll">
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={models}
                  onRow={(row) => ({
                    onClick: () => navigate(`/models/${row.id}`),
                    style: { cursor: 'pointer' },
                  })}
                  columns={[
                    {
                      title: '名称',
                      dataIndex: 'name',
                      render: (name, row) => (
                        <Space direction="vertical" size={0}>
                          <Link to={`/models/${row.id}`} onClick={(event) => event.stopPropagation()}>{name}</Link>
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
                          to={`/models/${row.id}/versions/${row.latestVersionId}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          v{row.latestVersionNo}
                        </Link>
                      ) : '—',
                    },
                    {
                      title: '状态',
                      width: 110,
                      render: (_, row) => row.latestVersionStatus ? (
                        <StatusTag status={row.latestVersionStatus} label={RESEARCH_VERSION_STATUS_LABEL[row.latestVersionStatus]} />
                      ) : '—',
                    },
                    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value) => formatDateTime(value, { zone: false }) },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
      <ResearchContainerCreateModal
        open={createKind === 'strategy'}
        title="新建策略注册项"
        idempotencyPrefix="strategy-create"
        create={createStrategy}
        onCancel={() => setCreateKind(null)}
        onCreated={async (result) => {
          setLastAuditId(result.auditEventId)
          setCreateKind(null)
          await strategiesQ.refetch()
          navigate(`/strategies/${result.item.id}`, { state: { auditEventId: result.auditEventId } })
        }}
      />
      <ResearchContainerCreateModal
        open={createKind === 'model'}
        title="新建模型注册项"
        idempotencyPrefix="model-create"
        create={createModel}
        onCancel={() => setCreateKind(null)}
        onCreated={async (result) => {
          setLastAuditId(result.auditEventId)
          setCreateKind(null)
          await modelsQ.refetch()
          navigate(`/models/${result.item.id}`, { state: { auditEventId: result.auditEventId } })
        }}
      />
    </div>
  )
}

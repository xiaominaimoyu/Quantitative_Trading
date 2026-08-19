/** 数据版本列表：服务端筛选、分页和快照创建入口。 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Select, Space, Table } from 'antd'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import { getDataset, listDataSources, listDatasetVersions } from '@/api/datasets'
import { PageHeader, StatusTag } from '@/components'
import SnapshotCreateModal from '@/components/datasets/SnapshotCreateModal'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatCompact, formatDateTime } from '@/shared/format'

const PAGE_SIZE = 20

export default function VersionListPage() {
  const { datasetId = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const status = params.get('status') ?? ''
  const qualityStatus = params.get('quality') ?? ''
  const sourceId = params.get('source') ?? ''
  const requestedPage = Number(params.get('page') ?? '1')
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  const datasetQ = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId),
    enabled: !!datasetId,
  })
  const versionsQ = useQuery({
    queryKey: ['datasetVersions', datasetId, { page, status, qualityStatus, sourceId }],
    queryFn: () => listDatasetVersions(datasetId, {
      page,
      pageSize: PAGE_SIZE,
      status: status || undefined,
      qualityStatus: qualityStatus || undefined,
      sourceId: sourceId || undefined,
    }),
    enabled: !!datasetId,
  })
  const sourcesQ = useQuery({
    queryKey: ['dataSources', 'active'],
    queryFn: () => listDataSources({ status: 'active', pageSize: 100 }),
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  if (datasetQ.isLoading || versionsQ.isLoading) return <PageLoading />
  if (datasetQ.error || versionsQ.error) {
    return (
      <PageError
        error={datasetQ.error ?? versionsQ.error}
        retry={() => {
          void datasetQ.refetch()
          void versionsQ.refetch()
        }}
      />
    )
  }

  const data = versionsQ.data
  const versions = data?.items ?? []
  const canCreate = role === 'researcher' || role === 'admin'

  return (
    <div>
      <PageHeader
        parent="数据目录"
        title={`${datasetQ.data?.name ?? datasetId} · 版本`}
        subtitle="不可变数据快照与质量状态"
        extra={canCreate ? (
          <Button type="primary" onClick={() => setCreateOpen(true)}>新建快照</Button>
        ) : undefined}
      />

      <Space wrap style={{ margin: '16px 0' }}>
        <Select
          allowClear
          placeholder="版本状态"
          style={{ width: 140 }}
          value={status || undefined}
          onChange={(value) => updateParam('status', value)}
          options={[
            { value: 'draft', label: '草稿' },
            { value: 'validating', label: '校验中' },
            { value: 'available', label: '可用' },
            { value: 'failed', label: '失败' },
            { value: 'deprecated', label: '已停用' },
          ]}
        />
        <Select
          allowClear
          placeholder="质量状态"
          style={{ width: 140 }}
          value={qualityStatus || undefined}
          onChange={(value) => updateParam('quality', value)}
          options={[
            { value: 'pending', label: '待检查' },
            { value: 'passed', label: '通过' },
            { value: 'warning', label: '警告' },
            { value: 'blocked', label: '阻断' },
            { value: 'failed', label: '失败' },
          ]}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="数据源"
          style={{ width: 200 }}
          loading={sourcesQ.isLoading}
          value={sourceId || undefined}
          onChange={(value) => updateParam('source', value)}
          options={(sourcesQ.data?.items ?? []).map((source) => ({
            value: source.id,
            label: source.name,
          }))}
        />
      </Space>

      {versions.length === 0 ? (
        <PageEmpty title="暂无匹配的数据版本" description="调整筛选条件或创建新快照" />
      ) : (
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={versions}
            pagination={false}
            onRow={(row) => ({
              onClick: () => navigate(`/datasets/${datasetId}/versions/${row.id}`),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: '版本 ID',
                dataIndex: 'id',
                render: (id) => (
                  <Link to={`/datasets/${datasetId}/versions/${id}`} onClick={(event) => event.stopPropagation()}>
                    {id}
                  </Link>
                ),
              },
              { title: '版本号', dataIndex: 'version', width: 80, render: (value) => `v${value}` },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value) => <StatusTag status={value} domain="dataVersion" />,
              },
              { title: '时间范围', dataIndex: 'timeRange', render: (value) => value ?? '—' },
              { title: '行数', dataIndex: 'rowCount', width: 100, render: formatCompact },
              {
                title: '质量',
                dataIndex: 'qualityStatus',
                width: 90,
                render: (value) => <StatusTag status={value} domain="quality" />,
              },
              {
                title: '逻辑哈希',
                dataIndex: 'logicalContentSha256',
                width: 150,
                ellipsis: true,
                render: (value) => value ?? '—',
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 160,
                render: (value) => formatDateTime(value, { zone: false }),
              },
            ]}
          />
        </div>
      )}

      <Space style={{ marginTop: 16 }}>
        <Button disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}>
          上一页
        </Button>
        <span>第 {page} 页</span>
        <Button
          disabled={!data?.page.hasMore}
          onClick={() => updateParam('page', String(data?.page.nextCursor ?? page + 1))}
        >
          下一页
        </Button>
      </Space>

      <SnapshotCreateModal
        datasetId={datasetId}
        parentVersionId={datasetQ.data?.latestVersionId}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
      />
    </div>
  )
}

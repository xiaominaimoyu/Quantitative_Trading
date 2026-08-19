/** 数据集详情：真实元数据与版本时间线。 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Space, Table } from 'antd'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import { getDataset, listDatasetVersions } from '@/api/datasets'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import SnapshotCreateModal from '@/components/datasets/SnapshotCreateModal'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatCompact, formatDateTime } from '@/shared/format'

export default function DatasetDetailPage() {
  const { datasetId = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)

  const datasetQ = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId),
    enabled: !!datasetId,
  })
  const versionsQ = useQuery({
    queryKey: ['datasetVersions', datasetId, { page: 1, pageSize: 100 }],
    queryFn: () => listDatasetVersions(datasetId, { page: 1, pageSize: 100 }),
    enabled: !!datasetId,
  })

  if (datasetQ.isLoading || versionsQ.isLoading) return <PageLoading />
  if (datasetQ.error) {
    return <PageError error={datasetQ.error} retry={() => void datasetQ.refetch()} />
  }
  if (versionsQ.error) {
    return <PageError error={versionsQ.error} retry={() => void versionsQ.refetch()} />
  }

  const dataset = datasetQ.data
  const versions = versionsQ.data?.items ?? []
  if (!dataset) return <PageEmpty title="数据集不存在" />
  const canCreate = role === 'researcher' || role === 'admin'

  return (
    <div>
      <PageHeader
        parent="数据目录"
        title={dataset.name}
        subtitle={dataset.source ?? '尚未登记来源'}
        meta={[
          <CopyableId key="id" id={dataset.id} prefix="ID " maxLength={0} />,
          dataset.market,
          dataset.frequency,
        ]}
        extra={
          <Space>
            <Button onClick={() => navigate(`/datasets/${datasetId}/versions`)}>全部版本</Button>
            {canCreate ? (
              <Button type="primary" onClick={() => setCreateOpen(true)}>新建快照</Button>
            ) : null}
          </Space>
        }
      />

      <Descriptions size="small" bordered column={2} style={{ marginTop: 16 }}>
        <Descriptions.Item label="数据源">{dataset.source ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="许可证">{dataset.license}</Descriptions.Item>
        <Descriptions.Item label="Schema">{dataset.schemaVersion}</Descriptions.Item>
        <Descriptions.Item label="时间范围">{dataset.timeRange ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="行数">{formatCompact(dataset.rowCount)}</Descriptions.Item>
        <Descriptions.Item label="质量结论">
          <StatusTag status={dataset.qualityStatus} domain="quality" />
        </Descriptions.Item>
        <Descriptions.Item label="正式使用资格">
          {dataset.eligibleForFormalUse ? '合格' : '不合格'}
        </Descriptions.Item>
        <Descriptions.Item label="逻辑内容哈希">
          {dataset.logicalContentSha256
            ? <CopyableId id={dataset.logicalContentSha256} maxLength={24} />
            : '—'}
        </Descriptions.Item>
      </Descriptions>

      <h3 style={{ marginTop: 24, fontSize: 15 }}>版本时间线</h3>
      {versions.length === 0 ? (
        <PageEmpty title="暂无版本" description="创建第一个不可变数据快照" />
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
              { title: '版本', dataIndex: 'version', width: 72, render: (value) => `v${value}` },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value) => <StatusTag status={value} domain="dataVersion" />,
              },
              { title: '时间范围', dataIndex: 'timeRange', render: (value) => value ?? '—' },
              { title: '行数', dataIndex: 'rowCount', width: 90, render: formatCompact },
              {
                title: '质量',
                dataIndex: 'qualityStatus',
                width: 90,
                render: (value) => <StatusTag status={value} domain="quality" />,
              },
              {
                title: '逻辑哈希',
                dataIndex: 'logicalContentSha256',
                width: 140,
                ellipsis: true,
                render: (value) => value ?? '—',
              },
              {
                title: '创建任务',
                dataIndex: 'taskId',
                width: 140,
                ellipsis: true,
                render: (value) => value ?? '—',
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 160,
                render: (value) => formatDateTime(value, { zone: false }),
              },
              {
                title: '操作',
                width: 80,
                render: (_, row) => (
                  <Link
                    to={`/datasets/${datasetId}/versions/${row.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    详情
                  </Link>
                ),
              },
            ]}
          />
          {versionsQ.data?.page.hasMore ? (
            <Alert
              type="info"
              showIcon
              message="此处仅展示最近 100 个版本；请进入“全部版本”继续分页浏览。"
              style={{ marginTop: 12 }}
            />
          ) : null}
        </div>
      )}

      <SnapshotCreateModal
        datasetId={datasetId}
        parentVersionId={dataset.latestVersionId}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
      />
    </div>
  )
}

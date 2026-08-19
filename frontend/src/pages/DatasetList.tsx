/** 数据目录列表：筛选与分页均由服务端执行。 */

import { useQuery } from '@tanstack/react-query'
import { Button, Input, Select, Space, Table } from 'antd'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { listDataSources, listDatasets } from '@/api/datasets'
import { PageHeader, StatusTag } from '@/components'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatCompact, formatDateTime } from '@/shared/format'

const PAGE_SIZE = 20

export default function DatasetListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const market = params.get('market') ?? ''
  const frequency = params.get('frequency') ?? ''
  const status = params.get('status') ?? ''
  const sourceId = params.get('source') ?? ''
  const query = params.get('q') ?? ''
  const requestedPage = Number(params.get('page') ?? '1')
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  const datasetsQ = useQuery({
    queryKey: ['datasets', { page, market, frequency, status, sourceId, query }],
    queryFn: () => listDatasets({
      page,
      pageSize: PAGE_SIZE,
      name: query || undefined,
      market: market || undefined,
      frequency: frequency || undefined,
      status: status || undefined,
      sourceId: sourceId || undefined,
    }),
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

  if (datasetsQ.isLoading) return <PageLoading />
  if (datasetsQ.error) {
    return <PageError error={datasetsQ.error} retry={() => void datasetsQ.refetch()} />
  }

  const data = datasetsQ.data
  const items = data?.items ?? []

  return (
    <div>
      <PageHeader
        title="数据目录"
        subtitle="找到可用数据版本并理解其质量与授权边界"
      />

      <Space wrap style={{ margin: '16px 0' }}>
        <Select
          allowClear
          placeholder="市场"
          aria-label="筛选市场"
          style={{ width: 120 }}
          value={market || undefined}
          onChange={(value) => updateParam('market', value)}
          options={[
            { value: 'CN', label: '中国市场' },
            { value: 'A 股', label: 'A 股' },
          ]}
        />
        <Select
          allowClear
          placeholder="周期"
          aria-label="筛选周期"
          style={{ width: 120 }}
          value={frequency || undefined}
          onChange={(value) => updateParam('frequency', value)}
          options={[
            { value: 'daily', label: '日频' },
            { value: 'weekly', label: '周频' },
            { value: 'monthly', label: '月频' },
            { value: 'quarterly', label: '季频' },
            { value: 'minute', label: '分钟' },
          ]}
        />
        <Select
          allowClear
          placeholder="最新版本状态"
          aria-label="筛选版本状态"
          style={{ width: 150 }}
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
          showSearch
          optionFilterProp="label"
          placeholder="数据源"
          aria-label="筛选数据源"
          style={{ width: 200 }}
          loading={sourcesQ.isLoading}
          value={sourceId || undefined}
          onChange={(value) => updateParam('source', value)}
          options={(sourcesQ.data?.items ?? []).map((source) => ({
            value: source.id,
            label: source.name,
          }))}
        />
        <Input.Search
          allowClear
          value={query}
          placeholder="搜索名称"
          aria-label="搜索数据集名称"
          style={{ width: 220 }}
          onChange={(event) => updateParam('q', event.target.value || undefined)}
        />
      </Space>

      {items.length === 0 ? (
        <PageEmpty title="暂无匹配的数据集" description="调整服务端筛选条件后重试" />
      ) : (
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={items}
            pagination={false}
            onRow={(row) => ({
              onClick: () => navigate(`/datasets/${row.id}`),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: '逻辑名称',
                dataIndex: 'name',
                render: (name, row) => (
                  <Link to={`/datasets/${row.id}`} onClick={(event) => event.stopPropagation()}>
                    {name}
                  </Link>
                ),
              },
              { title: '市场', dataIndex: 'market', width: 90 },
              { title: '周期', dataIndex: 'frequency', width: 72 },
              { title: '来源', dataIndex: 'source', ellipsis: true, render: (value) => value ?? '—' },
              { title: '许可证', dataIndex: 'license', width: 120 },
              { title: 'Schema', dataIndex: 'schemaVersion', width: 140 },
              {
                title: '最新版本',
                dataIndex: 'latestVersionStatus',
                width: 100,
                render: (value) => <StatusTag status={value} domain="dataVersion" />,
              },
              { title: '时间范围', dataIndex: 'timeRange', width: 200, render: (value) => value ?? '—' },
              {
                title: '行数',
                dataIndex: 'rowCount',
                width: 90,
                render: (value) => <span className="qt-tabular">{formatCompact(value)}</span>,
              },
              {
                title: '质量结论',
                dataIndex: 'qualityStatus',
                width: 90,
                render: (value) => <StatusTag status={value} domain="quality" />,
              },
              {
                title: '逻辑哈希',
                dataIndex: 'logicalContentSha256',
                width: 130,
                ellipsis: true,
                render: (value) => value ?? '—',
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 160,
                render: (value) => formatDateTime(value, { zone: false }),
              },
            ]}
          />
        </div>
      )}

      <Space style={{ marginTop: 16 }}>
        <Button
          disabled={page <= 1}
          onClick={() => updateParam('page', String(page - 1))}
        >
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
    </div>
  )
}

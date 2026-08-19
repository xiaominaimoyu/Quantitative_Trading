/** 报告列表：研究报告 / 审计报告 */

import { useQuery } from '@tanstack/react-query'
import { Button, Input, Result, Select, Space, Table } from 'antd'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { listReports } from '@/api/reports'
import { useAuth } from '@/app/AuthContext'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

export default function ReportListPage() {
  const { hasScope } = useAuth()
  const canRead = hasScope('report:read')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const status = params.get('status') ?? ''

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports'],
    queryFn: () => listReports(),
    enabled: canRead,
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  if (!canRead) {
    return <Result status="403" title="权限不足" subTitle="报告列表仅对具备 report:read 权限的角色开放。" />
  }
  if (isLoading) return <PageLoading />
  if (error) return <PageError error={error} retry={() => void refetch()} />

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = (data ?? []).filter((report) => {
    if (status && report.status !== status) return false
    if (!normalizedQuery) return true
    return [report.id, report.title, report.experimentId]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  })

  const clearFilters = () => setParams(new URLSearchParams())

  return (
    <div>
      <PageHeader
        title="报告"
        subtitle="按事实、推断、限制和批准状态阅读研究产物"
      />

      <Space wrap style={{ margin: '16px 0' }}>
        <Input
          allowClear
          value={query}
          placeholder="搜索报告、实验"
          style={{ width: 260 }}
          onChange={(e) => updateParam('q', e.target.value || undefined)}
        />
        <Select
          allowClear
          value={status || undefined}
          placeholder="报告状态"
          style={{ width: 140 }}
          options={[
            { value: 'draft', label: '草案' },
            { value: 'submitted', label: '待批准' },
            { value: 'approved', label: '已批准' },
            { value: 'deprecated', label: '已停用' },
          ]}
          onChange={(value) => updateParam('status', value)}
        />
      </Space>

      {filtered.length === 0 ? (
        <PageEmpty
          title={data?.length ? '暂无匹配报告' : '暂无报告'}
          description={data?.length ? '调整筛选条件后重试' : '实验生成报告后将在此展示'}
          action={data?.length ? <Button onClick={clearFilters}>清除筛选</Button> : undefined}
        />
      ) : (
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={filtered}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            onRow={(row) => ({
              onClick: () => navigate(`/reports/${row.id}`),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: '报告',
                dataIndex: 'title',
                render: (title, row) => (
                  <Space direction="vertical" size={0}>
                    <Link to={`/reports/${row.id}`} onClick={(e) => e.stopPropagation()}>
                      {title}
                    </Link>
                    <CopyableId id={row.id} maxLength={0} copyable />
                  </Space>
                ),
              },
              { title: '实验', dataIndex: 'experimentId', width: 180, render: (value) => <CopyableId id={value} maxLength={18} /> },
              {
                title: '状态',
                dataIndex: 'status',
                width: 110,
                render: (value) => <StatusTag status={value} domain="report" />,
              },
              { title: '批准人', dataIndex: 'approvedByKey', width: 120, render: (value) => value ?? '—' },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 180,
                render: (value) => formatDateTime(value, { zone: false }),
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}

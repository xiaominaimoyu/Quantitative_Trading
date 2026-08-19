/** 实验列表 */

import { useQuery } from '@tanstack/react-query'
import { Button, Table } from 'antd'
import { Link, useNavigate } from 'react-router'
import { listExperiments } from '@/api/mock/experiments'
import { PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

const STATUS_LABEL: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  archived: '已归档',
}

export default function ExperimentListPage() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['experiments'],
    queryFn: () => listExperiments(),
  })

  if (isLoading) return <PageLoading />
  if (error) return <PageError error={error} retry={() => void refetch()} />

  return (
    <div>
      <PageHeader
        title="实验"
        subtitle="预注册协议下的研究实验"
        extra={<Button type="primary" onClick={() => navigate('/experiments/new')}>新建实验</Button>}
      />
      <div className="qt-table-scroll" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          dataSource={data ?? []}
          onRow={(row) => ({ onClick: () => navigate(`/experiments/${row.id}`), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (name, row) => (
                <Link to={`/experiments/${row.id}`} onClick={(e) => e.stopPropagation()}>
                  {name}
                </Link>
              ),
            },
            { title: '假设摘要', dataIndex: 'hypothesisSummary', ellipsis: true },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s) => STATUS_LABEL[s] ?? s,
            },
            { title: '运行数', dataIndex: 'runCount', width: 80 },
            {
              title: '最近运行',
              dataIndex: 'latestRunStatus',
              width: 100,
              render: (s) => <StatusTag status={s} domain="run" />,
            },
            { title: '负责人', dataIndex: 'owner', width: 80 },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 160,
              render: (v) => formatDateTime(v, { zone: false }),
            },
          ]}
        />
      </div>
    </div>
  )
}

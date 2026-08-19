/** 审计日志：追加式事件只读查询 */

import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Descriptions, Input, Result, Space, Table } from 'antd'
import { useSearchParams } from 'react-router'
import dayjs from '@/shared/dayjs'
import { listAuditLogs } from '@/api/audit'
import { useAuth } from '@/app/AuthContext'
import { CopyableId, PageHeader } from '@/components'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

function downloadCsv(rows: Array<Record<string, string>>) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
  const header = ['时间', '主体', '动作', '对象', '关联编号', '摘要']
  const body = rows.map((row) => [row.timestamp, row.actor, row.action, row.target, row.relatedId, row.summary])
  const csv = [header, ...body].map((line) => line.map(escape).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'audit-log.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AuditLogPage() {
  const { hasScope } = useAuth()
  const canRead = hasScope('audit:read')
  const [params, setParams] = useSearchParams()
  const actor = params.get('actor') ?? ''
  const action = params.get('action') ?? ''
  const target = params.get('target') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['auditLogs', { actor, action, target, from, to }],
    queryFn: () =>
      listAuditLogs({
        actorKey: actor || undefined,
        action: action || undefined,
        target: target || undefined,
        since: from ? dayjs(from).startOf('day').toISOString() : undefined,
        until: to ? dayjs(to).endOf('day').toISOString() : undefined,
      }),
    enabled: canRead,
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  if (!canRead) {
    return <Result status="403" title="权限不足" subTitle="审计日志仅对具备 audit:read 权限的角色开放。" />
  }
  if (isLoading) return <PageLoading rows={8} />
  if (error) return <PageError error={error} retry={() => void refetch()} />

  const fromDate = from ? dayjs(from).startOf('day') : null
  const toDate = to ? dayjs(to).endOf('day') : null
  const filtered = (data ?? []).filter((entry) => {
    const timestamp = dayjs(entry.timestamp)
    if (fromDate && timestamp.isBefore(fromDate)) return false
    if (toDate && timestamp.isAfter(toDate)) return false
    if (actor && !entry.actor.includes(actor)) return false
    if (action && !entry.action.includes(action)) return false
    if (target && !`${entry.target} ${entry.relatedId}`.includes(target)) return false
    return true
  })

  const clearFilters = () => setParams(new URLSearchParams())
  const rangeValue = from && to ? [dayjs(from), dayjs(to)] as [dayjs.Dayjs, dayjs.Dayjs] : undefined

  return (
    <div>
      <PageHeader
        title="审计日志"
        subtitle="追加式事件只读查询；每条记录保留主体、原因、关联编号与变更摘要"
        extra={<Button onClick={() => downloadCsv(filtered.map((entry) => ({ ...entry })))}>导出当前结果</Button>}
      />

      <Space wrap style={{ margin: '16px 0' }}>
        <DatePicker.RangePicker
          value={rangeValue}
          onChange={(range) => {
            const next = new URLSearchParams(params)
            const nextFrom = range?.[0]?.format('YYYY-MM-DD')
            const nextTo = range?.[1]?.format('YYYY-MM-DD')
            if (nextFrom) next.set('from', nextFrom)
            else next.delete('from')
            if (nextTo) next.set('to', nextTo)
            else next.delete('to')
            setParams(next)
          }}
        />
        <Input value={actor} placeholder="主体" style={{ width: 140 }} onChange={(e) => updateParam('actor', e.target.value || undefined)} />
        <Input value={action} placeholder="动作类型" style={{ width: 160 }} onChange={(e) => updateParam('action', e.target.value || undefined)} />
        <Input value={target} placeholder="对象或关联编号" style={{ width: 190 }} onChange={(e) => updateParam('target', e.target.value || undefined)} />
        <Button onClick={clearFilters}>清除筛选</Button>
      </Space>

      {filtered.length === 0 ? (
        <PageEmpty title={data?.length ? '暂无匹配审计记录' : '暂无审计记录'} description="调整筛选条件后重试" />
      ) : (
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={filtered}
            expandable={{
              expandedRowRender: (entry) => (
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="审计编号"><CopyableId id={entry.id} maxLength={0} /></Descriptions.Item>
                  <Descriptions.Item label="关联编号"><CopyableId id={entry.relatedId} maxLength={0} /></Descriptions.Item>
                  <Descriptions.Item label="摘要" span={2}>{entry.summary}</Descriptions.Item>
                </Descriptions>
              ),
            }}
            columns={[
              { title: '时间', dataIndex: 'timestamp', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
              { title: '主体', dataIndex: 'actor', width: 100 },
              { title: '动作', dataIndex: 'action', width: 130 },
              { title: '对象', dataIndex: 'target', ellipsis: true },
              { title: '关联编号', dataIndex: 'relatedId', width: 150, render: (value) => <CopyableId id={value} maxLength={18} /> },
              { title: '摘要', dataIndex: 'summary', ellipsis: true },
            ]}
          />
        </div>
      )}
    </div>
  )
}

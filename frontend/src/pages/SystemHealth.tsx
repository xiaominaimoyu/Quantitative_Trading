/** 系统健康：服务、Worker、队列、存储与备份 */

import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Progress, Result, Row, Space, Statistic, Table, Tag } from 'antd'
import { Link } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import { getSystemHealth } from '@/api/system'
import { isTerminalTaskStatus, listTasks, TASK_TYPE_LABEL } from '@/api/mock/tasks'
import { PageHeader, StatusTag } from '@/components'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatDateTime, formatDurationSec } from '@/shared/format'

const SERVICE_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: '正常', color: 'success' },
  degraded: { label: '降级', color: 'warning' },
  down: { label: '不可用', color: 'error' },
}

const WORKER_STATUS: Record<string, { label: string; color: string }> = {
  idle: { label: '空闲', color: 'success' },
  busy: { label: '忙碌', color: 'processing' },
  offline: { label: '离线', color: 'error' },
}

export default function SystemHealthPage() {
  const { hasScope } = useAuth()
  const canView = hasScope('system:admin')
  const healthQ = useQuery({ queryKey: ['systemHealth'], queryFn: () => getSystemHealth(), enabled: canView })
  const tasksQ = useQuery({ queryKey: ['systemHealthTasks'], queryFn: () => listTasks(), enabled: canView })

  if (!canView) {
    return <Result status="403" title="权限不足" subTitle="系统健康、备份与恢复信息仅对具备 system:admin 权限的角色开放。" />
  }

  if (healthQ.isLoading || tasksQ.isLoading) return <PageLoading rows={10} />
  if (healthQ.error || tasksQ.error) {
    return (
      <PageError
        error={healthQ.error ?? tasksQ.error}
        retry={() => {
          void healthQ.refetch()
          void tasksQ.refetch()
        }}
      />
    )
  }

  const health = healthQ.data
  if (!health) return <PageEmpty title="暂无系统健康数据" />

  const activeTasks = (tasksQ.data ?? []).filter((task) => !isTerminalTaskStatus(task.status))
  const unhealthy = health.services.filter((service) => service.status !== 'ok')
  const totalStorage = health.storage.dataGb + health.storage.artifactsGb + health.storage.dbGb
  const storagePct = (gb: number) => (totalStorage > 0 ? Math.round((gb / totalStorage) * 100) : 0)

  return (
    <div>
      <PageHeader
        title="系统健康"
        subtitle="服务存活、Worker 心跳、任务积压、存储和备份状态"
        extra={<Button onClick={() => { void healthQ.refetch(); void tasksQ.refetch() }}>刷新</Button>}
      />

      {unhealthy.length > 0 ? (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={`发现 ${unhealthy.length} 项服务需要关注`}
          description={unhealthy.map((service) => `${service.name}：${service.detail ?? SERVICE_STATUS[service.status]?.label}`).join('；')}
        />
      ) : (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message="所有核心服务最近一次检查均正常" />
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small"><Statistic title="服务状态" value={`${health.services.filter((s) => s.status === 'ok').length}/${health.services.length}`} suffix="正常" /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small"><Statistic title="在线 Worker" value={health.workers.filter((w) => w.status !== 'offline').length} suffix={`/ ${health.workers.length}`} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small"><Statistic title="队列深度" value={health.queueDepth} suffix="项" /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small"><Statistic title="存储用量" value={totalStorage} suffix="GB" /></Card>
        </Col>
      </Row>

      <Card size="small" title="服务状态" style={{ marginTop: 16 }}>
        <Row gutter={[12, 12]}>
          {health.services.map((service) => {
            const meta = SERVICE_STATUS[service.status] ?? { label: service.status, color: 'default' }
            return (
              <Col xs={24} sm={12} lg={6} key={service.name}>
                <Card size="small" type="inner" title={service.name}>
                  <Space direction="vertical" size={4}>
                    <Tag color={meta.color}>{meta.label}</Tag>
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                      最近成功：{formatDateTime(service.lastOk, { zone: false })}
                    </span>
                    {service.detail ? <span>{service.detail}</span> : null}
                  </Space>
                </Card>
              </Col>
            )
          })}
        </Row>
      </Card>

      <Card size="small" title="Worker 心跳与租约" style={{ marginTop: 16 }}>
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={health.workers}
            pagination={false}
            columns={[
              { title: 'Worker', dataIndex: 'id' },
              { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={WORKER_STATUS[value]?.color}>{WORKER_STATUS[value]?.label ?? value}</Tag> },
              { title: '当前任务', dataIndex: 'currentTask', width: 120, render: (value) => value ? <Link to={`/experiments/exp-momentum-0042/runs/${value}`}>{value}</Link> : '—' },
              { title: '最近心跳', dataIndex: 'lastHeartbeat', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
            ]}
          />
        </div>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="存储用量">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>数据卷 <Progress percent={storagePct(health.storage.dataGb)} format={() => `${health.storage.dataGb} GB`} /></div>
              <div>产物目录 <Progress percent={storagePct(health.storage.artifactsGb)} format={() => `${health.storage.artifactsGb} GB`} /></div>
              <div>数据库 <Progress percent={storagePct(health.storage.dbGb)} format={() => `${health.storage.dbGb} GB`} /></div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="备份与恢复">
            <Space direction="vertical" size={8}>
              <span>最近备份：{health.lastBackup ? formatDateTime(health.lastBackup, { zone: false }) : '—'}</span>
              <span>最近恢复演练：{health.lastRestoreDrill ? formatDateTime(health.lastRestoreDrill, { zone: false }) : '—'}</span>
              <StatusTag status="success" label="备份记录可用" />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`活动任务（${activeTasks.length}）`} style={{ marginTop: 16 }}>
        {activeTasks.length === 0 ? (
          <PageEmpty title="暂无活动任务" />
        ) : (
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey="id"
              dataSource={activeTasks}
              pagination={false}
              columns={[
                { title: '任务', dataIndex: 'name' },
                { title: '类型', dataIndex: 'type', width: 100, render: (value) => TASK_TYPE_LABEL[value as keyof typeof TASK_TYPE_LABEL] ?? value },
                { title: '状态', dataIndex: 'status', width: 110, render: (value) => <StatusTag status={value} domain="task" /> },
                { title: '进度', dataIndex: 'progress', width: 140, render: (value) => <Progress percent={value} size="small" /> },
                { title: '已运行', dataIndex: 'durationSec', width: 120, render: (value) => formatDurationSec(value) },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

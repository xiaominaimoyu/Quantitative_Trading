/** 工作台：今日研究概览 */

import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, List, Progress, Row, Space, Tag } from 'antd'
import { Link, useNavigate } from 'react-router'
import {
  listDashboardTasks,
  listRecentRuns,
  listTodos,
  getSystemSummary,
} from '@/api/mock/dashboard'
import { isActiveTaskStatus, TASK_TYPE_LABEL } from '@/api/mock/tasks'
import { PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDurationSec } from '@/shared/format'

export default function DashboardPage() {
  const navigate = useNavigate()
  const todosQ = useQuery({ queryKey: ['dashboard', 'todos'], queryFn: () => listTodos() })
  const tasksQ = useQuery({ queryKey: ['dashboard', 'tasks'], queryFn: () => listDashboardTasks(), refetchInterval: 5000 })
  const runsQ = useQuery({ queryKey: ['dashboard', 'recentRuns'], queryFn: () => listRecentRuns() })
  const systemQ = useQuery({ queryKey: ['dashboard', 'system'], queryFn: () => getSystemSummary() })

  const loading = todosQ.isLoading || tasksQ.isLoading || runsQ.isLoading || systemQ.isLoading
  const error = todosQ.error ?? tasksQ.error ?? runsQ.error ?? systemQ.error

  if (loading) return <PageLoading rows={8} />
  if (error) {
    return (
      <PageError
        error={error}
        retry={() => {
          void todosQ.refetch()
          void tasksQ.refetch()
          void runsQ.refetch()
          void systemQ.refetch()
        }}
      />
    )
  }

  const activeTasks = (tasksQ.data ?? []).filter((t) => isActiveTaskStatus(t.status))
  const todos = todosQ.data ?? []
  const recentRuns = runsQ.data ?? []
  const system = systemQ.data

  return (
    <div>
      <PageHeader
        title="工作台"
        subtitle="今日研究概览：运行中实验、最新报告与风险提示"
      />

      {todos.length > 0 ? (
        <Card size="small" title={`需要处理（${todos.length}）`} style={{ marginTop: 16 }}>
          <List
            dataSource={todos}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="go" type="link" size="small" onClick={() => navigate(item.actionPath)}>
                    {item.actionLabel}
                  </Button>,
                ]}
              >
                <Space>
                  {item.severity === 'warning' ? (
                    <Tag color="warning">待处理</Tag>
                  ) : item.severity === 'success' ? (
                    <Tag color="success">完成</Tag>
                  ) : (
                    <Tag>通知</Tag>
                  )}
                  <span>{item.text}</span>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      ) : null}

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="进行中的任务">
            {activeTasks.length === 0 ? (
              <div style={{ color: 'rgba(0,0,0,0.45)', padding: '16px 0' }}>暂无运行中任务</div>
            ) : (
              <List
                dataSource={activeTasks.slice(0, 5)}
                renderItem={(task) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/experiments/exp-momentum-0042/runs/${task.runId}`)}
                  >
                    <div style={{ width: '100%' }}>
                      <Space>
                        <StatusTag status={task.status} domain="task" />
                        <span>{task.name}</span>
                        <span style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>
                          {TASK_TYPE_LABEL[task.type]}
                        </span>
                      </Space>
                      <Progress percent={task.progress} size="small" style={{ marginTop: 4 }} aria-label={`${task.name} 进度`} />
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                        {formatDurationSec(task.durationSec)}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="最近运行">
            <List
              dataSource={recentRuns}
              renderItem={(run) => (
                <List.Item
                  actions={[
                    <Link key="view" to={`/experiments/${run.experimentId}/runs/${run.id}`}>
                      查看
                    </Link>,
                  ]}
                >
                  <Space>
                    <StatusTag status={run.status} domain="run" />
                    <span>
                      {run.id} · {run.label}
                    </span>
                    <span style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>{run.timeAgo}</span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="快捷操作" style={{ marginTop: 16 }}>
        <Space wrap>
          <Button type="primary" onClick={() => navigate('/datasets')}>
            浏览数据目录
          </Button>
          <Button onClick={() => navigate('/experiments/new')}>新建实验</Button>
          <Button onClick={() => navigate('/reports')}>浏览报告</Button>
        </Space>
      </Card>

      {system ? (
        <Alert
          style={{ marginTop: 16 }}
          type={system.workerStatus === 'ok' ? 'success' : 'warning'}
          showIcon
          message={`系统状态：Worker ${system.workerStatus === 'ok' ? '正常' : '异常'} · 存储 ${system.storagePct}% · 最近备份 ${system.lastBackup}`}
        />
      ) : null}
    </div>
  )
}

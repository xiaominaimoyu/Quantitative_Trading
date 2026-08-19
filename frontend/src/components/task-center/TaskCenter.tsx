/**
 * TaskCenter —— 头像旁的任务中心入口（铃铛 + 运行中任务数 Badge）。
 *
 * 轮询策略：
 * - 挂载后每 3s 拉取一次任务列表（轻量），页面失焦自动暂停，重新聚焦立即刷新；
 * - 面板打开时暂停后台轮询（后台轮询与前台订阅互斥），打开瞬间重新拉取最新；
 * - 列表数据与 Badge 数字来自同一份状态，切换 tab 不触发重取 → 徽标数字稳定。
 *
 * 仅当任务携带可解析的显式详情目标时允许点击跳转。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { App, Badge, Empty, Popover, Progress, Tabs, Tooltip } from 'antd'
import { BellOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import {
  listTasks,
  TASK_TYPE_LABEL,
  isActiveTaskStatus,
  isTerminalTaskStatus,
  type Task,
} from '@/api/mock/tasks'
import { resolveTaskTarget } from './taskTarget'
import { formatDateTime } from '@/shared/format'
import StatusTag from '@/components/StatusTag'

const POLL_INTERVAL_MS = 3000

function TaskRow({
  task,
  onNavigate,
}: {
  task: Task
  onNavigate: (target: string) => void
}) {
  const target = resolveTaskTarget(task)
  const navigable = target !== null

  const row = (
    <div
      role={navigable ? 'button' : undefined}
      tabIndex={navigable ? 0 : undefined}
      aria-disabled={!navigable}
      className="qt-task-row"
      onClick={navigable ? () => onNavigate(target) : undefined}
      onKeyDown={navigable ? (e) => {
        // WCAG 2.1.1：button-like widget 需同时支持 Enter 与 Space
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate(target)
        }
      } : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 4px',
        cursor: navigable ? 'pointer' : 'default',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <StatusTag status={task.status} domain="task" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="qt-ellipsis"
          style={{ fontSize: 13, color: 'rgba(0,0,0,0.85)' }}
        >
          {task.name}
          <span style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, marginLeft: 6 }}>
            {TASK_TYPE_LABEL[task.type]}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
          {formatDateTime(task.startedAt, { zone: false })}
          {isActiveTaskStatus(task.status) ? (
            <span className="qt-mono" style={{ marginLeft: 8 }}>
              {Math.floor(task.durationSec / 60)}m
            </span>
          ) : null}
        </div>
        {isActiveTaskStatus(task.status) ? (
          <Progress
            percent={task.progress}
            size="small"
            showInfo={false}
            strokeColor="#1677FF"
            style={{ margin: '2px 0 0' }}
            aria-label="任务进度"
          />
        ) : null}
      </div>
      {navigable ? (
        <RightOutlined style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)' }} aria-hidden />
      ) : (
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>暂无详情</span>
      )}
    </div>
  )

  return navigable ? row : <Tooltip title="该任务暂无可定位的详情目标">{row}</Tooltip>
}

export default function TaskCenter() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState<Task[]>([])
  const [done, setDone] = useState<Task[]>([])
  const mountedRef = useRef(false)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const all = await listTasks()
      setRunning(all.filter((t) => !isTerminalTaskStatus(t.status)))
      setDone(all.filter((t) => isTerminalTaskStatus(t.status)))
    } catch {
      if (!silent) {
        message.error('任务列表加载失败，请稍后重试')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [message])

  // 首次挂载立即拉取
  useEffect(() => {
    void refresh(true)
    mountedRef.current = true
  }, [refresh])

  // 面板打开 ↔ 后台轮询 互斥
  useEffect(() => {
    if (open) {
      void refresh()
      return
    }
    const timer = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [open, refresh])

  const goTask = useCallback(
    (target: string) => {
      setOpen(false)
      navigate(target)
    },
    [navigate],
  )

  const runningCount = running.length
  const doneCount = done.length

  const panel = (
    <div style={{ width: 400, maxHeight: 480, overflow: 'hidden' }}>
      <Tabs
        size="small"
        defaultActiveKey="running"
        items={[
          {
            key: 'running',
            label: `运行中${runningCount > 0 ? ` (${runningCount})` : ''}`,
            children: (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {loading && runningCount === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}>
                    加载中…
                  </div>
                ) : running.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行中任务" />
                ) : (
                  running.map((t) => (
                    <TaskRow key={t.id} task={t} onNavigate={goTask} />
                  ))
                )}
              </div>
            ),
          },
          {
            key: 'done',
            label: `已完成${doneCount > 0 ? ` (${doneCount})` : ''}`,
            children: (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {done.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成任务" />
                ) : (
                  done.map((t) => (
                    <TaskRow key={t.id} task={t} onNavigate={goTask} />
                  ))
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  )

  return (
    <Popover
      content={panel}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
    >
      <Badge count={runningCount} size="small" offset={[-2, 2]}>
        <span
          className="qt-task-bell"
          aria-label="任务中心"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
            color: 'rgba(0,0,0,0.65)',
          }}
        >
          <BellOutlined />
        </span>
      </Badge>
    </Popover>
  )
}

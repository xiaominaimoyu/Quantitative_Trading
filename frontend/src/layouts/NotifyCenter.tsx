/**
 * NotifyCenter — 通知中心 + 任务中心分离
 *
 * 铃铛 + Badge 未读数（>99 显示 99+）
 * Popover 弹层按「今天/更早」分组
 * 底栏「全部已读」+「前往任务中心」
 */

import { useMemo, useState } from 'react'
import { Badge, Button, Popover, Tabs, Tag, Tooltip, Progress, Popconfirm } from 'antd'
import {
  BellOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from '@/shared/dayjs'

export interface NotifyItem {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  ts: string
  read: boolean
  link?: string
}

export interface TaskItem {
  id: string
  name: string
  type: string
  status: 'running' | 'done' | 'failed'
  progress?: number
  elapsedMs?: number
  etaMs?: number
}

interface NotifyCenterProps {
  notifications: NotifyItem[]
  tasks: TaskItem[]
  onMarkAllRead: () => void
  onGotoTasks: () => void
  onCancelTask?: (id: string) => void
}

const LEVEL_ICON = {
  info: <InfoCircleOutlined style={{ color: 'var(--color-processing)' }} />,
  success: <CheckOutlined style={{ color: 'var(--color-success)' }} />,
  warning: <WarningOutlined style={{ color: 'var(--color-warning)' }} />,
  error: <ExclamationCircleOutlined style={{ color: 'var(--color-error)' }} />,
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

export function NotifyCenter({
  notifications,
  tasks,
  onMarkAllRead,
  onGotoTasks,
  onCancelTask,
}: NotifyCenterProps) {
  const [activeTab, setActiveTab] = useState('notifications')

  const unreadCount = notifications.filter((n) => !n.read).length
  const runningTasks = tasks.filter((t) => t.status === 'running')
  const doneTasks = tasks.filter((t) => t.status === 'done')
  const failedTasks = tasks.filter((t) => t.status === 'failed')

  const { today, earlier } = useMemo(() => {
    const now = dayjs()
    const today: NotifyItem[] = []
    const earlier: NotifyItem[] = []
    for (const n of notifications) {
      if (dayjs(n.ts).isSame(now, 'day')) today.push(n)
      else earlier.push(n)
    }
    return { today, earlier }
  }, [notifications])

  const renderNotifyList = (items: NotifyItem[]) => (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      {items.map((n) => (
        <div
          key={n.id}
          style={{
            padding: '8px 12px',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid var(--border-base)',
            cursor: n.link ? 'pointer' : 'default',
            opacity: n.read ? 0.6 : 1,
          }}
        >
          {LEVEL_ICON[n.level]}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{n.title}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              {dayjs(n.ts).fromNow()}
            </div>
          </div>
          {!n.read && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                flexShrink: 0,
                marginTop: 6,
              }}
            />
          )}
        </div>
      ))}
    </div>
  )

  const renderTaskItem = (t: TaskItem) => (
    <div
      key={t.id}
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-base)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{t.name}</span>
        {t.status === 'running' && onCancelTask && (
          <Popconfirm title="确认取消？" onConfirm={() => onCancelTask(t.id)}>
            <Button type="link" size="small" danger>
              取消
            </Button>
          </Popconfirm>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Tag style={{ fontSize: 11 }}>{t.type}</Tag>
        {t.status === 'running' && (
          <>
            <span
              className="qt-tabular"
              style={{ fontSize: 12, color: 'var(--text-tertiary)' }}
            >
              {t.progress != null ? `${t.progress}%` : ''}
            </span>
            {t.elapsedMs != null && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                <ClockCircleOutlined /> {formatDuration(t.elapsedMs)}
              </span>
            )}
            {t.etaMs != null && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                ETA {formatDuration(t.etaMs)}
              </span>
            )}
          </>
        )}
      </div>
      {t.status === 'running' && t.progress != null && (
        <Progress
          percent={t.progress}
          size="small"
          strokeColor="var(--color-processing)"
          style={{ marginTop: 4 }}
        />
      )}
    </div>
  )

  const content = (
    <div style={{ width: 360 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        items={[
          {
            key: 'notifications',
            label: `通知${unreadCount > 0 ? ` (${unreadCount})` : ''}`,
            children: (
              <>
                {today.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '4px 12px',
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      今天
                    </div>
                    {renderNotifyList(today)}
                  </>
                )}
                {earlier.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '4px 12px',
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      更早
                    </div>
                    {renderNotifyList(earlier)}
                  </>
                )}
                <div
                  style={{
                    padding: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderTop: '1px solid var(--border-base)',
                  }}
                >
                  <Button type="link" size="small" onClick={onMarkAllRead}>
                    全部已读
                  </Button>
                  <Button type="link" size="small" onClick={onGotoTasks}>
                    前往任务中心
                  </Button>
                </div>
              </>
            ),
          },
          {
            key: 'tasks',
            label: `进行中 (${runningTasks.length})`,
            children: <div>{runningTasks.map(renderTaskItem)}</div>,
          },
          {
            key: 'done',
            label: `已完成 (${doneTasks.length})`,
            children: <div>{doneTasks.map(renderTaskItem)}</div>,
          },
          {
            key: 'failed',
            label: `失败 (${failedTasks.length})`,
            children: <div>{failedTasks.map(renderTaskItem)}</div>,
          },
        ]}
      />
    </div>
  )

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Tooltip title="通知与任务">
        <Badge
          count={unreadCount}
          overflowCount={99}
          offset={[-2, 2]}
        >
          <Button
            type="text"
            icon={<BellOutlined />}
            aria-label="通知中心"
          />
        </Badge>
      </Tooltip>
    </Popover>
  )
}
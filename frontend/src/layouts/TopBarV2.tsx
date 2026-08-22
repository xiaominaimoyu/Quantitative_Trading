/**
 * TopBarV2 — 顶栏 v2
 *
 * 吸顶 56px；左区环境标识 + 搜索框；右区市场时钟 + 通知中心 + 用户菜单
 * 用户菜单整合三维度主题切换一级分组
 */

import { useEffect, useState } from 'react'
import { Avatar, Button, Dropdown, Layout, Segmented, Tag, Tooltip } from 'antd'
import {
  CheckOutlined,
  MenuOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useNavigate } from 'react-router'
import dayjs from '@/shared/dayjs'
import { useTheme } from '@/theme'
import { useAuth, ROLE_LABEL, type UserRole } from '@/app/AuthContext'
import { API_MODE } from '@/api/config'
import { layoutTokens } from '@/theme/tokens/v2'
import { NotifyCenter, type NotifyItem, type TaskItem } from './NotifyCenter'

const { Header } = Layout

interface TopBarV2Props {
  onToggleSider: () => void
  onOpenCommandPalette: () => void
  notifications: NotifyItem[]
  tasks: TaskItem[]
  onMarkAllRead: () => void
  onCancelTask?: (id: string) => void
}

export function TopBarV2({
  onToggleSider,
  onOpenCommandPalette,
  notifications,
  tasks,
  onMarkAllRead,
  onCancelTask,
}: TopBarV2Props) {
  const navigate = useNavigate()
  const { ui, market, density, setUi, setMarket, setDensity } = useTheme()
  const auth = useAuth()

  const [now, setNow] = useState(() => dayjs())
  useEffect(() => {
    const t = window.setInterval(() => setNow(dayjs()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const userMenu: MenuProps['items'] = [
    {
      key: 'role-group',
      label: '角色切换',
      type: 'group',
      children: [
        {
          key: 'role:researcher',
          label: (
            <span>
              {auth.role === 'researcher' && <CheckOutlined style={{ marginRight: 6 }} />}
              研究员
            </span>
          ),
        },
        {
          key: 'role:auditor',
          label: (
            <span>
              {auth.role === 'auditor' && <CheckOutlined style={{ marginRight: 6 }} />}
              审计员
            </span>
          ),
        },
        {
          key: 'role:admin',
          label: (
            <span>
              {auth.role === 'admin' && <CheckOutlined style={{ marginRight: 6 }} />}
              管理员
            </span>
          ),
        },
      ],
    },
    { type: 'divider' },
    {
      key: 'ui-group',
      label: '界面主题',
      type: 'group',
      children: [
        {
          key: 'ui:dark',
          label: (
            <span>
              {ui === 'dark' && <CheckOutlined style={{ marginRight: 6 }} />}
              <MoonOutlined style={{ marginRight: 4 }} /> 暗色
            </span>
          ),
        },
        {
          key: 'ui:light',
          label: (
            <span>
              {ui === 'light' && <CheckOutlined style={{ marginRight: 6 }} />}
              <SunOutlined style={{ marginRight: 4 }} /> 浅色
            </span>
          ),
        },
      ],
    },
    {
      key: 'market-group',
      label: '行情色板',
      type: 'group',
      children: [
        {
          key: 'market:normal',
          label: (
            <span>
              {market === 'normal' && <CheckOutlined style={{ marginRight: 6 }} />}
              正常（红涨绿跌）
            </span>
          ),
        },
        {
          key: 'market:colorblind',
          label: (
            <span>
              {market === 'colorblind' && <CheckOutlined style={{ marginRight: 6 }} />}
              色觉辅助（蓝涨橙跌）
            </span>
          ),
        },
      ],
    },
    {
      key: 'density-group',
      label: '密度',
      type: 'group',
      children: [
        {
          key: 'density:compact',
          label: (
            <span>
              {density === 'compact' && <CheckOutlined style={{ marginRight: 6 }} />}
              紧凑
            </span>
          ),
        },
        {
          key: 'density:comfortable',
          label: (
            <span>
              {density === 'comfortable' && <CheckOutlined style={{ marginRight: 6 }} />}
              标准
            </span>
          ),
        },
      ],
    },
    { type: 'divider' },
    { key: 'signout', label: '退出登录', danger: true },
  ]

  const onUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('role:')) {
      auth.switchRole(key.slice(5) as UserRole)
    } else if (key.startsWith('ui:')) {
      setUi(key.slice(3) as 'dark' | 'light')
    } else if (key.startsWith('market:')) {
      setMarket(key.slice(7) as 'normal' | 'colorblind')
    } else if (key.startsWith('density:')) {
      setDensity(key.slice(8) as 'compact' | 'comfortable')
    }
  }

  const clockText = now.tz('Asia/Shanghai')

  return (
    <Header
      style={{
        height: layoutTokens.headerHeight,
        lineHeight: 'normal',
        background: 'var(--bg-container)',
        borderBottom: '1px solid var(--border-base)',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 200,
      }}
    >
      <Button
        type="text"
        icon={<MenuOutlined />}
        onClick={onToggleSider}
        aria-label="切换侧栏"
      />

      <Tag
        style={{
          color: API_MODE === 'real' ? 'var(--color-success)' : 'var(--color-warning)',
          backgroundColor: 'var(--bg-hover)',
          borderColor: 'transparent',
          margin: 0,
          flexShrink: 0,
        }}
      >
        {API_MODE === 'real' ? '真实 API' : 'Mock API'} · 无真实交易
      </Tag>

      <Button
        type="text"
        onClick={onOpenCommandPalette}
        icon={<SearchOutlined />}
        style={{
          flex: 1,
          maxWidth: 420,
          justifyContent: 'flex-start',
          color: 'var(--text-tertiary)',
          background: 'var(--bg-hover)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span style={{ fontSize: 13 }}>搜索或跳转 ⌘K</span>
      </Button>

      <div style={{ flex: 1 }} />

      <Tooltip title="平台统一时区（Asia/Shanghai）">
        <span
          className="qt-mono qt-tabular"
          style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
        >
          {clockText.format('YYYY-MM-DD HH:mm:ss')}
        </span>
      </Tooltip>

      <NotifyCenter
        notifications={notifications}
        tasks={tasks}
        onMarkAllRead={onMarkAllRead}
        onGotoTasks={() => navigate('/')}
        onCancelTask={onCancelTask}
      />

      <Dropdown
        menu={{ items: userMenu, onClick: onUserMenuClick }}
        trigger={['click']}
        placement="bottomRight"
      >
        <Button type="text" style={{ height: 40, padding: '0 8px' }}>
          <Avatar
            size={24}
            icon={<UserOutlined />}
            style={{ backgroundColor: 'var(--color-primary)' }}
          />
          <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-primary)' }}>
            {auth.user.name} · {ROLE_LABEL[auth.role]}
          </span>
        </Button>
      </Dropdown>
    </Header>
  )
}
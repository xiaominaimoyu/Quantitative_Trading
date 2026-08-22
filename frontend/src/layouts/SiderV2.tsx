/**
 * SiderV2 — 侧栏 v2：四组分组 + 三形态 + 杂注徽标化
 *
 * 分组：工作区 / 研究 / 风控与治理 / 工具
 * 形态：expanded 232px / collapsed 64px / hidden（抽屉由 AppShellV2 控制）
 */

import { useMemo } from 'react'
import { Layout, Menu, Tooltip, Button } from 'antd'
import {
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HeartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TransactionOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useNavigate, useLocation } from 'react-router'
import { useSiderState } from '@/shared/useSiderState'
import { layoutTokens } from '@/theme/tokens/v2'
import { NavBadge } from './NavBadge'

const { Sider } = Layout

interface NavItem {
  key: string
  icon: React.ReactNode
  label: React.ReactNode
  badge?: { text: string; color?: 'primary' | 'warning' | 'success' }
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '工作区',
    items: [{ key: '/', icon: <DashboardOutlined />, label: '工作台' }],
  },
  {
    title: '研究',
    items: [
      { key: '/datasets', icon: <DatabaseOutlined />, label: '数据目录' },
      { key: '/strategies', icon: <ExperimentOutlined />, label: '策略实验室' },
      { key: '/experiments', icon: <ProfileOutlined />, label: '实验' },
      { key: '/reports', icon: <FileTextOutlined />, label: '报告' },
    ],
  },
  {
    title: '风控与治理',
    items: [
      { key: '/risk', icon: <SafetyCertificateOutlined />, label: '风险管理' },
      { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
      { key: '/system', icon: <HeartOutlined />, label: '系统健康' },
    ],
  },
  {
    title: '工具',
    items: [
      {
        key: '/ai',
        icon: <RobotOutlined />,
        label: 'AI 研究助手',
        badge: { text: 'Beta', color: 'primary' },
      },
      {
        key: '/paper-trading',
        icon: <TransactionOutlined />,
        label: '模拟盘',
        badge: { text: '沙盒', color: 'warning' },
      },
    ],
  },
]

function getSelectedKey(pathname: string): string {
  if (pathname === '/') return '/'
  const candidates = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key)).filter(
    (k) => k !== '/',
  )
  return (
    candidates
      .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
      .sort((a, b) => b.length - a.length)[0] ?? '/'
  )
}

interface SiderV2Props {
  collapsed: boolean
  onToggle: () => void
}

export function SiderV2({ collapsed, onToggle }: SiderV2Props) {
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = useMemo<MenuProps['items']>(() => {
    return NAV_GROUPS.map((group) => ({
      type: 'group' as const,
      label: collapsed ? null : (
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {group.title}
        </span>
      ),
      children: group.items.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: collapsed ? (
          <Tooltip title={typeof item.label === 'string' ? item.label : undefined} placement="right">
            <span />
          </Tooltip>
        ) : (
          <span>
            {item.label}
            {item.badge && <NavBadge text={item.badge.text} color={item.badge.color} />}
          </span>
        ),
      })),
    }))
  }, [collapsed])

  const selectedKey = getSelectedKey(location.pathname)
  const width = collapsed ? layoutTokens.siderCollapsedWidth : layoutTokens.siderWidth

  return (
    <Sider
      width={width}
      collapsed={collapsed}
      collapsedWidth={width}
      trigger={null}
      style={{
        background: 'var(--bg-container)',
        borderRight: '1px solid var(--border-base)',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'auto',
        transition: `width var(--motion-fast) var(--ease-out)`,
      }}
    >
      <div
        style={{
          height: layoutTokens.headerHeight,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: collapsed ? '0 8px' : '0 16px',
          fontWeight: 600,
          fontSize: 15,
          color: 'var(--text-primary)',
          borderBottom: '1px solid var(--border-base)',
          whiteSpace: 'nowrap',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--color-primary)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ExperimentOutlined />
        </span>
        {!collapsed && <span>量化研究终端</span>}
      </div>

      <Menu
        mode="inline"
        inlineCollapsed={collapsed}
        items={menuItems}
        selectedKeys={[selectedKey]}
        onClick={({ key }) => navigate(key)}
        style={{
          borderInlineEnd: 'none',
          paddingTop: 8,
          background: 'transparent',
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTop: '1px solid var(--border-base)',
        }}
      >
        <Button
          type="text"
          onClick={onToggle}
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
        />
      </div>
    </Sider>
  )
}
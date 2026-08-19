/**
 * AppLayout —— 研究控制台整体布局。
 *
 * 结构：左侧导航（固定） | 顶部栏（面包屑 / 环境标识 / 市场时钟 / 任务中心 / 用户菜单）+ 内容区。
 * 顶部栏吸顶，内容区 1440 上限居中。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Breadcrumb,
  Button,
  Dropdown,
  Layout,
  Menu,
  Tag,
  Tooltip,
  App,
} from 'antd'
import {
  AuditOutlined,
  CheckOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HeartOutlined,
  LineChartOutlined,
  ProfileOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TransactionOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Link, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import dayjs from '@/shared/dayjs'
import { semanticColors, layoutTokens } from '@/theme'
import { useTheme } from '@/theme'
import { useAuth, ROLE_LABEL, type UserRole } from '@/app/AuthContext'
import { TaskCenter } from '@/components/task-center'
import type { Crumb } from '@/router'
import { API_MODE } from '@/api/config'

const { Sider, Header, Content } = Layout

const NAV_ITEMS: MenuProps['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/datasets', icon: <DatabaseOutlined />, label: '数据目录' },
  { key: '/strategies', icon: <ExperimentOutlined />, label: '策略实验室' },
  { key: '/experiments', icon: <ProfileOutlined />, label: '实验' },
  { key: '/reports', icon: <FileTextOutlined />, label: '报告' },
  { key: '/risk', icon: <SafetyCertificateOutlined />, label: '风险管理' },
  { type: 'divider' },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
  { key: '/system', icon: <HeartOutlined />, label: '系统健康' },
  { type: 'divider' },
  {
    key: '/ai',
    icon: <RobotOutlined />,
    label: (
      <span>
        AI 研究助手{' '}
        <span
          style={{
            fontSize: 11,
            color: semanticColors.info,
            background: 'rgba(0,0,0,0.06)',
            padding: '0 4px',
            borderRadius: 3,
          }}
        >
          受控演示
        </span>
      </span>
    ),
  },
  {
    key: '/paper-trading',
    icon: <TransactionOutlined />,
    label: (
      <span>
        模拟盘{' '}
        <span
          style={{
            fontSize: 11,
            color: semanticColors.info,
            background: 'rgba(0,0,0,0.06)',
            padding: '0 4px',
            borderRadius: 3,
          }}
        >
          监控沙盒
        </span>
      </span>
    ),
  },
]

/** 根据路径选中菜单（前缀最长匹配，根路径特判） */
function getSelectedKey(pathname: string): string {
  if (pathname === '/') return '/'
  const candidates = [
    '/datasets',
    '/strategies',
    '/experiments',
    '/reports',
    '/risk',
    '/audit',
    '/system',
    '/ai',
    '/paper-trading',
  ]
  return (
    candidates
      .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
      .sort((a, b) => b.length - a.length)[0] ?? '/'
  )
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const matches = useMatches()
  const { message } = App.useApp()
  const { mode, setMode } = useTheme()
  const auth = useAuth()

  // 市场时钟（平台时区，秒级跳动）
  const [now, setNow] = useState(() => dayjs())
  useEffect(() => {
    const t = window.setInterval(() => setNow(dayjs()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // 面包屑：首页 + 各路由 handle.crumb 贡献
  const crumbs = useMemo<Crumb[]>(() => {
    const list: Crumb[] = [{ label: '首页', path: '/' }]
    for (const m of matches) {
      const handle = m.handle as { crumb?: (params: Record<string, string>) => Crumb[] } | undefined
      if (handle?.crumb) {
        list.push(...handle.crumb(m.params as Record<string, string>))
      }
    }
    return list
  }, [matches])

  const selectedKey = getSelectedKey(location.pathname)

  const userMenu: MenuProps['items'] = [
    {
      key: 'role',
      label: `当前角色：${ROLE_LABEL[auth.role]}`,
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'role:researcher',
      label: (
        <span>
          {auth.role === 'researcher' ? <CheckOutlined style={{ marginRight: 6 }} /> : null}
          研究员
        </span>
      ),
    },
    {
      key: 'role:auditor',
      label: (
        <span>
          {auth.role === 'auditor' ? <CheckOutlined style={{ marginRight: 6 }} /> : null}
          审计员
        </span>
      ),
    },
    {
      key: 'role:admin',
      label: (
        <span>
          {auth.role === 'admin' ? <CheckOutlined style={{ marginRight: 6 }} /> : null}
          管理员
        </span>
      ),
    },
    { type: 'divider' },
    {
      key: 'theme',
      label: '色觉主题',
      disabled: true,
    },
    {
      key: 'theme:normal',
      label: (
        <span>
          {mode === 'normal' ? <CheckOutlined style={{ marginRight: 6 }} /> : null}
          正常（红涨绿跌）
        </span>
      ),
    },
    {
      key: 'theme:colorblind',
      label: (
        <span>
          {mode === 'colorblind' ? <CheckOutlined style={{ marginRight: 6 }} /> : null}
          色觉辅助（蓝涨橙跌）
        </span>
      ),
    },
    { type: 'divider' },
    { key: 'signout', label: '退出登录', danger: true },
  ]

  const onUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('role:')) {
      auth.switchRole(key.slice(5) as UserRole)
      message.success(`已切换角色：${ROLE_LABEL[key.slice(5) as UserRole]}`)
    } else if (key.startsWith('theme:')) {
      setMode(key.slice(6) as 'normal' | 'colorblind')
    } else if (key === 'signout') {
      message.info('演示环境：退出登录已禁用，可通过用户菜单切换角色')
    }
  }

  const clockText = now.tz('Asia/Shanghai')

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 跳转到主内容（WCAG 2.4.1 Bypass Blocks）：键盘用户跳过侧栏导航 */}
      <a href="#main-content" className="qt-skip-link">
        跳转到主内容
      </a>
      <Sider
        width={layoutTokens.siderWidth}
        theme="light"
        style={{
          borderRight: '1px solid rgba(0,0,0,0.06)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <div
          className="qt-brand"
          style={{
            height: layoutTokens.headerHeight,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            fontWeight: 600,
            fontSize: 15,
            color: 'rgba(0,0,0,0.88)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: semanticColors.primary,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <LineChartOutlined />
          </span>
          AI 量化研究平台
        </div>
        <Menu
          mode="inline"
          items={NAV_ITEMS}
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', paddingTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            height: layoutTokens.headerHeight,
            lineHeight: 'normal',
            background: '#fff',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Breadcrumb
              items={crumbs.map((c, i) => ({
                title:
                  i === crumbs.length - 1 || !c.path ? (
                    <span style={{ color: 'rgba(0,0,0,0.88)' }}>{c.label}</span>
                  ) : (
                    <Link to={c.path}>{c.label}</Link>
                  ),
              }))}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <Tag
              style={{
                color: semanticColors.success,
                backgroundColor: 'rgba(56,158,13,0.1)',
                borderColor: 'transparent',
                margin: 0,
              }}
            >
              {API_MODE === 'real' ? '真实 API' : 'Mock API'} · 无真实交易
            </Tag>

            <Tooltip title="平台统一时区（Asia/Shanghai）">
              <span
                className="qt-mono"
                style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', whiteSpace: 'nowrap' }}
              >
                {clockText.format('YYYY-MM-DD HH:mm:ss')}
              </span>
            </Tooltip>

            <TaskCenter />

            <Dropdown
              menu={{ items: userMenu, onClick: onUserMenuClick }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button type="text" style={{ height: 40, padding: '0 8px' }}>
                <Avatar
                  size={24}
                  icon={<UserOutlined />}
                  style={{ backgroundColor: semanticColors.primary }}
                />
                <span style={{ marginLeft: 8, fontSize: 13 }}>
                  {auth.user.name} · {ROLE_LABEL[auth.role]}
                </span>
              </Button>
            </Dropdown>
          </div>
        </Header>

        <Content id="main-content" tabIndex={-1}>
          <div
            style={{
              padding: 24,
              maxWidth: layoutTokens.contentMaxWidth,
              width: '100%',
              margin: '0 auto',
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

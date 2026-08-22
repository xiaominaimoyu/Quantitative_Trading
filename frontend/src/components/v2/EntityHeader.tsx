/**
 * EntityHeader — 统一详情页头部
 *
 * 面包屑 / 标题 + StatusTag / meta 行 / 操作区
 * 滚动 >120px 吸顶迷你头
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Breadcrumb, Button, Dropdown, Space } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { Link } from 'react-router'
import { StatusTagV2 } from './StatusTagV2'
import { CopyableIdV2 } from './CopyableIdV2'
import type { StatusDomain } from '@/components/StatusTag'
import type { Crumb } from '@/router'

interface EntityHeaderProps {
  title: ReactNode
  status?: string
  statusDomain?: StatusDomain
  breadcrumbs?: Crumb[]
  id?: string
  idLabel?: string
  meta?: ReactNode
  primaryAction?: { label: string; onClick: () => void; icon?: ReactNode }
  secondaryActions?: { label: string; onClick: () => void; icon?: ReactNode }[]
}

export function EntityHeader({
  title,
  status,
  statusDomain,
  breadcrumbs,
  id,
  idLabel,
  meta,
  primaryAction,
  secondaryActions = [],
}: EntityHeaderProps) {
  const [sticky, setSticky] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => {
      setSticky(window.scrollY > 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const visibleSecondary = secondaryActions.slice(0, 3)
  const overflowActions = secondaryActions.slice(3)

  const renderBreadcrumbs = () => {
    if (!breadcrumbs || breadcrumbs.length === 0) return null
    const items = breadcrumbs
    const showItems = items.length > 4 ? [items[0], ...items.slice(-3)] : items
    const hasCollapse = items.length > 4

    return (
      <Breadcrumb
        items={showItems.map((c, i) => ({
          title:
            i === showItems.length - 1 || !c.path ? (
              <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
            ) : (
              <Link to={c.path!} style={{ color: 'var(--text-secondary)' }}>
                {c.label}
              </Link>
            ),
        }))}
        style={{ marginBottom: 8 }}
      />
    )
  }

  const renderHeader = (isSticky: boolean) => (
    <div
      ref={isSticky ? undefined : ref}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: isSticky ? 'nowrap' : 'wrap',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: isSticky ? 16 : 'var(--font-size-xl)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </h1>
      {status && <StatusTagV2 status={status} domain={statusDomain} />}
      <div style={{ flex: 1 }} />
      <Space size={8}>
        {primaryAction && (
          <Button type="primary" icon={primaryAction.icon} onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
        {visibleSecondary.map((a) => (
          <Button key={a.label} icon={a.icon} onClick={a.onClick}>
            {a.label}
          </Button>
        ))}
        {overflowActions.length > 0 && (
          <Dropdown
            menu={{
              items: overflowActions.map((a) => ({
                key: a.label,
                label: a.label,
                onClick: a.onClick,
              })),
            }}
          >
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </Space>
    </div>
  )

  return (
    <>
      {!sticky && (
        <div style={{ marginBottom: 16 }}>
          {renderBreadcrumbs()}
          {renderHeader(false)}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 8,
              color: 'var(--text-tertiary)',
              fontSize: 13,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {id && <CopyableIdV2 id={id} label={idLabel} maxLength={16} size="sm" />}
            {meta}
          </div>
        </div>
      )}
      {sticky && (
        <div
          style={{
            position: 'sticky',
            top: 'var(--header-height)',
            zIndex: 'var(--z-sticky)',
            background: 'var(--bg-container)',
            borderBottom: '1px solid var(--border-base)',
            padding: '8px 0',
            marginBottom: 16,
            backdropFilter: 'blur(8px)',
          }}
        >
          {renderHeader(true)}
        </div>
      )}
    </>
  )
}

export default EntityHeader
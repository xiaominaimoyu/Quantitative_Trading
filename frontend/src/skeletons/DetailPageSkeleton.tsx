/**
 * DetailPageSkeleton — 详情页骨架 B
 *
 * 「面包屑 + EntityHeader + KpiStrip + Tabs」
 * Tabs 懒加载，切页签保持各自滚动位置
 * 必含血缘页签
 */

import { Suspense, useRef, type ReactNode } from 'react'
import { Tabs, Skeleton, ErrorBoundary } from 'antd'
import type { TabsProps } from 'antd'
import { EntityHeader } from '@/components/v2/EntityHeader'
import { KpiStrip, type KpiItem } from '@/components/v2/KpiStrip'
import { LineageGraph, type LineageNode, type LineageEdge } from '@/components/v2/LineageGraph'
import type { Crumb } from '@/router'
import type { StatusDomain } from '@/components/StatusTag'

interface DetailTab {
  key: string
  label: string
  content: ReactNode
  lazy?: boolean
}

interface DetailPageSkeletonProps {
  title: ReactNode
  status?: string
  statusDomain?: StatusDomain
  breadcrumbs?: Crumb[]
  id?: string
  idLabel?: string
  meta?: ReactNode
  primaryAction?: { label: string; onClick: () => void; icon?: ReactNode }
  secondaryActions?: { label: string; onClick: () => void; icon?: ReactNode }[]
  kpiItems?: KpiItem[]
  kpiLayout?: 'strip' | 'card'
  tabs: DetailTab[]
  defaultTabKey?: string
  lineage?: { nodes: LineageNode[]; edges: LineageEdge[]; currentId?: string }
}

function TabContent({ tab }: { tab: DetailTab }) {
  return (
    <ErrorBoundary
      fallback={<div>加载失败，请重试</div>}
    >
      <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
        {tab.content}
      </Suspense>
    </ErrorBoundary>
  )
}

export function DetailPageSkeleton({
  title,
  status,
  statusDomain,
  breadcrumbs,
  id,
  idLabel,
  meta,
  primaryAction,
  secondaryActions,
  kpiItems,
  kpiLayout = 'strip',
  tabs,
  defaultTabKey,
  lineage,
}: DetailPageSkeletonProps) {
  const allTabs: DetailTab[] = [...tabs]
  if (lineage) {
    allTabs.push({
      key: 'lineage',
      label: '血缘',
      content: (
        <LineageGraph
          nodes={lineage.nodes}
          edges={lineage.edges}
          currentId={lineage.currentId}
        />
      ),
    })
  }

  const tabItems: TabsProps['items'] = allTabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    children: <TabContent tab={tab} />,
    forceRender: !tab.lazy,
  }))

  return (
    <div>
      <EntityHeader
        title={title}
        status={status}
        statusDomain={statusDomain}
        breadcrumbs={breadcrumbs}
        id={id}
        idLabel={idLabel}
        meta={meta}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />

      {kpiItems && kpiItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <KpiStrip items={kpiItems} layout={kpiLayout} />
        </div>
      )}

      <Tabs items={tabItems} defaultActiveKey={defaultTabKey} destroyInactiveTabPane={false} />
    </div>
  )
}

export default DetailPageSkeleton
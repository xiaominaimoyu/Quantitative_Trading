/**
 * ListPageSkeleton — 列表页骨架 A
 *
 * 「标题 + FilterBar + 紧凑表格 + 分页」
 */

import type { ReactNode } from 'react'
import { Table, Pagination, Card, Empty, Button, Alert, Result } from 'antd'
import type { TableProps } from 'antd'
import { PageSkeleton } from './PageSkeleton'
import { FilterBar, type FilterSpec } from '@/components/v2/FilterBar'

interface ListPageSkeletonProps<T> {
  title: ReactNode
  extra?: ReactNode
  searchKey?: string
  filters?: FilterSpec[]
  columns: TableProps<T>['columns']
  dataSource: T[]
  loading?: boolean
  error?: { message: string; traceId?: string; onRetry?: () => void }
  empty?: { description?: string }
  rowKey: string | ((record: T) => string)
  pagination?: {
    current: number
    pageSize: number
    total: number
    onChange: (page: number, pageSize: number) => void
  }
  onSaveView?: () => void
  onReset?: () => void
  viewMode?: 'table' | 'card'
  onViewModeChange?: (mode: 'table' | 'card') => void
  cardRender?: (item: T) => ReactNode
}

export function ListPageSkeleton<T>({
  title,
  extra,
  searchKey,
  filters = [],
  columns,
  dataSource,
  loading = false,
  error,
  empty,
  rowKey,
  pagination,
  onSaveView,
  onReset,
  viewMode,
  onViewModeChange,
  cardRender,
}: ListPageSkeletonProps<T>) {
  if (error) {
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle={error.message}
        extra={
          error.onRetry && (
            <Button type="primary" onClick={error.onRetry}>
              重试
            </Button>
          )
        }
      />
    )
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--font-size-xl)',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h2>
        {extra}
      </div>

      {(searchKey || filters.length > 0) && (
        <FilterBar
          searchKey={searchKey}
          filters={filters}
          onSaveView={onSaveView}
          onReset={onReset}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      )}

      {loading ? (
        <PageSkeleton type="table" rows={8} />
      ) : dataSource.length === 0 ? (
        <Empty
          description={empty?.description ?? '暂无数据'}
          style={{ padding: 48 }}
        />
      ) : viewMode === 'card' && cardRender ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {dataSource.map((item) => (
            <Card key={typeof rowKey === 'function' ? rowKey(item) : String(item[rowKey as keyof T])}>
              {cardRender(item)}
            </Card>
          ))}
        </div>
      ) : (
        <Table<T>
          columns={columns}
          dataSource={dataSource}
          rowKey={rowKey}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          style={{
            background: 'var(--bg-container)',
            borderRadius: 'var(--radius-md)',
          }}
        />
      )}

      {pagination && !loading && dataSource.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Pagination
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={pagination.onChange}
            showSizeChanger
            showTotal={(total) => `共 ${total} 条`}
          />
        </div>
      )}
    </div>
  )
}

export default ListPageSkeleton
/**
 * FilterBar — 列表页统一筛选栏
 *
 * 左搜索框 + 筛选器组 + 更多筛选抽屉 + 右侧（重置/视图切换/密度切换）
 * 全部筛选状态写入 URL query
 */

import { useState, type ReactNode } from 'react'
import { Button, Drawer, Input, Select, DatePicker, Space, Segmented } from 'antd'
import {
  SearchOutlined,
  FilterOutlined,
  ReloadOutlined,
  SaveOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useUrlState } from '@/shared/useUrlState'
import { useTheme } from '@/theme'

export type FilterType = 'select' | 'dateRange' | 'chips'

export interface FilterSpec {
  key: string
  label: string
  type: FilterType
  options?: { label: string; value: string }[]
  defaultValue?: string
  inDrawer?: boolean
}

interface FilterBarProps {
  searchKey?: string
  filters: FilterSpec[]
  extra?: ReactNode
  onSaveView?: () => void
  onReset?: () => void
  viewMode?: 'table' | 'card'
  onViewModeChange?: (mode: 'table' | 'card') => void
}

export function FilterBar({
  searchKey,
  filters,
  extra,
  onSaveView,
  onReset,
  viewMode,
  onViewModeChange,
}: FilterBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { density, setDensity } = useTheme()

  const [searchValue, setSearchValue] = useUrlState(searchKey ?? '', '')

  const visibleFilters = filters.filter((f) => !f.inDrawer)
  const drawerFilters = filters.filter((f) => f.inDrawer)

  const renderFilter = (spec: FilterSpec): ReactNode => {
    const [val, setVal] = useUrlState(spec.key, spec.defaultValue ?? '')

    if (spec.type === 'select') {
      return (
        <Select
          key={spec.key}
          placeholder={spec.label}
          value={val || undefined}
          onChange={setVal}
          allowClear
          options={spec.options}
          style={{ minWidth: 120 }}
        />
      )
    }

    if (spec.type === 'dateRange') {
      return (
        <DatePicker.RangePicker
          key={spec.key}
          placeholder={[spec.label, '']}
          style={{ minWidth: 200 }}
        />
      )
    }

    if (spec.type === 'chips') {
      return (
        <Select
          key={spec.key}
          mode="multiple"
          placeholder={spec.label}
          value={val ? val.split(',') : []}
          onChange={(vals) => setVal(vals.join(','))}
          allowClear
          options={spec.options}
          style={{ minWidth: 120, maxWidth: 240 }}
        />
      )
    }

    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        flexWrap: 'wrap',
      }}
    >
      {searchKey && (
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--text-tertiary)' }} />}
          placeholder="搜索..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
      )}

      <Space size={8} wrap>
        {visibleFilters.map(renderFilter)}
      </Space>

      {drawerFilters.length > 0 && (
        <Button
          icon={<FilterOutlined />}
          onClick={() => setDrawerOpen(true)}
        >
          更多筛选
        </Button>
      )}

      <div style={{ flex: 1 }} />

      {extra}

      {onSaveView && (
        <Button icon={<SaveOutlined />} type="text" onClick={onSaveView}>
          保存视图
        </Button>
      )}

      {viewMode && onViewModeChange && (
        <Segmented
          value={viewMode}
          onChange={(v) => onViewModeChange(v as 'table' | 'card')}
          options={[
            { label: '表格', value: 'table' },
            { label: '卡片', value: 'card' },
          ]}
          size="small"
        />
      )}

      <Segmented
        value={density}
        onChange={(v) => setDensity(v as 'compact' | 'comfortable')}
        options={[
          { label: '紧凑', value: 'compact' },
          { label: '标准', value: 'comfortable' },
        ]}
        size="small"
      />

      {onReset && (
        <Button icon={<ReloadOutlined />} type="text" onClick={onReset}>
          重置
        </Button>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="更多筛选"
        width={360}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {drawerFilters.map(renderFilter)}
        </Space>
      </Drawer>
    </div>
  )
}
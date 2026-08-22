/**
 * LogViewer — 日志视图
 *
 * 虚拟滚动、级别过滤、关键词高亮、跟随模式
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { Input, Segmented, Button, Tag, Tooltip } from 'antd'
import {
  DownOutlined,
  DownloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'

export interface LogEntry {
  ts: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  message: string
}

interface LogViewerProps {
  entries: LogEntry[]
  height?: number
  follow?: boolean
  onExport?: () => void
}

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  DEBUG: 'var(--text-tertiary)',
  INFO: 'var(--color-processing)',
  WARN: 'var(--color-warning)',
  ERROR: 'var(--color-error)',
}

const VIRTUAL_THRESHOLD = 1000
const PAGE_SIZE = 100

export function LogViewer({ entries, height = 400, follow: initialFollow = false, onExport }: LogViewerProps) {
  const [levelFilter, setLevelFilter] = useState<LogEntry['level'] | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(initialFollow)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (levelFilter !== 'ALL' && e.level !== levelFilter) return false
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [entries, levelFilter, search])

  const visible = filtered.slice(0, Math.min(visibleCount, filtered.length))

  const levelCounts = useMemo(() => {
    const counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 } as Record<LogEntry['level'], number>
    for (const e of entries) counts[e.level]++
    return counts
  }, [entries])

  useEffect(() => {
    if (follow && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [visible, follow])

  const onScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    if (scrollHeight - scrollTop - clientHeight < 100) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))
    }
    if (scrollTop < 50) {
      setFollow(false)
    }
  }, [filtered.length])

  const highlight = (text: string) => {
    if (!search) return text
    const idx = text.toLowerCase().indexOf(search.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'var(--color-warning)', color: 'var(--text-primary)', padding: '0 2px' }}>
          {text.slice(idx, idx + search.length)}
        </mark>
        {text.slice(idx + search.length)}
      </>
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-container)',
        border: '1px solid var(--border-base)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        height,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-base)',
          flexShrink: 0,
        }}
      >
        <Segmented
          size="small"
          value={levelFilter}
          onChange={(v) => setLevelFilter(v as typeof levelFilter)}
          options={[
            { label: '全部', value: 'ALL' },
            { label: `DEBUG (${levelCounts.DEBUG})`, value: 'DEBUG' },
            { label: `INFO (${levelCounts.INFO})`, value: 'INFO' },
            { label: `WARN (${levelCounts.WARN})`, value: 'WARN' },
            { label: `ERROR (${levelCounts.ERROR})`, value: 'ERROR' },
          ]}
        />
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder="过滤..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 160 }}
          allowClear
        />
        <div style={{ flex: 1 }} />
        {onExport && (
          <Button size="small" icon={<DownloadOutlined />} onClick={onExport}>
            导出
          </Button>
        )}
      </div>

      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {visible.map((entry, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              padding: '1px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            <span className="qt-tabular" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {entry.ts}
            </span>
            <Tag
              style={{
                fontSize: 10,
                lineHeight: '14px',
                padding: '0 4px',
                margin: 0,
                color: LEVEL_COLOR[entry.level],
                borderColor: 'transparent',
                background: 'transparent',
                flexShrink: 0,
                width: 44,
                textAlign: 'center',
              }}
            >
              {entry.level}
            </Tag>
            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {highlight(entry.message)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!follow && (
        <Button
          size="small"
          icon={<DownOutlined />}
          onClick={() => setFollow(true)}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
          }}
        >
          回到底部
        </Button>
      )}
    </div>
  )
}

export default LogViewer
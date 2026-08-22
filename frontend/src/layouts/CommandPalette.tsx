/**
 * CommandPalette — 命令面板（⌘K）
 *
 * 三类分组：页面 / 实体 / 操作
 * 防抖 250ms，每类 ≤5 条
 * 未输入时展示最近访问 10 条
 * ↑↓ 键盘导航，↵ 执行
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Input, Spin, Empty } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import { useAutoRecentAccess } from '@/shared/useRecentAccess'

export interface CommandResult {
  id: string
  label: string
  description?: string
  group: 'page' | 'entity' | 'action'
  icon?: React.ReactNode
  to?: string
  run?: () => void
}

export interface CommandSource {
  group: CommandResult['group']
  search: (query: string) => Promise<CommandResult[]>
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  sources: CommandSource[]
  recentLimit?: number
}

const GROUP_LABELS: Record<CommandResult['group'], string> = {
  page: '页面',
  entity: '实体',
  action: '操作',
}

export function CommandPalette({
  open,
  onClose,
  sources,
  recentLimit = 10,
}: CommandPaletteProps) {
  const navigate = useNavigate()
  const { recent, push } = useAutoRecentAccess()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CommandResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number>(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const execute = useCallback(
    (item: CommandResult) => {
      if (item.to) {
        navigate(item.to)
        push({ path: item.to, label: item.label })
      } else if (item.run) {
        item.run()
      }
      onClose()
    },
    [navigate, push, onClose],
  )

  useEffect(() => {
    if (!open) return

    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    clearTimeout(debounceRef.current)
    setLoading(true)

    debounceRef.current = window.setTimeout(async () => {
      try {
        const allResults = await Promise.allSettled(
          sources.map((s) => s.search(query).then((r) => r.slice(0, 5))),
        )
        const merged: CommandResult[] = []
        for (const r of allResults) {
          if (r.status === 'fulfilled') merged.push(...r.value)
        }
        setResults(merged)
        setActiveIndex(0)
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => clearTimeout(debounceRef.current)
  }, [query, sources, open])

  const displayItems = useMemo(() => {
    if (!query.trim() && recent.length > 0) {
      return recent.slice(0, recentLimit).map((r) => ({
        id: r.path,
        label: r.label,
        group: 'page' as const,
        to: r.path,
      }))
    }
    return results
  }, [query, results, recent, recentLimit])

  const grouped = useMemo(() => {
    const map = new Map<CommandResult['group'], CommandResult[]>()
    for (const item of displayItems) {
      const arr = map.get(item.group) ?? []
      arr.push(item)
      map.set(item.group, arr)
    }
    return map
  }, [displayItems])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((p) => Math.min(p + 1, displayItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((p) => Math.max(p - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = displayItems[activeIndex]
      if (item) execute(item)
    }
  }

  let flatIndex = -1

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      centered
      closable={false}
      styles={{
        body: { padding: 0 },
        content: {
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-base)',
          borderRadius: 'var(--radius-lg)',
        },
      }}
      style={{ zIndex: 'var(--z-command-palette)' }}
    >
      <Input
        ref={inputRef as never}
        prefix={<SearchOutlined style={{ color: 'var(--text-tertiary)' }} />}
        placeholder="搜索或跳转..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          border: 'none',
          borderBottom: '1px solid var(--border-base)',
          borderRadius: 0,
          fontSize: 16,
          padding: '12px 16px',
        }}
      />

      <div
        style={{
          maxHeight: 400,
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {loading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        )}

        {!loading && displayItems.length === 0 && (
          <Empty
            description={query.trim() ? '无匹配结果' : '开始输入以搜索'}
            style={{ padding: 24 }}
          />
        )}

        {!loading &&
          Array.from(grouped.entries()).map(([group, items]) => (
            <div key={group}>
              <div
                style={{
                  padding: '4px 16px',
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {GROUP_LABELS[group]}
              </div>
              {items.map((item) => {
                flatIndex++
                const isActive = flatIndex === activeIndex
                const idx = flatIndex
                return (
                  <div
                    key={item.id}
                    onClick={() => execute(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    style={{
                      padding: '8px 16px',
                      cursor: 'pointer',
                      background: isActive ? 'var(--bg-hover)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {item.icon}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                      {item.description && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-tertiary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
      </div>
    </Modal>
  )
}
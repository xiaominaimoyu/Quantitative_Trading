/**
 * 全局快捷键管理器
 *
 * 支持组合键（mod+k）与序列键（g d）。
 * 输入框聚焦时 disabledInInput 绑定自动失效。
 */

import { useEffect, useRef } from 'react'

export interface HotkeyBinding {
  keys: string
  handler: () => void
  disabledInInput?: boolean
  description?: string
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

function parseKeys(keys: string): { mod: boolean; sequence: string[] } {
  const parts = keys.toLowerCase().split(/\s+/)
  const first = parts[0]
  const mod = first === 'mod'
  const sequence = mod ? parts.slice(1) : parts
  return { mod, sequence }
}

function matchKey(e: KeyboardEvent, key: string): boolean {
  if (key === 'mod') return e.ctrlKey || e.metaKey
  return e.key.toLowerCase() === key
}

export function useHotkeys(bindings: HotkeyBinding[]): void {
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  const sequenceRef = useRef<string[]>([])
  const sequenceTimerRef = useRef<number>(0)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = bindingsRef.current
      const inInput = isInputFocused()

      // 序列键处理（如 g d）
      if (sequenceRef.current.length > 0) {
        const prefix = sequenceRef.current.join(' ')
        for (const b of active) {
          if (b.disabledInInput && inInput) continue
          const { sequence } = parseKeys(b.keys)
          if (sequence.length > 1 && sequence.slice(0, -1).join(' ') === prefix) {
            const last = sequence[sequence.length - 1]
            if (e.key.toLowerCase() === last) {
              e.preventDefault()
              sequenceRef.current = []
              clearTimeout(sequenceTimerRef.current)
              b.handler()
              return
            }
          }
        }
      }

      // 单键 / mod 组合键
      for (const b of active) {
        if (b.disabledInInput && inInput) continue
        const { mod, sequence } = parseKeys(b.keys)

        if (sequence.length === 1) {
          if (mod) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === sequence[0]) {
              e.preventDefault()
              b.handler()
              return
            }
          } else {
            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === sequence[0]) {
              // 检查是否是序列键的第一步
              const allSeqs = active
                .filter((a) => !a.disabledInInput || !inInput)
                .map((a) => parseKeys(a.keys).sequence)
              const isSeqStart = allSeqs.some(
                (s) => s.length > 1 && s[0] === e.key.toLowerCase(),
              )
              if (isSeqStart) {
                sequenceRef.current = [e.key.toLowerCase()]
                clearTimeout(sequenceTimerRef.current)
                sequenceTimerRef.current = window.setTimeout(() => {
                  sequenceRef.current = []
                }, 800)
                return
              }
              e.preventDefault()
              b.handler()
              return
            }
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** 快捷键帮助列表 */
export const HOTKEY_HELP: { keys: string; desc: string }[] = [
  { keys: 'Ctrl/⌘ K', desc: '命令面板' },
  { keys: '[', desc: '折叠/展开侧栏' },
  { keys: 'g d', desc: '跳转工作台' },
  { keys: 'g e', desc: '跳转实验' },
  { keys: 'g s', desc: '跳转策略' },
  { keys: 'g r', desc: '跳转报告' },
  { keys: 'g k', desc: '跳转风险' },
  { keys: 'g a', desc: '跳转审计' },
  { keys: '?', desc: '快捷键帮助' },
  { keys: 'Esc', desc: '关闭弹层' },
  { keys: 't', desc: '切换暗色/浅色' },
]
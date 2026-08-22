/**
 * NavBadge — 导航项右侧小号徽标（Beta/沙盒等）
 */

import type { ReactNode } from 'react'

interface NavBadgeProps {
  text: string
  color?: 'primary' | 'warning' | 'success'
}

const colorMap = {
  primary: 'var(--color-primary)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
}

export function NavBadge({ text, color = 'primary' }: NavBadgeProps): ReactNode {
  return (
    <span
      style={{
        fontSize: 11,
        color: colorMap[color],
        background: 'var(--bg-hover)',
        padding: '0 4px',
        borderRadius: 'var(--radius-sm)',
        marginLeft: 6,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}
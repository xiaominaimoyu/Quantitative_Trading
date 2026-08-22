/**
 * StatusTagV2 — 状态标签 v2
 *
 * 基于存量 StatusTag 扩展 breathing 变体（仅透明度过渡 ≤100ms）
 */

import type { ReactNode } from 'react'
import StatusTag, { type StatusDomain } from '@/components/StatusTag'

export interface StatusTagV2Props {
  status: string
  domain?: StatusDomain
  icon?: ReactNode
  label?: string
  className?: string
  breathing?: boolean
}

export function StatusTagV2({
  status,
  domain,
  icon,
  label,
  className,
  breathing = false,
}: StatusTagV2Props) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <StatusTag status={status} domain={domain} icon={icon} label={label} className={className} />
      {breathing && (
        <span
          className="qt-breathing-dot"
          style={{
            position: 'absolute',
            left: -2,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-processing)',
            animation: 'qt-breathing 1.5s ease-in-out infinite',
          }}
        />
      )}
      <style>{`
        @keyframes qt-breathing {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .qt-breathing-dot { animation: none !important; opacity: 0.8; }
        }
      `}</style>
    </span>
  )
}

export default StatusTagV2
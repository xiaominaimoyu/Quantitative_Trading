/**
 * PageForbidden —— 无权限访问（403）。
 *
 * 展示当前角色与所需角色，明确「不是故障」；提供返回工作台入口。
 */

import type { ReactNode } from 'react'
import { Button, Result } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import { useAuth } from '@/app/AuthContext'

export interface PageForbiddenProps {
  requiredRole?: string
  currentRole?: string
  description?: ReactNode
}

export default function PageForbidden({
  requiredRole,
  currentRole,
  description,
}: PageForbiddenProps) {
  const navigate = useNavigate()
  const auth = useAuth()
  const shownCurrent = currentRole ?? auth.role

  return (
    <Result
      status="403"
      icon={<LockOutlined />}
      title="无权访问"
      subTitle={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>
            {description ??
              `当前角色（${shownCurrent}）无权限查看此页面`}
          </span>
          {requiredRole ? (
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              需要角色：{requiredRole}
            </span>
          ) : null}
        </div>
      }
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          返回工作台
        </Button>
      }
    />
  )
}

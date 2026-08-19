/**
 * AuthContext —— 研究控制台角色状态。
 *
 * 角色：研究员（默认）/ 审计员 / 管理员。
 * 审计类操作（批准报告 / 撤销发布）要求审计员及以上，本上下文提供角色切换入口。
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { setDevSessionRole, type DevSessionRole } from '@/api/session'
import { DEV_LOGIN_NAME } from '@/api/config'
import {
  B3_ROLE_SCOPES,
  canManageOwnedResource,
  type B3OwnedActionScope,
} from './researchPermissions'

export type UserRole = DevSessionRole

export interface UserInfo {
  name: string
  role: UserRole
  ownerKey: string
  scopes: readonly string[]
}

/** 角色 → 中文标签 */
export const ROLE_LABEL: Record<UserRole, string> = {
  researcher: '研究员',
  auditor: '审计员',
  admin: '管理员',
}

interface AuthContextValue {
  user: UserInfo
  role: UserRole
  scopes: readonly string[]
  hasScope: (scope: string) => boolean
  canManageOwned: (scope: B3OwnedActionScope, ownerKey: string) => boolean
  /** 切换角色；real 模式会使下一次请求重新建立开发会话。 */
  switchRole: (role: UserRole) => void
}

const MOCK_USERS: Record<UserRole, UserInfo> = {
  researcher: {
    name: '陈默',
    role: 'researcher',
    ownerKey: `${DEV_LOGIN_NAME}-researcher`,
    scopes: B3_ROLE_SCOPES.researcher,
  },
  auditor: {
    name: '审计员',
    role: 'auditor',
    ownerKey: `${DEV_LOGIN_NAME}-auditor`,
    scopes: B3_ROLE_SCOPES.auditor,
  },
  admin: {
    name: '管理员',
    role: 'admin',
    ownerKey: `${DEV_LOGIN_NAME}-admin`,
    scopes: B3_ROLE_SCOPES.admin,
  },
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo>(MOCK_USERS.researcher)

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role: user.role,
      scopes: user.scopes,
      hasScope: (scope) => user.scopes.includes(scope),
      canManageOwned: (scope, ownerKey) => canManageOwnedResource({
        role: user.role,
        scopes: user.scopes,
        requiredScope: scope,
        actorOwnerKey: user.ownerKey,
        resourceOwnerKey: ownerKey,
      }),
      switchRole: (role) => {
        setDevSessionRole(role)
        setUser(MOCK_USERS[role])
      },
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  }
  return ctx
}

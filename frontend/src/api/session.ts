import { ApiError, apiErrorFromResponse, generateRequestId } from './client.ts'
import {
  API_BASE_URL,
  DEV_LOGIN_NAME,
  canUseDevSession,
  isRealApiMode,
} from './config.ts'
import type {
  DevSessionRequest,
  DevSessionResponse,
  MeOut,
} from './generated/schema.ts'

export type DevSessionRole = 'researcher' | 'auditor' | 'admin'

interface CachedSession {
  token: string
  expiresAt: number
  role: DevSessionRole
}

let activeRole: DevSessionRole = 'researcher'
let cachedSession: CachedSession | null = null
let pendingSession: { role: DevSessionRole; promise: Promise<string> } | null = null

export function setDevSessionRole(role: DevSessionRole): void {
  if (role === activeRole) return
  activeRole = role
  resetDevSession()
}

export function resetDevSession(): void {
  cachedSession = null
  pendingSession = null
}

export async function requestDevSession(role: DevSessionRole): Promise<string> {
  if (!canUseDevSession) {
    throw new ApiError({
      code: 'DEV_SESSION_DISABLED',
      message: '真实 API 模式的开发会话仅可在 Vite development 环境使用',
      requestId: generateRequestId(),
    })
  }

  const body: DevSessionRequest = {
    login_name: `${DEV_LOGIN_NAME}-${role}`,
    role,
  }
  const requestId = generateRequestId()
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/dev-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: '无法连接后端服务，请确认 API 已启动',
      requestId,
      details: error,
    })
  }
  if (!response.ok) throw await apiErrorFromResponse(response)

  const session = (await response.json()) as DevSessionResponse
  const expiresAt = Date.parse(session.expires_at)
  if (
    !session.token ||
    session.role !== role ||
    !Array.isArray(session.scopes) ||
    !Number.isFinite(expiresAt)
  ) {
    throw new ApiError({
      code: 'INVALID_SESSION_RESPONSE',
      message: '开发会话响应缺少有效令牌',
      requestId: response.headers.get('X-Request-Id') ?? requestId,
    })
  }

  const meRequestId = generateRequestId()
  let meResponse: Response
  try {
    meResponse = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.token}`,
        'X-Request-Id': meRequestId,
      },
    })
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: '无法校验开发会话，请确认 API 已启动',
      requestId: meRequestId,
      details: error,
    })
  }
  if (!meResponse.ok) throw await apiErrorFromResponse(meResponse)

  const me = (await meResponse.json()) as MeOut
  const expectedScopes = [...session.scopes].sort()
  const actualScopes = Array.isArray(me.scopes) ? [...me.scopes].sort() : []
  if (
    me.login_name !== body.login_name ||
    me.role !== role ||
    expectedScopes.length !== actualScopes.length ||
    expectedScopes.some((scope, index) => scope !== actualScopes[index])
  ) {
    throw new ApiError({
      code: 'INVALID_SESSION_IDENTITY',
      message: '开发会话身份校验失败',
      requestId: meResponse.headers.get('X-Request-Id') ?? meRequestId,
    })
  }

  if (activeRole === role) {
    cachedSession = {
      token: session.token,
      expiresAt,
      role,
    }
  }
  return session.token
}

export async function getDevAccessToken(): Promise<string | null> {
  if (!isRealApiMode) return null
  const nowWithMargin = Date.now() + 30_000
  if (
    cachedSession?.role === activeRole &&
    cachedSession.expiresAt > nowWithMargin
  ) {
    return cachedSession.token
  }
  if (pendingSession?.role === activeRole) return pendingSession.promise

  const role = activeRole
  const promise = requestDevSession(role).finally(() => {
    if (pendingSession?.promise === promise) pendingSession = null
  })
  pendingSession = { role, promise }
  return promise
}

import {
  ApiError,
  apiErrorFromResponse,
  generateRequestId,
} from './client.ts'
import { API_BASE_URL } from './config.ts'
import { getDevAccessToken, resetDevSession } from './session.ts'

async function request<T>(
  path: string,
  init: RequestInit,
  retryAuth: boolean,
  requestId: string,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', requestId)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const token = await getDevAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers,
    })
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: '无法连接后端服务，请确认 API 已启动',
      requestId,
      details: error,
    })
  }

  if (response.status === 401 && retryAuth) {
    resetDevSession()
    return request<T>(path, init, false, requestId)
  }
  if (!response.ok) throw await apiErrorFromResponse(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestId = new Headers(init.headers).get('X-Request-Id') ?? generateRequestId()
  return request<T>(path, init, true, requestId)
}

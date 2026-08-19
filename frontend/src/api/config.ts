export type ApiMode = 'mock' | 'real'

const env = import.meta.env ?? {}
const configuredMode = env.VITE_API_MODE?.trim().toLowerCase()

export const API_MODE: ApiMode = configuredMode === 'real' ? 'real' : 'mock'
export const isRealApiMode = API_MODE === 'real'
export const API_BASE_URL = (
  env.VITE_API_BASE_URL?.trim() || 'http://localhost:8000/api/v1'
).replace(/\/+$/, '')
export const DEV_LOGIN_NAME = env.VITE_DEV_LOGIN_NAME?.trim() || 'frontend-dev'
export const canUseDevSession = env.DEV !== false

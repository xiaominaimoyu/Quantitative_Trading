import { asApiError } from '../client.ts'

export function isForbiddenError(error: unknown): boolean {
  const apiError = asApiError(error)
  return apiError?.code === 'FORBIDDEN' || apiError?.code === 'OBJECT_FORBIDDEN'
}

export function createIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function auditEventIdFromNavigation(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !('auditEventId' in state)) return null
  const value = state.auditEventId
  return typeof value === 'string' && value ? value : null
}

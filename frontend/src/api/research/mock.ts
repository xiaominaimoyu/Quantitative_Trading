import { ApiError, generateRequestId } from '../client.ts'
import type { MutationOptions } from './types.ts'

const records = new Map<string, { fingerprint: string; value: unknown }>()

export function replayMockMutation<T>(
  target: string,
  input: unknown,
  options: MutationOptions,
  create: () => T,
): T {
  const recordKey = `${target}:${options.idempotencyKey}`
  const fingerprint = JSON.stringify(input)
  const previous = records.get(recordKey)
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new ApiError({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '相同幂等键不能用于不同请求',
        requestId: generateRequestId(),
      })
    }
    return previous.value as T
  }
  const value = create()
  records.set(recordKey, { fingerprint, value })
  return value
}

export function mockAuditId(): string {
  return crypto.randomUUID()
}

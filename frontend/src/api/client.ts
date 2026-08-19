/**
 * API 客户端基座
 *
 * 错误模型：稳定错误码（IR-005 风格）+ 可读说明 + 关联编号（requestId），
 * 绝不向界面泄露堆栈。Mock 与真实 HTTP 请求都统一抛出 ApiError。
 */

/** ApiError 载荷（稳定契约） */
export interface ApiErrorPayload {
  /** 稳定错误码，如 'IR-005' */
  code: string
  /** 可读说明（中文） */
  message: string
  /** 关联编号，便于审计追溯 */
  requestId: string
  /** 附加详情（可选，不用于展示堆栈） */
  details?: unknown
}

/** 平台统一错误类型 */
export class ApiError extends Error {
  readonly code: string
  readonly requestId: string
  readonly details?: unknown

  constructor(payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code
    this.requestId = payload.requestId
    this.details = payload.details
  }
}

/** 从任意 throw 值中提取 ApiError（非 ApiError 返回 null） */
export function asApiError(err: unknown): ApiError | null {
  return err instanceof ApiError ? err : null
}

/** 生成关联编号，如 REQ-20260808-3F2A */
export function generateRequestId(): string {
  const date = new Date()
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase()
  return `REQ-${ymd}-${rand}`
}

interface BackendErrorEnvelope {
  error?: {
    code?: string
    message?: string
    request_id?: string
    details?: unknown
  }
}

/** 将后端统一错误响应转换为页面已经使用的 ApiError。 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let payload: BackendErrorEnvelope = {}
  try {
    payload = (await response.json()) as BackendErrorEnvelope
  } catch {
    // 非 JSON 错误仍使用状态码和响应头构造稳定错误。
  }
  const body = payload.error
  return new ApiError({
    code: body?.code ?? `HTTP_${response.status}`,
    message: body?.message ?? `请求失败（HTTP ${response.status}）`,
    requestId:
      body?.request_id ??
      response.headers.get('X-Request-Id') ??
      generateRequestId(),
    details: body?.details,
  })
}

export interface MockRequestOptions {
  /** 延迟：固定毫秒数，或 [min, max] 区间；默认 [150, 500] */
  latencyMs?: number | [number, number]
  /** 失败率 0–1，触发时抛 ApiError（code 'IR-005'） */
  failRate?: number
  /** 自定义失败错误码（默认 'IR-005'） */
  failCode?: string
  /** 自定义失败说明（默认「模拟服务暂不可用，请重试」） */
  failMessage?: string
}

/**
 * 模拟异步请求：延迟 + 可选随机失败。
 * factory 内抛出的任意异常会统一包装为 ApiError（带 requestId）。
 */
export function mockRequest<T>(
  factory: () => T,
  options?: MockRequestOptions,
): Promise<T> {
  const { latencyMs, failRate = 0, failCode, failMessage } = options ?? {}
  const delay = Array.isArray(latencyMs)
    ? latencyMs[0] + Math.random() * (latencyMs[1] - latencyMs[0])
    : latencyMs ?? 150 + Math.random() * 350

  const requestId = generateRequestId()

  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < failRate) {
        reject(
          new ApiError({
            code: failCode ?? 'IR-005',
            message: failMessage ?? '模拟服务暂不可用，请稍后重试',
            requestId,
          }),
        )
        return
      }
      try {
        resolve(factory())
      } catch (err) {
        if (err instanceof ApiError) {
          reject(err)
        } else {
          reject(
            new ApiError({
              code: failCode ?? 'IR-005',
              message: failMessage ?? '模拟服务内部错误，请重试',
              requestId,
              details: err,
            }),
          )
        }
      }
    }, delay)
  })
}

/**
 * BGM HTTP 请求模块
 * @module http
 * @description 支持异步请求、进度回调、自动重试、限流处理
 */

import { BGM_CONFIG, LOG_LEVELS } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'

import { bgmLog, BGM } from './util/index.js'
import type { ZodSchema } from './zodCompat.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type SyncProgressCallback = (current: number, total: number, message: string) => void

const VALID_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])

// ========== 内部工具函数 ==========

/**
 * 验证并标准化 HTTP 方法
 */
function validateMethod(method: string): HttpMethod {
  const upper = method.toUpperCase() as HttpMethod
  if (!VALID_METHODS.has(upper)) {
    throw new BgmError(`无效的 HTTP 方法: ${method}`, 'INVALID_METHOD')
  }
  return upper
}

/**
 * 验证 endpoint 安全性（防止路径遍历）
 */

function validateEndpoint(endpoint: string): void {
  if (!endpoint || typeof endpoint !== 'string') {
    throw new BgmError('endpoint 无效', 'INVALID_ENDPOINT')
  }
  if (endpoint.includes('..') || endpoint.startsWith('http')) {
    throw new BgmError('endpoint 包含非法字符', 'INVALID_ENDPOINT')
  }
}

/**
 * 异步延迟
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 根据 HTTP 状态码返回中文错误描述
 */
function getErrorMessage(status: number): string {
  const statusMessages: Record<number, string> = {
    400: '请求参数错误',
    401: 'Token 无效或已过期',
    403: '没有权限访问该资源',
    404: '请求的资源不存在',
    429: '请求过于频繁，已被限流',
    500: '服务器内部错误',
    502: '网关错误',
    503: '服务暂时不可用',
  }
  return statusMessages[status] || `HTTP 错误 (${String(status)})`
}

// ========== 异步 HTTP 请求（带进度） ==========

/**
 * httpRequest 选项
 * @template T - 期望的响应数据类型；仅在提供 zodSchema 时真正被校验
 */
export interface HttpRequestOptions<T> {
  method?: HttpMethod
  body?: string | null
  token?: string
  timeout?: number
  retries?: number
  onProgress?: (current: number, total: number) => void
  /**
   * 可选 Zod schema，用于在边界处运行时校验响应数据。
   * 若提供，则会以 schema.parse(data) 的结果作为 data 返回；
   * 若不提供，data 为 unknown，调用方需自行通过类型守卫或 schema 处理。
   */
  zodSchema?: ZodSchema<T>
  /**
   * 可选 AbortSignal，用于取消请求。
   * 若已 aborted，则立即失败；否则监听 abort 事件触发 xhr.abort()。
   */
  signal?: AbortSignal
}

/**
 * 异步发送 HTTP 请求（支持自动重试和进度回调）
 *
 * 类型说明：
 * - 默认 T = unknown，函数不会"伪装"知道响应结构。
 * - 若调用方需要类型化的响应，必须通过 options.zodSchema 提供运行时校验，
 *   否则 data 字段为 unknown，调用方需自行做类型守卫。
 *
 * @returns Promise<Result<{ status: number, data: T | null }>>
 */
export async function httpRequest<T = unknown>(
  endpoint: string,
  options: HttpRequestOptions<T> = {},
): Promise<Result<{ status: number; data: T | null }>> {
  const {
    method = 'GET',
    body = null,
    token,
    timeout = 30_000,
    retries = BGM_CONFIG.MAX_RETRIES,
    onProgress,
    zodSchema,
    signal,
  } = options

  // 输入验证
  try {
    validateEndpoint(endpoint)
    validateMethod(method)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'httpRequest', showAlert: false })
    const error_ =
      error instanceof BgmError ? error : new BgmError(String(error), 'VALIDATION_ERROR')
    return Result.fail(error_)
  }

  // 如果 signal 已 aborted，立即失败，不进入重试循环
  if (signal?.aborted) {
    return Result.fail(new BgmError('请求被取消', 'ABORTED'))
  }

  const validMethod = validateMethod(method)
  let attempt = 0

  while (attempt <= retries) {
    // 每次重试前再次检查 signal 是否已 aborted
    if (signal?.aborted) {
      return Result.fail(new BgmError('请求被取消', 'ABORTED'))
    }
    try {
      const response = await executeXhrRequest(BGM_CONFIG.API_BASE + endpoint, {
        method: validMethod,
        body,
        timeout,
        ...(token !== undefined && { token }),
        ...(onProgress !== undefined && { onProgress }),
        ...(signal !== undefined && { signal }),
      })

      if (response.status === 204) {
        return Result.ok({ status: 204, data: null })
      }
      if (response.status >= 200 && response.status < 300) {
        // 边界处运行时校验：若提供 zodSchema，则解析得到类型化的 T；
        // 否则保留 unknown，由调用方负责类型守卫。
        if (zodSchema) {
          try {
            const parsed: T = zodSchema.parse(response.data)
            return Result.ok({ status: response.status, data: parsed })
          } catch (error: unknown) {
            BGM.handleError(error, { context: 'httpRequest', showAlert: false })
            const errorMessage_ = error instanceof Error ? error.message : String(error)
            bgmLog(LOG_LEVELS.WARN, `[HTTP] 响应数据校验失败: ${errorMessage_}`)
            return Result.fail(
              new BgmError(`响应数据校验失败: ${errorMessage_}`, 'SCHEMA_VALIDATION_ERROR', {
                endpoint,
                status: response.status,
              }),
            )
          }
        }
        // TODO: 此处 unknown -> T 的单层断言仅为兼容未提供 zodSchema 的调用方。
        //       后续应要求所有调用方提供 zodSchema，从而完全移除此断言。
        return Result.ok({ status: response.status, data: response.data as T })
      }

      if (response.status === 429 && attempt < retries) {
        attempt += 1
        const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * 2 ** (attempt - 1)
        bgmLog(
          LOG_LEVELS.WARN,
          `API 限流 (429)，第 ${String(attempt)} 次重试，等待 ${String(delayMs)}ms`,
        )
        await sleep(delayMs)
      } else {
        const errorMessage = getErrorMessage(response.status)
        return Result.fail(new BgmError(errorMessage, 'HTTP_ERROR', { status: response.status }))
      }
    } catch (error: unknown) {
      // 取消导致的失败不重试，直接返回
      if (signal?.aborted) {
        return Result.fail(new BgmError('请求被取消', 'ABORTED'))
      }
      BGM.handleError(error, { context: 'httpRequest', showAlert: false })
      if (attempt < retries) {
        attempt += 1
        const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * 2 ** (attempt - 1)
        bgmLog(LOG_LEVELS.WARN, `网络错误，第 ${String(attempt)} 次重试，等待 ${String(delayMs)}ms`)
        await sleep(delayMs)
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return Result.fail(new BgmError(errorMessage, 'NETWORK_ERROR'))
      }
    }
  }

  return Result.fail(
    new BgmError('超过最大重试次数', 'MAX_RETRIES_EXCEEDED', { retries, endpoint }),
  )
}
/**
 * 执行单次 XHR 请求并返回响应
 *
 * 注意：此函数返回的 data 类型为 unknown，因为 XHR 响应体本质上是不可信的外部数据，
 * 无法在类型层面保证其结构。调用方（httpRequest）需通过 zodSchema 或类型守卫进行校验。
 */
function executeXhrRequest(
  url: string,
  options: {
    method: string
    body: string | null
    token?: string
    timeout: number
    onProgress?: (current: number, total: number) => void
    signal?: AbortSignal
  },
): Promise<{ status: number; xhr: XMLHttpRequest; data: unknown }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    bgmLog(LOG_LEVELS.INFO, `[HTTP] ========== 开始请求 ==========`)
    bgmLog(LOG_LEVELS.INFO, `[HTTP] URL: ${url}`)
    bgmLog(LOG_LEVELS.INFO, `[HTTP] 方法: ${options.method}`)
    bgmLog(LOG_LEVELS.INFO, `[HTTP] 超时: ${String(options.timeout)}ms`)

    if (options.token) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[HTTP] 请求头: Authorization: Bearer ${options.token.substring(0, 8)}...`,
      )
    }
    if (options.body) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[HTTP] 请求体: ${options.body.length > 200 ? `${options.body.substring(0, 200)}...` : options.body}`,
      )
    }

    const xhr = new XMLHttpRequest()
    xhr.open(options.method, url, true)
    xhr.timeout = options.timeout

    // AbortSignal 支持：已 aborted 立即 reject；否则监听 abort 事件
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new Error('请求被取消'))
        return
      }
      options.signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }

    // 设置请求头
    if (options.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${options.token}`)
    }
    if (options.body) {
      xhr.setRequestHeader('Content-Type', 'application/json')
      bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求头: Content-Type: application/json`)
    }

    // 响应处理
    xhr.onload = () => {
      const duration = Date.now() - startTime

      bgmLog(LOG_LEVELS.INFO, `[HTTP] ========== 请求完成 ==========`)
      bgmLog(LOG_LEVELS.INFO, `[HTTP] URL: ${url}`)
      bgmLog(LOG_LEVELS.INFO, `[HTTP] HTTP 状态码: ${String(xhr.status)} (${xhr.statusText})`)
      bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求耗时: ${String(duration)}ms`)

      if (xhr.getAllResponseHeaders()) {
        bgmLog(LOG_LEVELS.INFO, `[HTTP] 响应头: ${xhr.getAllResponseHeaders()}`)
      }

      // data 始终为 unknown：JSON.parse 的返回值或原始 responseText 均不可信，
      // 必须由上层 httpRequest 通过 zodSchema 校验后才能缩窄为具体类型。
      let data: unknown = null
      if (xhr.responseText && xhr.responseText.length > 0) {
        try {
          data = JSON.parse(xhr.responseText)
          bgmLog(
            LOG_LEVELS.INFO,
            `[HTTP] 响应数据: ${JSON.stringify(data).length > 500 ? `${JSON.stringify(data).substring(0, 500)}...` : JSON.stringify(data)}`,
          )
        } catch (error: unknown) {
          BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false })
          bgmLog(
            LOG_LEVELS.WARN,
            `[HTTP] 解析响应失败，返回原始文本: ${xhr.responseText.length > 200 ? `${xhr.responseText.substring(0, 200)}...` : xhr.responseText}`,
          )
          // responseText 是 string，可直接赋值给 unknown，无需任何断言
          data = xhr.responseText
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求成功`)
      } else {
        bgmLog(LOG_LEVELS.WARN, `[HTTP] 请求失败，状态码: ${String(xhr.status)}`)
      }

      resolve({ status: xhr.status, xhr, data })
    }

    // 错误处理
    xhr.onerror = () => {
      const duration = Date.now() - startTime
      bgmLog(LOG_LEVELS.ERROR, `[HTTP] 请求发生网络错误，URL: ${url}，耗时: ${String(duration)}ms`)
      reject(new Error(`网络请求失败: ${url}`))
    }

    xhr.ontimeout = () => {
      const duration = Date.now() - startTime
      bgmLog(LOG_LEVELS.WARN, `[HTTP] 请求超时，URL: ${url}，耗时: ${String(duration)}ms`)
      reject(new Error(`请求超时 (${String(options.timeout)}ms): ${url}`))
    }

    // 上传进度
    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          options.onProgress!(event.loaded, event.total)
          const progress = Math.round((event.loaded / event.total) * 100)
          bgmLog(
            LOG_LEVELS.INFO,
            `[HTTP] 上传进度: ${String(progress)}% (${String(event.loaded)}/${String(event.total)})`,
          )
        }
      }
    }

    // 发送请求
    try {
      bgmLog(LOG_LEVELS.INFO, `[HTTP] 正在发送请求...`)
      xhr.send(options.body)
    } catch (error: unknown) {
      BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false })
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[HTTP] 发送请求失败: ${errorMessage}`)
      reject(new Error(`发送请求失败: ${errorMessage}`))
    }
  })
}

// ========== 便捷方法 ==========

/**
 * GET 请求
 *
 * @deprecated 请使用 httpRequest 并提供 zodSchema 以确保类型安全
 * @example
 * // 推荐使用 httpRequest：
 * const result = await httpRequest<UserInfo>('/v0/me', {
 *   method: 'GET',
 *   token,
 *   zodSchema: userInfoSchema,
 * });
 */
export const httpGet = (endpoint: string, token?: string) =>
  httpRequest(endpoint, { method: 'GET', ...(token !== undefined && { token }) })

/**
 * POST 请求
 *
 * @deprecated 请使用 httpRequest 并提供 zodSchema 以确保类型安全
 * @example
 * // 推荐使用 httpRequest：
 * const result = await httpRequest<Collection>('/v0/users/123/collections', {
 *   method: 'POST',
 *   body: jsonBody,
 *   token,
 *   zodSchema: collectionSchema,
 * });
 */
export const httpPost = (endpoint: string, body: string, token?: string) =>
  httpRequest(endpoint, { method: 'POST', body, ...(token !== undefined && { token }) })

/**
 * PUT 请求
 *
 * @deprecated 请使用 httpRequest 并提供 zodSchema 以确保类型安全
 * @example
 * // 推荐使用 httpRequest：
 * const result = await httpRequest<Collection>('/v0/users/123/collections/456', {
 *   method: 'PUT',
 *   body: jsonBody,
 *   token,
 *   zodSchema: collectionSchema,
 * });
 */
export const httpPut = (endpoint: string, body: string, token?: string) =>
  httpRequest(endpoint, { method: 'PUT', body, ...(token !== undefined && { token }) })

/**
 * DELETE 请求
 *
 * @deprecated 请使用 httpRequest 并提供 zodSchema 以确保类型安全
 * @example
 * // 推荐使用 httpRequest：
 * const result = await httpRequest<null>('/v0/users/123/collections/456', {
 *   method: 'DELETE',
 *   token,
 * });
 */
export const httpDelete = (endpoint: string, token?: string) =>
  httpRequest(endpoint, { method: 'DELETE', ...(token !== undefined && { token }) })

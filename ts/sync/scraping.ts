/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版)
 */

import { BGM_CONFIG, LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/util/index.js'

/**
 * Token验证结果接口
 */
export interface TokenVerifyResult {
  /** 验证是否通过 */
  valid: boolean
  /** 验证消息 */
  message: string
  /** 用户ID（如果验证成功） */
  userId?: string
  /** 用户名（如果验证成功） */
  username?: string
}

/**
 * Bangumi用户数据接口
 */
export interface BangumiUserData {
  id: number
  username: string
  nickname?: string
  avatar?: {
    large: string
    medium: string
    small: string
  }
}

/**
 * API响应结构接口
 */
export interface ApiResponse<T = unknown> {
  data: T | null
  status: number
  message: string
}

/**
 * 收藏项接口
 */
export interface CollectionItem {
  subject_id: number
  type: number
  rate?: number
  tags?: string[]
  comment?: string
  ep_status?: number
  vol_status?: number
  updated_at?: string
  subject_type?: number
  subject?: {
    id: number
    name: string
    name_cn?: string
    type?: number
  }
}

/**
 * 收藏列表响应接口
 */
export interface CollectionListResponse {
  total?: number
  data?: CollectionItem[]
}

/**
 * 执行HTTP请求的通用Promise封装
 * @param xhr 已配置好的 XMLHttpRequest 对象
 * @param signal 可选 AbortSignal，用于取消请求
 */
function requestPromise(
  xhr: XMLHttpRequest,
  signal?: AbortSignal,
): Promise<{ status: number; data: unknown; responseText: string }> {
  const startTime = Date.now()
  if (!xhr.timeout) xhr.timeout = 30_000
  return new Promise((resolve, reject) => {
    // 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }

    xhr.onload = () => {
      const duration = Date.now() - startTime
      bgmLog(
        LOG_LEVELS.INFO,
        `[scraping] HTTP ${String(xhr.status)} (${xhr.statusText}), 耗时: ${String(duration)}ms`,
      )
      try {
        const responseData: unknown = xhr.responseText ? JSON.parse(xhr.responseText) : null
        resolve({ status: xhr.status, data: responseData, responseText: xhr.responseText })
      } catch {
        reject(new Error('解析响应失败'))
      }
    }
    xhr.onerror = () => {
      // 如果是 abort 导致的 onerror，归类为取消
      reject(new Error(signal?.aborted ? '请求被取消' : '网络错误'))
    }
    xhr.ontimeout = () => {
      reject(new Error('请求超时'))
    }
    xhr.send()
  })
}

function xhrGet(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ status: number; data: unknown }> {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.timeout = 30_000
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  return requestPromise(xhr, signal)
}

/**
 * 验证Bangumi API Token的有效性
 *
 * @async
 * @function verifyToken
 * @param {string} token - 待验证的API Token
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 * @returns {Promise<TokenVerifyResult>} 验证结果
 *
 * @description
 * 通过调用 /v0/me 接口验证Token是否有效。
 * 如果Token有效，会自动更新缓存中的用户信息。
 */
export async function verifyToken(token: string, signal?: AbortSignal): Promise<TokenVerifyResult> {
  const result: TokenVerifyResult = { valid: false, message: '' }

  if (!token) {
    result.message = 'Token 不能为空'
    return result
  }

  try {
    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`
    bgmLog(LOG_LEVELS.INFO, `[scraping/verifyToken] 验证 Token: ${apiUrl}`)

    const xhr = new XMLHttpRequest()
    xhr.open('GET', apiUrl, true)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')

    const response = await requestPromise(xhr, signal)
    const userData = response.data as BangumiUserData | null

    if (response.status === 200) {
      result.valid = true
      result.message = 'Token 有效'
      bgmLog(
        LOG_LEVELS.INFO,
        `[scraping/verifyToken] Token 验证成功，用户ID: ${String(userData?.id || '未知')}`,
      )
      if (userData) {
        result.userId = String(userData.id || '')
        result.username = userData.username || userData.nickname || ''
      }
    } else if (response.status === 401) {
      result.message = 'Token 无效或已过期'
      bgmLog(LOG_LEVELS.WARN, `[scraping/verifyToken] Token 无效或已过期`)
    } else {
      result.message = `验证失败 (HTTP ${String(response.status)})`
      bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] 验证失败，HTTP ${String(response.status)}`)
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : ''
    result.message = errMsg || '验证过程出错'
    bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] error: ${result.message}`)
  }

  return result
}

/**
 * 获取用户的收藏列表
 *
 * @async
 * @function fetchAllUserCollections
 * @param {string} token - API Token
 * @param {string} [userId] - 用户ID（可选，不提供则从Token自动获取）
 * @param {Object} [options] - 可选参数
 * @param {number} [options.limit=30] - 每页数量
 * @param {number} [options.maxTotal=1000] - 最大获取数量
 * @param {Function} [options.onProgress] - 进度回调
 * @returns {Promise<CollectionItem[]>} 收藏列表
 */
export async function fetchAllUserCollections(
  token: string,
  userId?: string,
  options?: {
    limit?: number
    maxTotal?: number
    type?: 'collect' | 'wish' | 'do' | null
    onProgress?: (page: number, total: number) => void
  },
): Promise<CollectionItem[]> {
  const limit = options?.limit || 30
  const maxTotal = options?.maxTotal || 1000

  const typeMap: Record<string, number> = { wish: 1, collect: 2, do: 3 }
  const typeNum = options?.type ? typeMap[options.type] : null

  if (!userId) {
    const verifyResult = await verifyToken(token)
    if (!verifyResult.valid) {
      bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] Token无效')
      return []
    }
    userId = verifyResult.userId
  }

  if (!userId) {
    bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] 无法获取用户ID')
    return []
  }

  const allCollections: CollectionItem[] = []
  let offset = 0
  let total = 0
  let retryCount = 0
  const MAX_RETRY_COUNT = BGM_CONFIG.MAX_RETRIES

  bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 开始获取用户 ${userId} 的收藏列表`)

  while (offset < maxTotal) {
    try {
      const typeParam = typeNum !== null ? `&type=${String(typeNum ?? '')}` : ''
      const url = `${BGM_CONFIG.API_BASE}/v0/users/${userId}/collections?limit=${String(limit)}&offset=${String(offset)}${typeParam}`
      const xhrResult = await xhrGet(url, token)

      if (xhrResult.status < 200 || xhrResult.status >= 300) {
        if (xhrResult.status === 429) {
          if (retryCount < MAX_RETRY_COUNT) {
            retryCount++
            const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * 2 ** (retryCount - 1)
            bgmLog(
              LOG_LEVELS.WARN,
              `[fetchAllUserCollections] API限流，第 ${String(retryCount)} 次重试，等待 ${String(delayMs)}ms...`,
            )
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          throw new Error(`HTTP 429：请求过于频繁，已超过最大重试次数`)
        }
        throw new Error(`HTTP ${String(xhrResult.status)}`)
      }

      // 成功请求后重置重试计数
      retryCount = 0

      const data = xhrResult.data as CollectionListResponse

      if (total === 0 && data.total) {
        total = Math.min(data.total, maxTotal)
        bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 收藏总数: ${String(total)}`)
      }

      if (data.data && Array.isArray(data.data)) {
        allCollections.push(...data.data)
        offset += data.data.length

        if (options?.onProgress) {
          options.onProgress(Math.ceil(offset / limit), Math.ceil(total / limit))
        }

        if (data.data.length < limit || offset >= total) {
          break
        }
      } else {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY))
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : undefined
      bgmLog(LOG_LEVELS.ERROR, `[fetchAllUserCollections] 请求失败: ${errMsg ?? ''}`)
      break
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[fetchAllUserCollections] 获取完成，共 ${String(allCollections.length)} 条`,
  )
  return allCollections
}

/**
 * 获取单个条目的收藏状态
 *
 * @async
 * @function fetchSubjectCollection
 * @param {string} token - API Token
 * @param {string} subjectId - 条目ID
 * @returns {Promise<ApiResponse>} API响应
 */
export async function fetchSubjectCollection(
  token: string,
  subjectId: string,
): Promise<ApiResponse> {
  const result: ApiResponse = { data: null, status: 0, message: '' }

  try {
    const url = `${BGM_CONFIG.API_BASE}/v0/users/-/collections/${subjectId}`
    const xhrResult = await xhrGet(url, token)

    result.status = xhrResult.status

    if (xhrResult.status >= 200 && xhrResult.status < 300) {
      result.data = xhrResult.data
      result.message = 'success'
    } else {
      result.message = `HTTP ${String(xhrResult.status)}`
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : ''
    result.message = errMsg || '请求失败'
    bgmLog(LOG_LEVELS.ERROR, `[fetchSubjectCollection] 请求失败: ${result.message}`)
  }

  return result
}

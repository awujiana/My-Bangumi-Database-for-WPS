/**
 * Excel→Bangumi 同步模块 - 章节标记
 * @module sync/exceltobangumi/chapterMarker
 * @description 获取条目章节列表并标记前 N 集为已观看。
 */
import { BGM_CONFIG, LOG_LEVELS } from '../../core/constants.js'
import { bgmLog } from '../../tools/util/index.js'

import { bgmRequestSync } from './api.js'

/**
 * 获取条目的所有章节 ID（按集号排序）
 * @param sid 条目 ID
 * @param token API Token
 * @param signal 可选 AbortSignal，用于取消请求
 */
export async function fetchEpisodeIds(
  sid: string | number,
  token: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const url = `${BGM_CONFIG.API_BASE}/v0/episodes?subject_id=${String(sid)}&limit=1000`
  return new Promise((resolve, reject) => {
    // 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.timeout = 30_000
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            data?: { id: number; sort: number }[]
          }
          const episodes = data.data ?? []
          episodes.sort((a, b) => (a.sort || 0) - (b.sort || 0))
          resolve(episodes.map((ep) => ep.id))
        } catch {
          reject(new Error('解析章节数据失败'))
        }
      } else {
        reject(new Error(`HTTP ${String(xhr.status)}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => {
      // 如果是 abort 导致的 onerror，归类为取消
      reject(new Error(signal?.aborted ? '请求被取消' : '网络错误'))
    }
    xhr.ontimeout = () => {
      reject(new Error('请求章节数据超时（30s），可能网络受限或被墙'))
    }
    xhr.send()
  })
}

/**
 * 标记前 N 集为已完成
 * @param sid 条目 ID
 * @param epCount 集数
 * @param token API Token
 * @param signal 可选 AbortSignal，用于取消请求
 */
export async function markEpisodesComplete(
  sid: string | number,
  epCount: number,
  token: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; message: string }> {
  try {
    const allIds = await fetchEpisodeIds(sid, token, signal)
    if (allIds.length === 0) {
      return { success: false, message: '该条目没有章节数据' }
    }
    const targetIds = allIds.slice(0, epCount)
    if (targetIds.length === 0) {
      return { success: false, message: '没有需要标记的章节' }
    }
    const body = JSON.stringify({ episode_id: targetIds, type: 2 })
    const result = await bgmRequestSync(
      'PATCH',
      `/v0/users/-/collections/${String(sid)}/episodes`,
      body,
      token,
      signal,
    )
    if (result.code >= 200 && result.code < 300) {
      return { success: true, message: `已标记前 ${String(targetIds.length)} 集为已完成` }
    }
    return { success: false, message: result.message }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[chapterMarker] markEpisodesComplete 异常: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { success: false, message: error instanceof Error ? error.message : '未知错误' }
  }
}

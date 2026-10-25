/**
 * Bangumi `GET /v0/me`（当前登录用户资料）的唯一 XHR 实现。
 *
 * @module tools/util/bgm-me
 * @description
 * §5.6 C2 收敛：原先 `GET /v0/me` 有两份 XHR 实现——本文件的 `fetchBgmMe`
 * （读「已存 token」）与 `sync/scraping.ts` 的 `verifyToken`（验证「调用方显式
 * 传入的 token」，可能是尚未保存的测试 Token）。签名语义不同，但管道逐字重复。
 *
 * 分层：
 * - `requestBgmMeRaw`：**管道核心**（开请求 / 收响应 / 失败分类），不打日志、
 *   超时可配（`fetchBgmMe` 15s；`verifyToken` 沿用其 `requestPromise` 的 30s）；
 * - `fetchBgmMeWithToken` / `fetchBgmMe`：`BgmMeResult` 判别联合映射 +
 *   `[fetchBgmMe]` 日志；
 * - `verifyToken` 直接用 `requestBgmMeRaw` 并显式传 token，自行映射为
 *   `TokenVerifyResult`（错误文案与其旧 `requestPromise` 的 Error.message 逐字一致）。
 *
 * 循环依赖：`bgmLog` / `loadBgToken` 经 `./index.js`（barrel）导入，**仅在函数体
 * 内使用**，运行时安全（先例：同目录 `sheet.ts` 的同类注释）。
 */

import { BGM_CONFIG, LOG_LEVELS } from '../../core/constants.js'
import type { BGMUserInfo } from '../../core/types.js'
// 循环依赖：仅在函数体内使用 bgmLog / loadBgToken，运行时安全（先例：sheet.ts）
import { bgmLog, loadBgToken } from './index.js'

/** `/v0/me` 请求超时（毫秒）：`fetchBgmMe` 用 15s 快速感知网络问题 */
const BGM_ME_TIMEOUT = 15_000

/**
 * `fetchBgmMe` 的判别联合结果。
 *
 * 刻意**带 HTTP 状态码**、并把 `timeout` 单列，而不是压成
 * `'network' | 'http' | 'parse' | 'aborted'` 这种粗分类：调用方的分档需求不同 ——
 * `testTokenForRibbon` 要按 401 与其它状态码给不同文案、且超时与网络错误的文案不同，
 * `_fetchBgmUserInfo` 只要粗分类。压平会让前者丢信息（这也是两处一直没能合并的原因）。
 */
export type BgmMeResult =
  | { kind: 'ok'; user: BGMUserInfo; status: number }
  | { kind: 'http'; status: number }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'parse' }
  | { kind: 'aborted' }
  | { kind: 'no-token' }

/**
 * 管道核心的结果（无映射、无日志）。
 *
 * 失败分类与 `sync/scraping.ts` 的 `requestPromise` 逐字对齐——
 * `verifyToken` 的错误文案（请求被取消 / 网络错误 / 请求超时）由该分类一一映射。
 * **不含 parse**：JSON 解析交给各映射层（`parseBgmMePayload` 会做字段校验，
 * 归入 `fetchBgmMe` 的 `parse` 分支；`verifyToken` 在自己的映射里 try/catch）。
 */
export type BgmMeRawResult =
  | { kind: 'ok'; status: 200; responseText: string }
  | { kind: 'http'; status: number }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'aborted' }

/** `requestBgmMeRaw` 选项 */
export interface BgmMeRawOptions {
  /** 超时毫秒数（`fetchBgmMe` 15s；`verifyToken` 30s，与原 requestPromise 默认一致） */
  timeout: number
  /** 可选 AbortSignal；已 aborted 时立即返回 `{ kind: 'aborted' }`，不发请求 */
  signal?: AbortSignal | undefined
}

/**
 * `GET /v0/me` 管道核心：显式 token + 可配超时，返回原始结果（调用方各自映射）。
 * **不打日志**——两个调用方的日志文案与级别不同，由映射层各自产出。
 *
 * AbortSignal 监听器在请求结束（load / error / timeout）时移除——只 add 不 remove
 * 会在同一 signal 被反复取消 / 重试时持续累积（修法同 `sync/scraping.ts` 的
 * `requestPromise`）。
 */
export function requestBgmMeRaw(token: string, options: BgmMeRawOptions): Promise<BgmMeRawResult> {
  const { timeout, signal } = options
  return new Promise<BgmMeRawResult>((resolve) => {
    if (signal?.aborted === true) {
      resolve({ kind: 'aborted' })
      return
    }

    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`
    const xhr = new XMLHttpRequest()
    xhr.open('GET', apiUrl, true)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.timeout = timeout

    let abortHandler: (() => void) | null = null
    const removeAbortHandler = (): void => {
      if (!(abortHandler && signal)) {
        return
      }

      signal.removeEventListener('abort', abortHandler)
      abortHandler = null
    }
    if (signal) {
      abortHandler = (): void => {
        xhr.abort()
      }
      signal.addEventListener('abort', abortHandler)
    }

    xhr.addEventListener('load', (): void => {
      removeAbortHandler()
      if (xhr.status !== 200) {
        resolve({ kind: 'http', status: xhr.status })
        return
      }
      resolve({ kind: 'ok', status: 200, responseText: xhr.responseText })
    })

    xhr.addEventListener('error', (): void => {
      removeAbortHandler()
      // 如果是 abort 导致的 onerror，归类为 aborted
      resolve(signal?.aborted === true ? { kind: 'aborted' } : { kind: 'network' })
    })

    xhr.ontimeout = (): void => {
      removeAbortHandler()
      resolve({ kind: 'timeout' })
    }

    xhr.send()
  })
}

/**
 * 解析 `GET /v0/me` 的响应体为 {@link BGMUserInfo}。
 *
 * 抽成独立纯函数有两个好处：① 把 `fetchBgmMe` 的 try 块复杂度压到 lint 阈值内；
 * ② 字段回退链（nickname → username → user_name → name）与头像 URL 的构造/清洗
 * 只此一份，便于单测直接覆盖。
 *
 * @param responseText XHR 的原始响应文本
 * @throws JSON.parse 失败或字段类型异常时抛出（调用方归类为 parse 错误）
 */
function parseBgmMePayload(responseText: string): BGMUserInfo {
  const data = JSON.parse(responseText) as {
    id?: string | number
    user_id?: string | number
    username?: string
    user_name?: string
    name?: string
    nickname?: string
    avatar?: { large?: string; medium?: string; small?: string }
  }
  const userId = String(data.id ?? data.user_id ?? '')
  // BGM API v0 返回的用户名字段是 nickname，username 是用户ID
  const username = (data.nickname || data.username || data.user_name || data.name) ?? ''

  // 从 API 响应中提取头像 URL，并清理可能存在的反引号包裹
  const rawAvatarUrl = (data.avatar?.large || data.avatar?.medium || data.avatar?.small) ?? ''
  const cleanAvatarUrl = rawAvatarUrl ? rawAvatarUrl.replace(/`/g, '').trim() : ''

  // 优先使用 API 返回的头像 URL，若不存在则回退到构造的 URL
  const avatarUrl =
    cleanAvatarUrl ||
    (username
      ? `${BGM_CONFIG.API_BASE}/v0/users/${encodeURIComponent(username)}/avatar?type=large`
      : undefined)

  return { id: userId, username, avatarUrl }
}

/**
 * 用**调用方显式传入的 token** 请求 `GET /v0/me`，映射为 {@link BgmMeResult}。
 * 日志文案与旧 `fetchBgmMe` 逐字一致（`[fetchBgmMe]` 前缀）。
 */
export async function fetchBgmMeWithToken(
  token: string,
  signal?: AbortSignal,
): Promise<BgmMeResult> {
  const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`
  bgmLog(LOG_LEVELS.INFO, `[fetchBgmMe] API 路由: ${apiUrl}`)

  const raw = await requestBgmMeRaw(token, { timeout: BGM_ME_TIMEOUT, signal })

  if (raw.kind === 'ok') {
    try {
      const user = parseBgmMePayload(raw.responseText)
      bgmLog(
        LOG_LEVELS.INFO,
        `[fetchBgmMe] 获取用户信息成功: userId=${user.id}, username=${user.username}, hasAvatar=${String(user.avatarUrl !== undefined)}`,
      )
      return { kind: 'ok', user, status: 200 }
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.ERROR, `[fetchBgmMe] 解析响应失败: ${(error as Error).message}`)
      return { kind: 'parse' }
    }
  }
  if (raw.kind === 'http') {
    bgmLog(LOG_LEVELS.WARN, `[fetchBgmMe] 获取用户信息失败，HTTP 状态码: ${String(raw.status)}`)
    return { kind: 'http', status: raw.status }
  }
  if (raw.kind === 'aborted') {
    bgmLog(LOG_LEVELS.INFO, '[fetchBgmMe] 请求被取消')
    return { kind: 'aborted' }
  }
  if (raw.kind === 'network') {
    bgmLog(LOG_LEVELS.WARN, `[fetchBgmMe] 网络错误：无法连接到 ${apiUrl}（可能被 GFW 墙）`)
    return { kind: 'network' }
  }
  bgmLog(LOG_LEVELS.WARN, '[fetchBgmMe] 请求超时（15s）：可能网络受限或被墙')
  return { kind: 'timeout' }
}

/**
 * 请求 Bangumi 当前登录用户资料（`GET /v0/me`）。
 *
 * **纯请求 + 解析，无副作用** —— 不落库、不缓存头像、不弹窗、不写 PluginStorage；
 * 这些由调用方按需处理（`_fetchBgmUserInfo` 落库 + 缓存头像 + 持久化，
 * `testTokenForRibbon` 只落库 + 通知 Token 更新）。
 *
 * @param signal 可选 AbortSignal；已 aborted 时立即 resolve `{ kind: 'aborted' }`
 * @returns 带 HTTP 状态码的判别联合（见 {@link BgmMeResult}）
 */
export function fetchBgmMe(signal?: AbortSignal): Promise<BgmMeResult> {
  const token = loadBgToken()
  if (!token) {
    return Promise.resolve({ kind: 'no-token' })
  }
  return fetchBgmMeWithToken(token, signal)
}

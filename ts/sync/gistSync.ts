/**
 * @fileoverview GitHub Gist 同步源模块
 * @module sync/gistSync
 * @description Gist 同步源实现，URL 模板：
 *              https://api.github.com/gists/{gist_id}
 *
 *              Gist API 响应结构（节选）：
 *              {
 *                "id": "...",
 *                "description": "...",
 *                "files": {
 *                  "data1.jsonl": { "content": "..." },
 *                  "data2.jsonl": { "content": "..." }
 *                },
 *                ...
 *              }
 *
 *              本模块从响应中提取所有 files[*].content 字段，
 *              按文件名字典序拼接为单一 JSONL 文本，再复用 githubSyncDiff.ts
 *              的 parseJsonl 解析为 GithubRemoteEntry[]。
 *
 *              与 GitHub/GitLab/Gitee 远程源的差异：
 *              - 不需要 owner/repo/branch/path 字段，仅需 gist_id
 *              - 调用 GitHub Gist REST API（非 raw 文件直链），返回 JSON 元数据
 *              - 通过 extractGistContent 从 JSON 响应中提取文本内容
 *              - 配置校验使用 isGistConfigured()，不复用 isGithubConfigComplete()
 *
 *              注意：未认证的 Gist API 限流为 60 次/小时/IP（与 GitHub Raw 一致）。
 *              若需更高配额，可在后续扩展中通过请求头附加 token。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'
import { bgmLog } from '../tools/util.js'

import { getGistId, isGistConfigured } from './githubConfig.js'
import { parseJsonl } from './githubSyncDiff.js'
import type { GithubRemoteEntry } from './githubSyncDiff.js'
import type { SyncSource } from './SyncSource.js'
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）

/** HTTP 请求超时（毫秒），与 githubSync 保持一致 */
const REQUEST_TIMEOUT_MS = 30_000

/** Gist API 基础 URL（末尾含斜杠，便于与 gistId 拼接） */
const GIST_API_BASE = 'https://api.github.com/gists/'

/**
 * 构造 Gist API URL
 *
 * 格式：https://api.github.com/gists/{gistId}
 *
 * @param gistId Gist ID 字符串（Gist URL 末段，如 https://gist.github.com/user/{gistId} 的末段）
 * @returns 完整 Gist API URL
 */
export function buildGistApiUrl(gistId: string): string {
  return `${GIST_API_BASE}${gistId}`
}

// ========== 类型守卫：Gist API 响应解析 ==========
//
// Gist API 响应本质上是不可信的外部 JSON 数据，必须通过类型守卫逐步缩窄类型，
// 不能直接 as 强断言为具体结构（避免在异常数据下静默通过）。

/** Gist 单个文件对象（仅关心 content 字段） */
interface GistFile {
  /** 文件文本内容；新建空文件或二进制文件可能缺失此字段 */
  content?: string
}

/** Gist API 响应的最小子集（仅含本模块所需字段） */
interface GistApiResponse {
  /** Gist 文件映射：文件名 → 文件对象 */
  files: Record<string, GistFile>
}

/**
 * 类型守卫：判断未知值是否为 GistFile
 *
 * 规则：
 * - 必须是非 null 对象
 * - content 字段可选；存在时必须是 string 或 undefined
 *   （undefined 视为缺失，由 extractGistContent 跳过；
 *    非法类型如 number/boolean/object 则拒绝整个响应）
 */
function isGistFile(value: unknown): value is GistFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { content?: unknown }
  if ('content' in v) {
    const c = v.content
    // content 必须是 string 或 undefined（缺失）；其他类型拒绝
    if (c !== undefined && typeof c !== 'string') return false
  }
  return true
}

/**
 * 类型守卫：判断未知值是否为 GistApiResponse
 *
 * 规则：
 * - 必须是非 null 对象
 * - 必须有 files 字段且为非 null 对象
 * - files 的所有属性值必须通过 isGistFile 校验
 */
function isGistApiResponse(value: unknown): value is GistApiResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { files?: unknown }
  if (!('files' in v)) return false
  const { files } = v
  if (typeof files !== 'object' || files === null) return false
  // 遍历校验所有文件对象
  for (const fileValue of Object.values(files as Record<string, unknown>)) {
    if (!isGistFile(fileValue)) return false
  }
  return true
}

/**
 * 从 Gist API 响应中提取并拼接所有 files[*].content
 *
 * 行为约定：
 * - null/undefined 输入 → 返回空字符串
 * - 缺失 files 字段或 files 不是对象 → 返回空字符串
 * - 单文件：返回该文件的 content（若 content 缺失则跳过，返回空串）
 * - 多文件：按文件名字典序拼接所有非空 content，用 '\n' 分隔
 * - 单文件 content 为空字符串：跳过（不参与拼接）
 *
 * 多文件分隔符选择 '\n'：
 * - JSONL 每行是独立 JSON 对象，'\n' 是合法行分隔符
 * - 拼接后 parseJsonl 会按行分割，逐行 JSON.parse
 * - 单文件 content 内部可能本身就包含多行 JSONL，无需额外处理
 *
 * @param apiResponse Gist API 响应（unknown 类型，需通过类型守卫缩窄）
 * @returns 拼接后的 JSONL 文本
 */
export function extractGistContent(apiResponse: unknown): string {
  // null/undefined 输入：返回空字符串
  if (apiResponse === null || apiResponse === undefined) {
    return ''
  }
  // 类型守卫缩窄：必须通过 isGistApiResponse
  if (!isGistApiResponse(apiResponse)) {
    return ''
  }

  // 收集所有非空 content
  const contents: string[] = []
  // 按文件名字典序遍历，保证拼接顺序确定（便于测试与可重现性）
  const fileNames = Object.keys(apiResponse.files).sort()
  for (const fileName of fileNames) {
    const file = apiResponse.files[fileName]
    if (!file) continue
    // content 缺失或空字符串 → 跳过
    if (file.content === undefined || file.content.length === 0) {
      continue
    }
    contents.push(file.content)
  }

  if (contents.length === 0) {
    return ''
  }
  if (contents.length === 1) {
    return contents[0] ?? ''
  }
  // 多文件用 '\n' 分隔（JSONL 行分隔符）
  return contents.join('\n')
}

/**
 * 从 Gist API 下载并解析 JSONL 条目
 *
 * 流程：
 * 1. 读取 gist_id 配置，校验非空
 * 2. 构造 URL：https://api.github.com/gists/{gist_id}
 * 3. XHR GET 请求（30s 超时 + AbortSignal 支持）
 * 4. JSON.parse 响应文本得到 unknown
 * 5. 通过 extractGistContent 提取并拼接 files[*].content
 * 6. 复用 parseJsonl 解析拼接后的 JSONL 文本
 *
 * 注意：本模块使用原生 XHR 而非 httpRequest，因 httpRequest 会自动拼接
 * BGM_CONFIG.API_BASE 前缀且 validateEndpoint 拒绝 'http' 开头的完整 URL，
 * 无法直接用于 Gist API。与 githubSync/gitlabSync/giteeSync 保持一致。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGistJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
  return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
    // 1. 读取并校验 gist_id 配置
    const gistId = getGistId()
    if (!gistId) {
      reject(new Error('Gist ID 未配置，请在面板中设置 gist_id'))
      return
    }

    // 2. 构造 URL
    const url = buildGistApiUrl(gistId)

    // 3. 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }

    bgmLog(LOG_LEVELS.INFO, `[gistSync] 开始下载: ${url}`)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.timeout = REQUEST_TIMEOUT_MS
    xhr.setRequestHeader('Accept', 'application/vnd.github+json')

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }

    xhr.onload = (): void => {
      if (xhr.status === 200) {
        try {
          // 4. JSON.parse 响应文本得到 unknown
          const apiResponse: unknown = JSON.parse(xhr.responseText)
          // 5. 通过 extractGistContent 提取并拼接 files[*].content
          const content = extractGistContent(apiResponse)
          if (!content) {
            bgmLog(
              LOG_LEVELS.WARN,
              `[gistSync] Gist 响应中未提取到任何文件内容（files 为空或 content 缺失）`,
            )
            resolve([])
            return
          }
          // 6. 复用 parseJsonl 解析拼接后的 JSONL 文本
          const { entries, errors } = parseJsonl(content)
          if (entries.length === 0 && errors.length > 0) {
            reject(
              new Error(
                `JSONL 解析失败：${String(errors.length)} 行全部非法。` +
                  `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
              ),
            )
            return
          }
          if (errors.length > 0) {
            bgmLog(
              LOG_LEVELS.WARN,
              `[gistSync] JSONL 解析完成：${String(entries.length)} 条合法，${String(errors.length)} 行非法（已跳过）。` +
                `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
            )
          } else {
            bgmLog(LOG_LEVELS.INFO, `[gistSync] 下载成功：${String(entries.length)} 条记录`)
          }
          resolve(entries)
        } catch (error: unknown) {
          reject(
            new Error(
              `Gist 响应解析失败: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        }
      } else if (xhr.status === 404) {
        reject(new Error(`Gist 不存在（404）：${url}，请检查 gist_id 配置`))
      } else if (xhr.status === 403) {
        reject(
          new Error(
            `访问被拒（403）：可能是私有 Gist 或触发 GitHub API 限流（未认证 60次/小时/IP）`,
          ),
        )
      } else {
        reject(new Error(`HTTP 错误 ${String(xhr.status)}: ${xhr.statusText}`))
      }
    }

    xhr.onerror = (): void => {
      // 如果是 abort 导致的 onerror，归类为取消
      if (signal?.aborted) {
        reject(new Error('请求被取消'))
        return
      }
      reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`))
    }

    xhr.ontimeout = (): void => {
      reject(new Error(`请求超时（${String(REQUEST_TIMEOUT_MS)}ms）：${url}`))
    }

    xhr.send()
  })
}

// ========== SyncSource 接口实现 ==========

/**
 * Gist 同步源实现
 *
 * 包装 fetchGistJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 *
 * 与远程源（GitHub/GitLab/Gitee）的关键差异：
 *   1. validateConfig 校验 gist_id 非空（不要求 owner/repo/branch/path）
 *   2. fetchRemoteEntries 调用 Gist API（非 raw 文件直链），
 *      从 files[*].content 提取 JSONL 文本
 *   3. 配置存储使用独立的 gistId 字段（不复用 path）
 */
export class GistSyncSource implements SyncSource {
  /** 数据源类型标识 */
  getSourceType(): string {
    return 'gist'
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return 'Gist'
  }

  /**
   * 获取远程条目（委托给 fetchGistJson）
   * @param signal 可选的 AbortSignal
   */
  async fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
    return fetchGistJson(signal)
  }

  /**
   * 校验配置是否完整可用
   *
   * Gist 源仅需 gist_id 字段非空，不需要 owner/repo/branch/path。
   *
   * @returns gist_id 非空返回 Result.ok(undefined)，否则返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!isGistConfigured()) {
      return Result.failVoid(
        new BgmError(
          'Gist ID 未配置，请在面板的 Gist ID 字段填写 GitHub Gist ID',
          'CONFIG_INCOMPLETE',
        ),
      )
    }
    return Result.okVoid()
  }
}

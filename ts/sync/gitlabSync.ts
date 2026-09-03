/**
 * @fileoverview GitLab 仓库增量同步模块
 * @module sync/gitlabSync
 * @description GitLab 同步源实现，URL 模板：
 *              https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              注意：GitLab Raw URL 使用 `/-/raw/` 段（含三段横线），
 *              与 GitHub 的 `/raw/` 不同。例如：
 *                GitHub: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *                GitLab: https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              复用 githubConfig 的 owner/repo/branch/path 字段（与 GitHub 共享配置 UI），
 *              复用 githubSyncDiff.ts 的 parseJsonl / isGithubRemoteEntry 解析逻辑，
 *              不重复解析实现。
 *
 * 数据格式（远程 JSONL 文件，每行一个 JSON 对象）与 GitHub 一致：
 *   { "sid": "12345", "name": "...", "updatedAt": "2026-07-21",
 *     "date": "2024-01-01", "meta_tags": ["标签1","标签2"], "nsfw": false,
 *     "话数": "12", "播放结束": "...", "动画制作公司": "...", ... }
 *
 * url 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'
import { bgmLog } from '../tools/utility.js'

import { getGithubConfig, isGithubConfigComplete } from './githubConfig.js'
import { parseJsonl } from './githubSyncDiff.js'
import type { GithubRemoteEntry } from './githubSyncDiff.js'
import type { SyncSource } from './SyncSource.js'
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）

/** HTTP 请求超时（毫秒），与 githubSync 保持一致 */
const REQUEST_TIMEOUT_MS = 30_000

/** 默认分支名（与 githubConfig 默认值一致） */
const DEFAULT_BRANCH = 'main'

/**
 * 构造 GitLab Raw 文件下载 URL
 *
 * 格式：https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 * 关键差异：GitLab 使用 `/-/raw/` 段（含三段横线），不同于 GitHub 的 `/raw/`。
 *
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildGitlabRawUrl(): string {
  const config = getGithubConfig()
  if (!isGithubConfigComplete()) {
    throw new Error('GitLab 仓库配置不完整，请在面板中设置 owner/repo/path')
  }
  const branch = config.branch || DEFAULT_BRANCH
  return `https://gitlab.com/${config.owner}/${config.repo}/-/raw/${branch}/${config.path}`
}

/**
 * 从 GitLab Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式与 GitHub 同步源一致：每行一个独立的 JSON 对象。
 * 解析复用 githubSyncDiff.ts 的 parseJsonl，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGitlabJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
  return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
    let url: string
    try {
      url = buildGitlabRawUrl()
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    // 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }

    bgmLog(LOG_LEVELS.INFO, `[gitlabSync] 开始下载: ${url}`)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.timeout = REQUEST_TIMEOUT_MS
    xhr.setRequestHeader('Accept', 'application/json')

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }

    xhr.onload = (): void => {
      if (xhr.status === 200) {
        try {
          const { entries, errors } = parseJsonl(xhr.responseText)
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
              `[gitlabSync] JSONL 解析完成：${String(entries.length)} 条合法，${String(errors.length)} 行非法（已跳过）。` +
                `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
            )
          } else {
            bgmLog(LOG_LEVELS.INFO, `[gitlabSync] 下载成功：${String(entries.length)} 条记录`)
          }
          resolve(entries)
        } catch (error: unknown) {
          reject(
            new Error(`JSONL 解析失败: ${error instanceof Error ? error.message : String(error)}`),
          )
        }
      } else if (xhr.status === 404) {
        reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`))
      } else if (xhr.status === 403) {
        reject(new Error(`访问被拒（403）：可能是私有仓库或触发 GitLab 限流`))
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
 * GitLab 同步源实现
 *
 * 包装 fetchGitlabJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 与 GithubSyncSource 行为一致：
 * 1. validateConfig() 在下载前校验配置完整性（复用 githubConfig）
 * 2. fetchRemoteEntries() 委托给 fetchGitlabJson，仅 URL 构造不同
 */
export class GitlabSyncSource implements SyncSource {
  /** 数据源类型标识 */
  getSourceType(): string {
    return 'gitlab'
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return 'GitLab'
  }

  /**
   * 获取远程条目（委托给 fetchGitlabJson）
   * @param signal 可选的 AbortSignal
   */
  async fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
    return fetchGitlabJson(signal)
  }

  /**
   * 校验配置是否完整可用
   * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!isGithubConfigComplete()) {
      return Result.failVoid(
        new BgmError('GitLab 仓库配置不完整，请填写 owner/repo/branch/path', 'CONFIG_INCOMPLETE'),
      )
    }
    return Result.okVoid()
  }
}

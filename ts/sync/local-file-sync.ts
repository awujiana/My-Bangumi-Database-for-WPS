/**
 * @fileoverview 本地文件同步源模块
 * @module sync/localFileSync
 * @description 通过 WPS 文件对话框或路径输入选择本地 .jsonl/.json 文件，
 *              读取内容并复用 githubSyncDiff.ts 的 parseJsonl 解析逻辑。
 *
 *              与远程源（GitHub/GitLab/Gitee）的差异：
 *              - 不依赖网络请求，读取本地文件系统
 *              - 不需要 owner/repo/branch 配置，仅需 path 字段（文件绝对路径）
 *              - 复用 githubConfig 的 path 字段存储本地文件路径（避免引入独立存储）
 *              - 复用 parseJsonl / isGithubRemoteEntry 解析逻辑，不重复实现
 *
 * 数据格式（与 GitHub 同步源一致）：
 *   每行一个独立的 JSON 对象（JSONL 格式），或单行 JSON 数组（.json 文件）
 *   非法行不中断整体解析，会被收集到 errors 中跳过。
 *
 * WPS 文件 API 探索结论：
 *   ts/tools/wps.ts 当前未导出文件读取 API。
 *   本模块通过 XMLHttpRequest + file:// 协议读取本地文件（WPS 加载项环境支持），
 *   同时支持通过 WPS Application.GetOpenFilename 弹出文件选择对话框（在 UI 层调用）。
 *   测试环境通过 vi.mock 替换 readLocalFileContent 实现以隔离 XHR。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'
import { bgmLog } from '../tools/utility.js'

import { getGithubConfig } from './github-config.js'
import { parseJsonl } from './github-sync-diff.js'
import type { GithubRemoteEntry } from './github-sync-diff.js'
import type { SyncSource } from './sync-source.js'
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）

/** 文件读取超时（毫秒） */
const FILE_READ_TIMEOUT_MS = 15_000

/**
 * 读取本地文件内容
 *
 * 实现策略：通过 XMLHttpRequest + file:// 协议读取本地文件。
 * WPS 加载项环境运行在内置浏览器控件中，允许 file:// 协议访问本地文件系统。
 *
 * 路径规范化：
 *   - Windows 路径（如 `C:\Users\foo\data.jsonl`）转换为 `file:///C:/Users/foo/data.jsonl`
 *   - 相对路径或无盘符路径按当前工作目录解析，可能失败
 *   - 已有的 `file://` 前缀保持不变
 *
 * @param filePath 文件绝对路径（Windows 路径或 file:// URL）
 * @returns Promise 解析为文件内容字符串
 * @throws 路径为空、读取超时、文件不存在或权限不足时抛出 Error
 */
export function readLocalFileContent(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      reject(new Error('本地文件路径不能为空'))
      return
    }

    const trimmedPath = filePath.trim()

    // 路径转 file:// URL
    let fileUrl: string
    if (trimmedPath.toLowerCase().startsWith('file://')) {
      fileUrl = trimmedPath
    } else {
      // Windows 绝对路径：C:\xxx → file:///C:/xxx
      // 反斜杠统一转为正斜杠（file:// URL 规范）
      const normalized = trimmedPath.replace(/\\/g, '/')
      fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
    }

    bgmLog(LOG_LEVELS.INFO, `[localFileSync] 开始读取本地文件: ${filePath}`)

    const xhr = new XMLHttpRequest()
    xhr.open('GET', fileUrl, true)
    xhr.timeout = FILE_READ_TIMEOUT_MS
    xhr.setRequestHeader('Accept', 'application/json,text/plain,*/*')

    xhr.addEventListener('load', (): void => {
      // file:// 协议下 status 通常为 0（成功）或 200
      if (xhr.status === 0 || xhr.status === 200) {
        bgmLog(
          LOG_LEVELS.INFO,
          `[localFileSync] 文件读取成功: ${filePath}（${String(xhr.responseText.length)} 字符）`,
        )
        resolve(xhr.responseText)
        return
      }
      reject(new Error(`读取文件失败（HTTP ${String(xhr.status)}）：${filePath}`))
    })

    xhr.addEventListener('error', (): void => {
      reject(new Error(`无法读取文件：${filePath}（路径错误或权限不足）`))
    })

    xhr.ontimeout = (): void => {
      reject(new Error(`读取文件超时（${String(FILE_READ_TIMEOUT_MS)}ms）：${filePath}`))
    }

    xhr.send()
  })
}

/**
 * 获取本地文件路径（从 githubConfig.path 字段读取）
 *
 * 复用 githubConfig.path 字段存储本地文件路径，避免引入独立的本地文件配置存储。
 * UI 层（panel.html）在 sourceType === 'local' 时把 #githubPath 输入框作为文件路径输入。
 *
 * @returns 文件路径字符串，未配置时返回空字符串
 */
export function getLocalFilePath(): string {
  const config = getGithubConfig()
  return config.path
}

/**
 * 校验本地文件路径是否可用
 *
 * 与远程源不同：本地文件仅需 path 字段，不需要 owner/repo/branch。
 * 因此不使用 isGithubConfigComplete（其要求 owner/repo/path 均非空），
 * 而是单独校验 path 非空。
 *
 * @returns 路径有效返回 true，否则返回 false
 */
export function isLocalFileConfigured(): boolean {
  return getLocalFilePath().length > 0
}

// ========== SyncSource 接口实现 ==========

/**
 * 本地文件同步源实现
 *
 * 包装 readLocalFileContent + parseJsonl 为 SyncSource 接口实现，
 * 供 syncSourceRegistry 注册与调度。
 *
 * 与远程源的关键差异：
 *   1. validateConfig 仅校验 path 字段（不需要 owner/repo/branch）
 *   2. fetchRemoteEntries 不发起 HTTP 请求，直接读取本地文件
 *   3. AbortSignal 支持在文件读取前与解析前检查 signal.aborted 状态
 *      （XHR 的 abort 由 signal 监听器触发，行为与远程源一致）
 */
export class LocalFileSyncSource implements SyncSource {
  /** 数据源类型标识 */
  getSourceType(): string {
    return 'local'
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return '本地文件'
  }

  /**
   * 获取远程条目（读取本地文件并解析为 JSONL）
   *
   * @param signal 可选的 AbortSignal，用于取消请求
   * @returns 解析后的远程条目数组
   * @throws 文件路径未配置、文件读取失败、解析失败时抛出 Error
   */
  async fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
    // 1. 在发起请求前检查 signal.aborted，支持取消
    if (signal?.aborted) {
      throw new Error('请求被取消')
    }

    const filePath = getLocalFilePath()
    if (!filePath) {
      throw new Error('本地文件路径未配置，请在面板的"文件路径"字段填写或选择文件')
    }

    // 2. 读取文件内容
    const content = await readLocalFileContent(filePath)

    // 3. 读取完成后、解析前再次检查 signal.aborted
    if (signal?.aborted) {
      throw new Error('请求被取消')
    }

    // 4. 复用 parseJsonl 解析内容（与 GitHub/GitLab/Gitee 一致）
    bgmLog(LOG_LEVELS.INFO, `[localFileSync] 开始解析文件内容: ${filePath}`)
    const { entries, errors } = parseJsonl(content)

    if (entries.length === 0 && errors.length > 0) {
      throw new Error(
        `JSONL 解析失败：${String(errors.length)} 行全部非法。` +
          `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
      )
    }

    if (errors.length > 0) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[localFileSync] JSONL 解析完成：${String(entries.length)} 条合法，${String(errors.length)} 行非法（已跳过）。` +
          `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
      )
    } else {
      bgmLog(LOG_LEVELS.INFO, `[localFileSync] 解析成功：${String(entries.length)} 条记录`)
    }

    return entries
  }

  /**
   * 校验配置是否完整可用
   *
   * 本地文件源仅要求 path 字段非空，不需要 owner/repo/branch。
   *
   * @returns 路径有效返回 Result.ok(undefined)，无效返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!isLocalFileConfigured()) {
      return Result.failVoid(
        new BgmError(
          '本地文件路径未配置，请在"文件路径"字段填写本地 .jsonl/.json 文件的绝对路径',
          'CONFIG_INCOMPLETE',
        ),
      )
    }
    return Result.okVoid()
  }
}

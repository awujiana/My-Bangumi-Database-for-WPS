/**
 * @fileoverview 本地文件同步源模块
 * @module sync/localFileSync
 * @description 通过 WPS 文件对话框或路径输入选择本地 .jsonlines / .jsonlines.gz / .jsonl / .json 文件，
 *              读取内容并复用 githubSyncDiff.ts 的 parseJsonl 解析逻辑。
 *
 *              与远程源（GitHub/GitLab/Gitee）的差异：
 *              - 不依赖网络请求，读取本地文件系统
 *              - 不需要 owner/repo/branch 配置，仅需 path 字段（文件绝对路径）
 *              - 复用 githubConfig 的 path 字段存储本地文件路径（避免引入独立存储）
 *              - 复用 parseJsonl / isGithubRemoteEntry 解析逻辑，不重复实现
 *
 * 数据格式（与 GitHub 同步源一致）：
 *   「表头 + 值数组」两段式 JSON Lines——第 1 个非空行是表头（纯字符串数组），
 *   其后每行是与表头等长的值数组；非法行不中断整体解析，会被收集到 errors 中跳过。
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

import { getGithubConfig, getManualShards } from './github-config.js'
import type { GithubRemoteEntry } from './github-sync-diff.js'
import { readXhrJsonlText } from './jsonl-response.js'
import { loadEntriesFromPath } from './shard-fetch.js'
import type { FetchRemoteEntriesOptions, SyncSource } from './sync-source.js'
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）

/** 文件读取超时（毫秒） */
const FILE_READ_TIMEOUT_MS = 15_000

/**
 * 读取本地文件内容
 *
 * 实现策略：通过 XMLHttpRequest + file:// 协议读取本地文件。
 * WPS 加载项环境运行在内置浏览器控件中，允许 file:// 协议访问本地文件系统。
 *
 * 内容可能是 gzip 压缩的 `.jsonlines.gz`（也可能是明文），
 * 由 `readXhrJsonlText` 按 gzip 魔数自动识别并解压，调用方拿到的一律是 JSONL 文本。
 *
 * 路径规范化：
 *   - Windows 路径（如 `C:\Users\foo\data.jsonlines`）转换为 `file:///C:/Users/foo/data.jsonlines`
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
    // 取原始字节：本地文件可能是 gzip 压缩的 .jsonlines.gz，需要按魔数判断后再解压
    xhr.responseType = 'arraybuffer'

    xhr.addEventListener('load', (): void => {
      // file:// 协议下 status 通常为 0（成功）或 200
      if (xhr.status === 0 || xhr.status === 200) {
        // gzip 数据源需要异步解压（DecompressionStream），走异步流程
        void (async (): Promise<void> => {
          try {
            const content = await readXhrJsonlText(xhr)
            bgmLog(
              LOG_LEVELS.INFO,
              `[localFileSync] 文件读取成功: ${filePath}（${String(content.length)} 字符）`,
            )
            resolve(content)
          } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        })()
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
  /**
   * 最近一次 {@link fetchRemoteEntries} 的下载统计
   *
   * 与 `BaseSyncSource` 子类同口径：loadEntriesFromPath 拼完后缺合法 sid
   * 被跳过的条数，由 syncFromRemote 读取后进入同步结果弹窗。实例级，
   * 每次同步从注册表取到的都是同一实例（注册表单例），但值是每次取数
   * 整体覆写（不是累加），不存在跨同步残留。
   */
  readonly loadStats: { skippedInvalidLines: number } = { skippedInvalidLines: 0 }

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
   * 与远程源共用 `shardFetch.loadEntriesFromPath`：路径指向清单时按 `neededFields`
   * 选片读取同目录下的分片文件后按行拼接；指向旧单片时直接解析。
   *
   * @param signal 可选的 AbortSignal，用于取消请求
   * @param options 取数选项（分片模式下按表头选片）
   * @returns 解析后的远程条目数组
   * @throws 文件路径未配置、文件读取失败、解析失败时抛出 Error
   */
  async fetchRemoteEntries(
    signal?: AbortSignal,
    options?: FetchRemoteEntriesOptions,
  ): Promise<GithubRemoteEntry[]> {
    // 1. 在发起请求前检查 signal.aborted，支持取消
    if (signal?.aborted) {
      throw new Error('请求被取消')
    }

    const filePath = getLocalFilePath()
    if (!filePath) {
      throw new Error('本地文件路径未配置，请在面板的"文件路径"字段填写或选择文件')
    }

    // 2. 读取内容（清单 + 各分片，由 loadEntriesFromPath 编排）
    bgmLog(LOG_LEVELS.INFO, `[localFileSync] 开始读取: ${filePath}`)
    const result = await loadEntriesFromPath({
      path: filePath,
      fetchText: readLocalFileContent,
      neededFields: options?.neededFields,
      manualShards: getManualShards(),
      signal,
      logTag: 'localFileSync',
    })
    // 脏数据计数透传给同步结果弹窗（loadStats 每次整体覆写，不累加）
    this.loadStats.skippedInvalidLines = result.skippedInvalidRecords

    // 3. 读取完成后、返回前再次检查 signal.aborted
    if (signal?.aborted) {
      throw new Error('请求被取消')
    }

    return result.entries
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
          '本地文件路径未配置，请在"文件路径"字段填写本地 .jsonlines / .jsonlines.gz / .jsonl / .json 文件的绝对路径',
          {
            code: 'CONFIG_INCOMPLETE',
          },
        ),
      )
    }
    return Result.okVoid()
  }
}

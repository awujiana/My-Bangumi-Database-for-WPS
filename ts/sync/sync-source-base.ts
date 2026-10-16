/**
 * @fileoverview 远程同步源实现类的公共骨架
 * @module sync/syncSourceBase
 * @description GitHub / GitLab / Gitee / Gist 四个远程源的 SyncSource 实现类
 *              除「取数函数、配置校验口径、错误文案」外结构逐字重复
 *              （幂等 validateConfig + getDisplayName + fetchRemoteEntries 委托），
 *              本文件抽出公共骨架，子类只写自己特有的部分。
 *
 * 设计约定：
 * - sourceType / displayName / 配置校验判定函数 / 错误文案由构造器注入，
 *   基类统一实现 getSourceType / getDisplayName / validateConfig
 * - fetchRemoteEntries 委托给各自的取数函数（URL 构造、状态码语义 401/403/404
 *   与错误文案均保留在各源自身的 fetchXxxJson 中，本文件不涉及）
 * - validateConfig 为幂等模板方法：完整 → Result.ok(undefined)；
 *   不完整 → Result.fail(BgmError{ code: 'CONFIG_INCOMPLETE' })
 *
 * 注意：本模块对 sync-source.ts / github-sync-diff.ts 均为 type-only import，
 * 不产生运行时依赖，不会引入循环依赖。
 */

import { BgmError, Result } from '../core/result.js'

import type { GithubRemoteEntry } from './github-sync-diff.js'
import type { FetchRemoteEntriesOptions, SyncSource } from './sync-source.js'

/**
 * 远程同步源骨架基类
 *
 * 供 GitHub / GitLab / Gitee / Gist 四个远程源的实现类继承：
 * 1. getSourceType / getDisplayName 由构造器参数统一实现
 * 2. fetchRemoteEntries 委托给各源的取数函数（子类实现）
 * 3. validateConfig 幂等：完整 → Result.ok(undefined)；
 *    不完整 → Result.fail(BgmError{ code: 'CONFIG_INCOMPLETE' })
 */
export abstract class BaseSyncSource implements SyncSource {
  /**
   * @param sourceType 数据源类型标识（如 'github' / 'gitlab' / 'gitee' / 'gist'）
   * @param displayName 数据源显示名称（用于日志与进度提示）
   * @param isConfigComplete 配置是否完整的判定函数（各源校验口径不同）
   * @param configIncompleteMessage 配置不完整时的错误文案（各源不同，必须保留在子类）
   */
  protected constructor(
    private readonly sourceType: string,
    private readonly displayName: string,
    private readonly isConfigComplete: () => boolean,
    private readonly configIncompleteMessage: string,
  ) {}

  /** 数据源类型标识 */
  getSourceType(): string {
    return this.sourceType
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return this.displayName
  }

  /**
   * 获取远程条目
   * @param signal 可选的 AbortSignal，用于取消请求
   * @param options 取数选项（分片模式下按表头选片）
   * @returns 解析后的远程条目数组
   * @throws 网络错误、配置错误、解析失败时抛出 Error
   */
  abstract fetchRemoteEntries(
    signal?: AbortSignal,
    options?: FetchRemoteEntriesOptions,
  ): Promise<GithubRemoteEntry[]>

  /**
   * 校验配置是否完整可用（幂等）
   *
   * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!this.isConfigComplete()) {
      return Result.failVoid(
        new BgmError(this.configIncompleteMessage, { code: 'CONFIG_INCOMPLETE' }),
      )
    }
    return Result.okVoid()
  }
}

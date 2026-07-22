/**
 * @fileoverview 同步源接口定义
 * @module sync/SyncSource
 * @description 定义统一的同步源接口，所有数据源（GitHub/GitLab/Gitee/本地文件/Gist）
 *              需实现此接口，由 syncSourceRegistry 注册并按 sourceType 调度。
 *
 * 设计目的：
 * - 解耦「数据来源」与「差异计算/应用」逻辑
 * - 新增数据源只需实现接口并注册，无需改动 syncFromGithub 主流程
 * - 通过统一校验接口让配置错误在调用前暴露
 */

import type { Result } from '../core/result.js'

import type { GithubRemoteEntry } from './githubSyncDiff.js'

/**
 * 同步源接口
 *
 * 所有数据源（GitHub/GitLab/Gitee/本地文件/Gist）需实现此接口。
 * 实现类应：
 * 1. 提供 sourceType 与 displayName 以便 UI 展示与日志
 * 2. fetchRemoteEntries 返回与 GitHub 远程条目结构兼容的数组
 * 3. validateConfig 在调用前校验必填项，返回 Result<void>
 */
export interface SyncSource {
  /** 数据源类型标识（如 'github' / 'gitlab' / 'gitee' / 'local' / 'gist'） */
  getSourceType(): string

  /** 数据源显示名称（用于日志、进度提示等） */
  getDisplayName(): string

  /**
   * 获取远程条目
   * @param signal 可选的 AbortSignal，用于取消请求
   * @returns 解析后的远程条目数组
   * @throws 网络错误、配置错误、解析失败时抛出 Error
   */
  fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]>

  /**
   * 校验配置是否完整可用
   * @returns 成功返回 Result.ok(undefined)，失败返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void>
}

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

import type { GithubRemoteEntry } from './github-sync-diff.js'

/**
 * 取数选项
 *
 * 分片数据源（`data/anime.<shard>.jsonlines.gz`）需要知道本次同步真正会用到哪些
 * 字段，才能只下载必要的分片；字段集合由调用方在下载前从**用户表格表头**推导
 * （见 `shardFetch.collectNeededFieldsFromSheet`）。
 */
export interface FetchRemoteEntriesOptions {
  /**
   * 本次同步会用到的 JSONL 字段
   *
   * 传 `undefined` 表示无法判断（如读不到工作表）→ 分片模式下全量下载（保守）。
   */
  neededFields?: ReadonlySet<string> | undefined
}

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
   * @param options 取数选项（分片模式下用于按表头选片）
   * @returns 解析后的远程条目数组
   * @throws 网络错误、配置错误、解析失败时抛出 Error
   */
  fetchRemoteEntries(
    signal?: AbortSignal,
    options?: FetchRemoteEntriesOptions,
  ): Promise<GithubRemoteEntry[]>

  /**
   * 最近一次 fetchRemoteEntries 的下载统计（可选）
   *
   * 分片数据源（GitHub / GitLab / Gitee / 本地文件）回填
   * `skippedInvalidLines`（缺合法 sid 被跳过的条数），由 syncFromGithub /
   * syncFromRemote 读取后进入结果弹窗。单片源（Gist）未提供该统计，
   * 其「全部行非法」路上抛错、「部分行非法」走日志，故为可选。
   */
  readonly loadStats?: { skippedInvalidLines: number }

  /**
   * 校验配置是否完整可用
   * @returns 成功返回 Result.ok(undefined)，失败返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void>
}

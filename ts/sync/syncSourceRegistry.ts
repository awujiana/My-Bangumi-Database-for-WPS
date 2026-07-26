/**
 * @fileoverview 同步源注册表与调度入口
 * @module sync/syncSourceRegistry
 * @description 统一管理所有 SyncSource 实现的注册、查询与统一同步入口。
 *
 * 设计目的：
 * - 新增数据源只需实现 SyncSource 接口并调用 registerSyncSource(type, factory)
 * - syncFromRemote 按 sourceType 从注册表获取对应实现，统一完成下载、diff、应用
 * - githubSync.ts 只负责 GitHub 源实现与差异应用工具，不再反向依赖注册表，
 *   从而打破 githubSync.ts ↔ syncSourceRegistry.ts 的循环依赖。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/util.js'

import { GistSyncSource } from './gistSync.js'
import { GiteeSyncSource } from './giteeSync.js'
import { getSyncSourceType } from './githubConfig.js'
import {
  applyConflictResolutions,
  applyDiffToSheet,
  computeDiff,
  GithubSyncSource,
  readLocalEntriesForSync,
  type GithubSyncResult,
  type SyncStrategy,
} from './githubSync.js'
import { type ConflictResolution } from './githubSyncDiff.js'
import { GitlabSyncSource } from './gitlabSync.js'
import { LocalFileSyncSource } from './localFileSync.js'
import type { SyncSource } from './SyncSource.js'

/** 同步源工厂函数：每次调用返回新实例，避免实例间状态共享 */
type SyncSourceFactory = () => SyncSource

/** 注册表内部存储：type → factory */
const registry = new Map<string, SyncSourceFactory>()

/**
 * 注册同步源
 * @param type 同步源类型标识（如 'github' / 'gitlab' / 'gitee' / 'local' / 'gist'）
 * @param factory 工厂函数，返回 SyncSource 实例
 */
export function registerSyncSource(type: string, factory: SyncSourceFactory): void {
  registry.set(type, factory)
}

/**
 * 获取同步源实例
 * @param type 同步源类型标识
 * @returns 已注册则返回新实例，未注册返回 null
 */
export function getSyncSource(type: string): SyncSource | null {
  const factory = registry.get(type)
  if (!factory) return null
  return factory()
}

/**
 * 获取所有已注册的同步源类型
 * @returns 类型标识数组
 */
export function getRegisteredSourceTypes(): string[] {
  return Array.from(registry.keys())
}

/**
 * 判断同步源是否已注册
 * @param type 同步源类型标识
 */
export function isSyncSourceRegistered(type: string): boolean {
  return registry.has(type)
}

/**
 * 统一远程同步入口
 *
 * 按当前配置的 sourceType 从注册表获取 SyncSource，完成：
 * 1. 校验配置；2. 下载远程条目；3. 计算差异；4. 应用差异到 Excel；
 * 5. 写入同步记录（由 applyDiffToSheet 内部完成）。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、未知 sourceType 时抛出
 */
export async function syncFromRemote(
  onProgress?: (current: number, total: number, message: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  conflictResolution?: ConflictResolution[],
): Promise<GithubSyncResult> {
  // 1. 按 sourceType 从注册表获取 SyncSource 实例
  const sourceType = getSyncSourceType()
  const source = getSyncSource(sourceType)
  if (!source) {
    throw new Error(`未知的同步源类型: ${sourceType}`)
  }

  // 2. 调用 source.validateConfig() 校验配置完整性
  const validationResult = source.validateConfig()
  if (validationResult.isFail()) {
    const errMsg = validationResult.error?.message ?? `同步源 ${sourceType} 配置校验失败`
    throw new Error(errMsg)
  }

  // 3. 调用 source.fetchRemoteEntries() 下载远程数据
  onProgress?.(0, 0, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
  const remoteEntries = await source.fetchRemoteEntries(signal)
  onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`)

  const local = readLocalEntriesForSync()
  if (!local) {
    throw new Error('无法读取本地工作表数据')
  }

  onProgress?.(2, 3, '比对差异中...')
  const diffs = computeDiff(remoteEntries, local.entries, strategy)

  // 应用用户冲突解决决策：过滤掉用户选择「本地」的字段
  if (conflictResolution && conflictResolution.length > 0) {
    applyConflictResolutions(diffs, conflictResolution)
    bgmLog(LOG_LEVELS.INFO, `[syncFromRemote] 已应用 ${conflictResolution.length} 条冲突解决决策`)
  }

  const addCount = diffs.filter((d) => d.kind === 'add').length
  const updateCount = diffs.filter((d) => d.kind === 'update').length
  const deleteCount = diffs.filter((d) => d.kind === 'delete').length
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncFromRemote] diff 完成（${strategy}）：新增 ${addCount}，更新 ${updateCount}，删除 ${deleteCount}`,
  )

  const result = applyDiffToSheet(diffs, strategy, onProgress, source.getDisplayName())
  result.remoteTotal = remoteEntries.length
  // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
  result.unchanged = Math.max(0, remoteEntries.length - addCount - updateCount)

  onProgress?.(3, 3, `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`)
  return result
}

// 默认注册所有同步源
// 各实现类模块仅被注册表依赖，不反向依赖注册表，避免循环依赖
registerSyncSource('github', () => new GithubSyncSource())
registerSyncSource('gitlab', () => new GitlabSyncSource())
registerSyncSource('gitee', () => new GiteeSyncSource())
registerSyncSource('local', () => new LocalFileSyncSource())
registerSyncSource('gist', () => new GistSyncSource())

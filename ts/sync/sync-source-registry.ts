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
import {
  bgmLog,
  getApp,
  findHeaderRow,
  getColumnMap,
  ensureSheetHeaders,
  getDataSheet,
} from '../tools/utility.js'

import { GistSyncSource } from './gist-sync.js'
import { GiteeSyncSource } from './gitee-sync.js'
import { getSyncSourceType } from './github-config.js'
import {
  applyConflictResolutions,
  applyDiffToSheet,
  computeDiff,
  GithubSyncSource,
  readLocalEntriesForSync,
} from './github-sync.js'
import type { GithubSyncResult, SyncStrategy } from './github-sync.js'
import { collectMissingColumns, filterByTime } from './github-sync-diff.js'
import type { ConflictResolution, SyncTimeFilter } from './github-sync-diff.js'
import { formatTimeFilterLabel } from './github-time-format.js'
import { GitlabSyncSource } from './gitlab-sync.js'
import { LocalFileSyncSource } from './local-file-sync.js'
import { getSelectedRowSids } from './selected-rows.js'
import { collectNeededFieldsFromSheet } from './shard-fetch.js'
import type { SyncSource } from './sync-source.js'

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
  return [...registry.keys()]
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
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  shouldUseSelectedRowsOnly?: boolean,
  conflictResolution?: ConflictResolution[],
  timeFilter?: SyncTimeFilter,
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
    const errorMessage = validationResult.error?.message ?? `同步源 ${sourceType} 配置校验失败`
    throw new Error(errorMessage)
  }

  // 3. 调用 source.fetchRemoteEntries() 下载远程数据
  // 使用 total=1 避免进度条显示"0/0"带来的困惑
  const syncStartTs = Date.now()
  onProgress?.(0, 1, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
  const downloadStartTs = Date.now()
  // 分片数据源按表头只下载需要的片；读不到表头时返回 undefined → 全量下载
  const neededFields = collectNeededFieldsFromSheet()
  // 时间筛选完全依赖远程条目的 date 字段，而 date **不在** REQUIRED_FIELDS 里：
  // 用户表若没有「开播日期」列，按表头推导 neededFields 时不会带上 date，
  // 分片选择可能不下载承载它的分片 → 所有 entry.date 均为 undefined →
  // filterByTime 把它们全部判为「无日期」过滤掉，最终同步 0 条且无任何提示。
  // 因此启用时间筛选时必须显式补上 date（读不到表头时本就是全量下载，不受影响）。
  if (neededFields && timeFilter?.enabled === true && timeFilter.range !== 'all') {
    neededFields.add('date')
  }
  const remoteEntries = await source.fetchRemoteEntries(signal, {
    neededFields,
  })
  const downloadElapsed = Date.now() - downloadStartTs
  onProgress?.(
    1,
    3,
    `下载完成：${String(remoteEntries.length)} 条（耗时 ${String(downloadElapsed)}ms）`,
  )

  // 关闭屏幕刷新，减少 COM 调用开销（ensureSheetHeaders / readLocalEntriesForSync 等 COM 操作）
  const app = getApp()
  let previousScreenUpdating: boolean | undefined
  let previousCalculation: number | undefined
  try {
    if (app) {
      previousScreenUpdating = app.ScreenUpdating
      previousCalculation = app.Calculation
      app.ScreenUpdating = false
      // xlCalculationManual
      app.Calculation = -4135
    }
  } catch {
    // 忽略关闭失败
  }

  const applyRemoteEntries = async (): Promise<GithubSyncResult> => {
    // 3.5 空文档自动填充表头
    const ws = getDataSheet()
    if (ws) {
      const isFilled = ensureSheetHeaders(ws)
      if (isFilled) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromRemote] 空文档已自动填充标准表头')
        onProgress?.(1, 3, '已自动填充表头，继续同步...')
      }
    }

    // 3.6 仅同步选中行：从 WPS Selection 提取 SID 集合，过滤远程条目
    let effectiveRemoteEntries = remoteEntries
    if (shouldUseSelectedRowsOnly) {
      const selectedSids = getSelectedRowSids()
      if (selectedSids.size === 0) {
        throw new Error('未选中任何行，或选中行中未找到 Bangumi URL')
      }
      effectiveRemoteEntries = remoteEntries.filter((entry) => selectedSids.has(entry.sid))
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromRemote] 仅同步选中行：选中 ${String(selectedSids.size)} 个 SID，匹配远程 ${String(effectiveRemoteEntries.length)} 条`,
      )
      onProgress?.(
        1,
        3,
        `选中 ${String(selectedSids.size)} 行，匹配远程 ${String(effectiveRemoteEntries.length)} 条`,
      )
    }

    // 3.7 时间筛选：按年份/季度/月份过滤远程条目
    if (timeFilter?.enabled && timeFilter.range !== 'all') {
      const beforeCount = effectiveRemoteEntries.length
      effectiveRemoteEntries = filterByTime(effectiveRemoteEntries, timeFilter)
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromRemote] 时间筛选（${timeFilter.range}）：${String(beforeCount)} → ${String(effectiveRemoteEntries.length)} 条`,
      )
      onProgress?.(
        1,
        3,
        `时间筛选：${formatTimeFilterLabel(timeFilter)}，匹配 ${String(effectiveRemoteEntries.length)} 条`,
      )
    }

    const local = readLocalEntriesForSync()
    if (!local) {
      throw new Error('无法读取本地工作表数据')
    }

    onProgress?.(2, 3, '比对差异中...')
    const diffStartTs = Date.now()
    const diffs = computeDiff(effectiveRemoteEntries, local.entries, strategy, timeFilter)
    const diffElapsed = Date.now() - diffStartTs

    // 应用用户冲突解决决策：过滤掉用户选择「本地」的字段
    if (conflictResolution && conflictResolution.length > 0) {
      applyConflictResolutions(diffs, conflictResolution)
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromRemote] 已应用 ${String(conflictResolution.length)} 条冲突解决决策`,
      )
    }

    const addedCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deletedCount = diffs.filter((d) => d.kind === 'delete').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromRemote] diff 完成（${strategy}）：新增 ${String(addedCount)}，更新 ${String(updateCount)}，删除 ${String(deletedCount)}，耗时 ${String(diffElapsed)}ms`,
    )

    const result = await applyDiffToSheet(
      diffs,
      strategy,
      onProgress,
      source.getDisplayName(),
      signal,
    )
    result.remoteTotal = effectiveRemoteEntries.length
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, effectiveRemoteEntries.length - addedCount - updateCount)

    // 缺列体检：远程有数据、本地却没有对应表头的字段 → 提示用户自行添加列。
    // 写入侧遇到缺失列直接跳过，不体检的话用户只会看到「同步成功但字段没进来」。
    // 此前只有 GitHub 路径做体检，走 Gitee/GitLab/本地/Gist 时用户完全看不到提示。
    const sheetForAudit = getDataSheet()
    if (sheetForAudit) {
      const auditHeaderRow = findHeaderRow(sheetForAudit) || 1
      result.missingColumns = collectMissingColumns(
        effectiveRemoteEntries,
        getColumnMap(sheetForAudit, auditHeaderRow),
      )
      if (result.missingColumns.length > 0) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[syncFromRemote] ${String(result.missingColumns.length)} 个远程字段因本地缺少表头未同步，建议添加列：${result.missingColumns.join('、')}`,
        )
      }
    }

    // 脏数据体检：分片拼接时缺合法 sid 的记录被静默跳过（与 parseJsonl 的
    // 「非法行不中断整体解析」同口径），提示后用户能区分「本来就是这么多」
    // 与「下载了一部分」。Gist 等未提供该统计的源跳过本段。
    const skippedInvalid = source.loadStats?.skippedInvalidLines ?? 0
    if (skippedInvalid > 0) {
      result.skippedInvalidLines = skippedInvalid
      bgmLog(
        LOG_LEVELS.WARN,
        `[syncFromRemote] ${String(skippedInvalid)} 条远程记录缺少合法 sid 已跳过，数据源本身有脏数据`,
      )
    }

    const totalElapsed = Date.now() - syncStartTs
    const totalProcessed = addedCount + updateCount + deletedCount
    const overallSpeed =
      totalProcessed > 0 && totalElapsed > 0
        ? Math.round((totalProcessed / totalElapsed) * 1000)
        : 0
    onProgress?.(
      3,
      3,
      `完成：新增 ${String(result.added)}，更新 ${String(result.updated)}，删除 ${String(result.deleted)}（总耗时 ${String(totalElapsed)}ms，${String(overallSpeed > 0 ? overallSpeed : '?')} 行/秒）`,
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromRemote] 同步完成：下载 ${String(downloadElapsed)}ms，diff ${String(diffElapsed)}ms，应用耗时已计入，总耗时 ${String(totalElapsed)}ms，处理 ${String(totalProcessed)} 条，平均 ${String(overallSpeed > 0 ? overallSpeed : '?')} 行/秒`,
    )
    return result
  }
  try {
    return await applyRemoteEntries()
  } finally {
    // 恢复屏幕刷新和自动计算
    try {
      if (app) {
        if (previousScreenUpdating !== undefined) app.ScreenUpdating = previousScreenUpdating
        if (previousCalculation !== undefined) app.Calculation = previousCalculation
      }
    } catch {
      // 忽略恢复失败
    }
  }
}

// 默认注册所有同步源
// 各实现类模块仅被注册表依赖，不反向依赖注册表，避免循环依赖
registerSyncSource('github', () => new GithubSyncSource())
registerSyncSource('gitlab', () => new GitlabSyncSource())
registerSyncSource('gitee', () => new GiteeSyncSource())
registerSyncSource('local', () => new LocalFileSyncSource())
registerSyncSource('gist', () => new GistSyncSource())

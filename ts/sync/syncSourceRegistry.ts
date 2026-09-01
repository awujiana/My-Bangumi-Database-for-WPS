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
  getCellValue,
  findHeaderRow,
  getColumnMap,
  trim,
  ensureSheetHeaders,
  getDataSheet,
} from '../tools/util.js'

import { GistSyncSource } from './gistSync.js'
import { GiteeSyncSource } from './giteeSync.js'
import { getSyncSourceType } from './githubConfig.js'
import {
  applyConflictResolutions,
  applyDiffToSheet,
  computeDiff,
  GithubSyncSource,
  readLocalEntriesForSync,
} from './githubSync.js'
import type { GithubSyncResult, SyncStrategy } from './githubSync.js'
import { filterByTime } from './githubSyncDiff.js'
import type { ConflictResolution, SyncTimeFilter } from './githubSyncDiff.js'
import { GitlabSyncSource } from './gitlabSync.js'
import { LocalFileSyncSource } from './localFileSync.js'
import { extractSubjectId } from './pureUtils.js'
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
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  selectedRowsOnly?: boolean,
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
    const errMsg = validationResult.error?.message ?? `同步源 ${sourceType} 配置校验失败`
    throw new Error(errMsg)
  }

  // 3. 调用 source.fetchRemoteEntries() 下载远程数据
  // 使用 total=1 避免进度条显示"0/0"带来的困惑
  const syncStartTs = Date.now()
  onProgress?.(0, 1, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
  const downloadStartTs = Date.now()
  const remoteEntries = await source.fetchRemoteEntries(signal)
  const downloadElapsed = Date.now() - downloadStartTs
  onProgress?.(
    1,
    3,
    `下载完成：${String(remoteEntries.length)} 条（耗时 ${String(downloadElapsed)}ms）`,
  )

  // 关闭屏幕刷新，减少 COM 调用开销（ensureSheetHeaders / readLocalEntriesForSync 等 COM 操作）
  const app = getApp()
  let prevScreenUpdating: boolean | undefined
  let prevCalculation: number | undefined
  try {
    if (app) {
      prevScreenUpdating = app.ScreenUpdating
      prevCalculation = app.Calculation
      app.ScreenUpdating = false
      app.Calculation = -4135 // xlCalculationManual
    }
  } catch {
    // 忽略关闭失败
  }

  try {
    // 3.5 空文档自动填充表头
    const ws = getDataSheet()
    if (ws) {
      const filled = ensureSheetHeaders(ws)
      if (filled) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromRemote] 空文档已自动填充标准表头')
        onProgress?.(1, 3, '已自动填充表头，继续同步...')
      }
    }

    // 3.6 仅同步选中行：从 WPS Selection 提取 SID 集合，过滤远程条目
    let effectiveRemoteEntries = remoteEntries
    if (selectedRowsOnly) {
      const selectedSids = getSelectedRowSids()
      if (selectedSids.size === 0) {
        throw new Error('未选中任何行，或选中行中未找到 Bangumi URL')
      }
      effectiveRemoteEntries = remoteEntries.filter((e) => selectedSids.has(e.sid))
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
        `时间筛选：${timeFilter.range === 'year' ? `${String(timeFilter.year)}年` : timeFilter.range === 'quarter' ? `${String(timeFilter.year)}年${String(timeFilter.quarter ?? '')}月新番` : `${String(timeFilter.year)}年${String(timeFilter.month ?? '')}月`}，匹配 ${String(effectiveRemoteEntries.length)} 条`,
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

    const addCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deleteCount = diffs.filter((d) => d.kind === 'delete').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromRemote] diff 完成（${strategy}）：新增 ${String(addCount)}，更新 ${String(updateCount)}，删除 ${String(deleteCount)}，耗时 ${String(diffElapsed)}ms`,
    )

    const result = await applyDiffToSheet(diffs, strategy, onProgress, source.getDisplayName())
    result.remoteTotal = effectiveRemoteEntries.length
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, effectiveRemoteEntries.length - addCount - updateCount)

    const totalElapsed = Date.now() - syncStartTs
    const totalProcessed = addCount + updateCount + deleteCount
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
  } finally {
    // 恢复屏幕刷新和自动计算
    try {
      if (app) {
        if (prevScreenUpdating !== undefined) app.ScreenUpdating = prevScreenUpdating
        if (prevCalculation !== undefined) app.Calculation = prevCalculation
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

/**
 * 从 WPS 当前选区提取所有行的 SID 集合
 *
 * 遍历 Selection 的行范围，读取每行的 Bangumi_URL 列，提取 SID。
 * 用于「仅同步选中行」功能。
 *
 * @returns SID 字符串集合；空集合表示未选中行或未找到 URL
 */
function getSelectedRowSids(): Set<string> {
  const sids = new Set<string>()
  try {
    const app = getApp()
    if (!app) return sids

    const selection = app.Selection
    if (!selection) {
      bgmLog(LOG_LEVELS.WARN, '[getSelectedRowSids] 无选区')
      return sids
    }

    // 获取选区的行范围
    const firstRow = selection.Row
    const lastRow = selection.Row + selection.Rows.Count - 1
    bgmLog(
      LOG_LEVELS.INFO,
      `[getSelectedRowSids] 选区行范围: ${String(firstRow)}-${String(lastRow)}`,
    )

    // 获取工作表和列映射
    const ws = app.ActiveSheet
    if (!ws) return sids
    const headerRow = findHeaderRow(ws) || 1
    const colMap = getColumnMap(ws, headerRow)
    const urlCol = colMap.get('Bangumi_URL')
    if (!urlCol) {
      bgmLog(LOG_LEVELS.WARN, '[getSelectedRowSids] 未找到 Bangumi_URL 列')
      return sids
    }

    // 遍历选区每行，提取 SID
    for (let row = firstRow; row <= lastRow; row += 1) {
      if (row === headerRow) continue // 跳过表头行
      const url = trim(getCellValue(ws, row, urlCol))
      if (!url) continue
      const sid = extractSubjectId(url)
      if (sid) {
        sids.add(sid)
      }
    }

    bgmLog(LOG_LEVELS.INFO, `[getSelectedRowSids] 提取到 ${String(sids.size)} 个 SID`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[getSelectedRowSids] 提取失败: ${(error as Error).message}`)
  }
  return sids
}

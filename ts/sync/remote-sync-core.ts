/**
 * @fileoverview 远程同步统一编排（各入口共用的主流程）
 * @module sync/remoteSyncCore
 * @description 2026-10-17 结构合并：`syncFromRemote`（sync-source-registry.ts）与
 *              `syncFromGithub`（github-sync.ts）的主体曾逐字重复约 150 行，收敛为
 *              本模块的 {@link runRemoteSync}。两者的历史差异（source 获取方式、
 *              校验失败文案、日志 tag、耗时格式）全部参数化，由两个薄入口各自传入。
 *
 *              流程：校验配置 → 按表头推导所需字段（时间筛选启用时补 date）→ 下载 →
 *              关闭屏幕刷新 → 空文档表头填充 / 选中行过滤 / 时间筛选 → 读本地 →
 *              diff → 冲突决策 → applyDiffToSheet → 缺列与脏数据体检 → 汇总收尾。
 *
 *              apply 阶段在 `remote-sync-apply.ts`：`vi.mock` 截不住模块内调用，
 *              apply 与编排必须分模块才能保住 registry 测试的 mock 接缝。
 *
 *              进度与日志口径以 sync-source-registry 版为基准：进度分母
 *              0/1 → 1/3 → 2/3 → 3/3，编排层耗时一律裸毫秒 `${ms}ms`
 *              （apply 阶段内部的 formatDuration 文案不变）。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  bgmLog,
  ensureSheetHeaders,
  findHeaderRow,
  getApp,
  getColumnMap,
  getDataSheet,
} from '../tools/utility.js'

import { collectMissingColumns, computeDiff, filterByTime } from './github-sync-diff.js'
import type { ConflictResolution, SyncStrategy, SyncTimeFilter } from './github-sync-diff.js'
import { formatTimeFilterLabel } from './github-time-format.js'
import {
  applyConflictResolutions,
  applyDiffToSheet,
  readLocalEntriesForSync,
} from './remote-sync-apply.js'
import type { GithubSyncResult } from './remote-sync-apply.js'
import { getSelectedRowSids } from './selected-rows.js'
import { collectNeededFieldsFromSheet } from './shard-fetch.js'
import type { SyncSource } from './sync-source.js'

/** {@link runRemoteSync} 入参：两个薄入口的历史差异全部在此参数化 */
export interface RunRemoteSyncParameters {
  /** 同步源实例（入口负责按 sourceType 从注册表取，或直接 new） */
  source: SyncSource
  /** 编排层日志 tag（入口名，如 'syncFromRemote' / 'syncFromGithub'） */
  logTag: string
  /** validateConfig 失败且 error.message 缺失时的兜底文案 */
  validationFailedMessage: string
  /** 进度回调（current, total, message, eta） */
  onProgress?: ((current: number, total: number, message: string, eta?: string) => void) | undefined
  /** 同步策略，默认 'add-update' */
  strategy?: SyncStrategy | undefined
  /** 可选 AbortSignal，用于取消请求（下载与写入阶段均生效） */
  signal?: AbortSignal | undefined
  /** 仅同步选中行 */
  shouldUseSelectedRowsOnly?: boolean | undefined
  /** 冲突解决决策列表；提供时按用户选择过滤 update diff 的字段 */
  conflictResolution?: ConflictResolution[] | undefined
  /** 时间筛选条件 */
  timeFilter?: SyncTimeFilter | undefined
}

/**
 * 统一远程同步编排
 *
 * 步骤：
 * 1. `source.validateConfig()` 校验配置（失败抛出，文案取 validationFailedMessage）
 * 2. `collectNeededFieldsFromSheet()` 按表头推导所需字段；时间筛选启用时补 `date`
 * 3. `source.fetchRemoteEntries()` 下载远程条目
 * 4. 关闭屏幕刷新 / 自动计算（`finally` 恢复）
 * 5. applyRemoteEntries：空文档表头填充 → 选中行过滤 → 时间筛选 → 读本地 →
 *    computeDiff → applyConflictResolutions → applyDiffToSheet → 缺列体检 →
 *    脏数据体检 → 汇总进度与日志
 *
 * @param parameters 见 {@link RunRemoteSyncParameters}
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、本地工作表不可读时抛出
 */
export async function runRemoteSync(
  parameters: RunRemoteSyncParameters,
): Promise<GithubSyncResult> {
  const {
    source,
    logTag,
    validationFailedMessage,
    onProgress,
    strategy,
    signal,
    shouldUseSelectedRowsOnly,
    conflictResolution,
    timeFilter,
  } = parameters
  // 两个薄入口的签名上都带默认值，这里再兜一层：core 被单独调用时不依赖调用方
  const effectiveStrategy: SyncStrategy = strategy ?? 'add-update'

  // 1. 校验配置完整性（骨架见 BaseSyncSource.validateConfig）
  const validationResult = source.validateConfig()
  if (validationResult.isFail()) {
    const errorMessage = validationResult.error?.message ?? validationFailedMessage
    throw new Error(errorMessage)
  }

  // 2. 下载远程条目
  // 使用 total=1 避免进度条显示"0/0"带来的困惑
  const syncStartTs = Date.now()
  onProgress?.(
    0,
    1,
    `开始下载远程数据（${source.getDisplayName()} - 策略：${effectiveStrategy}）...`,
  )
  const downloadStartTs = Date.now()
  // 分片数据源按表头只下载需要的片；读不到表头时返回 undefined → 全量下载
  const neededFields = collectNeededFieldsFromSheet()
  // 时间筛选完全依赖远程条目的 date 字段，而 date **不在** REQUIRED_FIELDS 里：
  // 用户表若没有「开播日期」列，按表头推导 neededFields 时不会带上 date，
  // 分片选择可能不下载承载它的片 → 所有 entry.date 均为 undefined →
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

  // 3. 关闭屏幕刷新，减少 COM 调用开销（ensureSheetHeaders / readLocalEntriesForSync 等 COM 操作）
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
        bgmLog(LOG_LEVELS.INFO, `[${logTag}] 空文档已自动填充标准表头`)
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
        `[${logTag}] 仅同步选中行：选中 ${String(selectedSids.size)} 个 SID，匹配远程 ${String(effectiveRemoteEntries.length)} 条`,
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
        `[${logTag}] 时间筛选（${timeFilter.range}）：${String(beforeCount)} → ${String(effectiveRemoteEntries.length)} 条`,
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
    const diffs = computeDiff(effectiveRemoteEntries, local.entries, effectiveStrategy, timeFilter)
    const diffElapsed = Date.now() - diffStartTs

    // 应用用户冲突解决决策：过滤掉用户选择「本地」的字段
    if (conflictResolution && conflictResolution.length > 0) {
      applyConflictResolutions(diffs, conflictResolution)
      bgmLog(
        LOG_LEVELS.INFO,
        `[${logTag}] 已应用 ${String(conflictResolution.length)} 条冲突解决决策`,
      )
    }

    const addedCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deletedCount = diffs.filter((d) => d.kind === 'delete').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[${logTag}] diff 完成（${effectiveStrategy}）：新增 ${String(addedCount)}，更新 ${String(updateCount)}，删除 ${String(deletedCount)}，耗时 ${String(diffElapsed)}ms`,
    )

    const result = await applyDiffToSheet(
      diffs,
      effectiveStrategy,
      onProgress,
      source.getDisplayName(),
      signal,
    )
    result.remoteTotal = effectiveRemoteEntries.length
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, effectiveRemoteEntries.length - addedCount - updateCount)

    // 缺列体检：远程有数据、本地却没有对应表头的字段 → 提示用户自行添加列。
    // 写入侧 safeSet 遇缺失列直接 return，不体检的话用户只会看到「同步成功但字段没进来」。
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
          `[${logTag}] ${String(result.missingColumns.length)} 个远程字段因本地缺少表头未同步，建议添加列：${result.missingColumns.join('、')}`,
        )
      }
    }

    // 脏数据体检：分片拼接时缺合法 sid 的记录被静默跳过（与 parseJsonl 的
    // 「非法行不中断整体解析」同口径），提示后用户能区分「本来就是这么多」
    // 与「下载了一部分」。未提供该统计的源（loadStats 缺省）跳过本段。
    const skippedInvalid = source.loadStats?.skippedInvalidLines ?? 0
    if (skippedInvalid > 0) {
      result.skippedInvalidLines = skippedInvalid
      bgmLog(
        LOG_LEVELS.WARN,
        `[${logTag}] ${String(skippedInvalid)} 条远程记录缺少合法 sid 已跳过，数据源本身有脏数据`,
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
      `[${logTag}] 同步完成：下载 ${String(downloadElapsed)}ms，diff ${String(diffElapsed)}ms，应用耗时已计入，总耗时 ${String(totalElapsed)}ms，处理 ${String(totalProcessed)} 条，平均 ${String(overallSpeed > 0 ? overallSpeed : '?')} 行/秒`,
    )
    return result
  }
  try {
    return await applyRemoteEntries()
  } finally {
    // 4. 恢复屏幕刷新和自动计算
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

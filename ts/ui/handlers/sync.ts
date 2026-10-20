/**
 * UI 事件处理模块 - 同步相关
 * @module ui/handlers/sync
 * @description 从面板同步到 Bangumi、从 BGM API 同步收藏标记等。
 */

import {
  LOG_LEVELS,
  bgmLog,
  BGM,
  loadBgToken,
  _setBgmUserId,
  getApp,
  getCell,
  trim,
  showAlert,
  showConfirm,
  confirmAsync,
  showToast,
  setStatus,
  verifyToken,
  fetchAllUserCollections,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  extractSubjectId,
  getDataSheet,
  SyncToBangumiAsync,
  getOrCreateSyncRecordSheet,
  getAllSyncRecords,
  addSyncRecords,
  BGM_COLOR,
  COLLECTION_TYPE_NAMES,
  BGM_SUBJECT_TYPES,
  setCellValue,
  clearSheetCache,
  showSyncProgressDialog,
  updateSyncProgressDialog,
  completeSyncProgressDialog,
  hideSyncProgressDialog,
  buildSyncConfig,
  formatDuration,
  isIncrementalSyncEnabled,
  getListType,
} from '../../index.js'
import type {
  SyncRecord,
  SyncProgressStats,
  SyncConfigSummary,
  UpdateRecordParameters,
} from '../../index.js'
import { getSyncPreview, detectConflicts } from '../../services/ribbon-service.js'
import { createSyncControlHandlers } from '../../core/sync-progress-handlers.js'
import { createStatusBarWriter } from '../../tools/util/status-bar.js'
import { ensureSheetHeaders, readRangeCellValues } from '../../tools/util/index.js'
import { columnNumberToLetter } from '../../tools/string-utilities.js'
import type { WpsApp, WpsCellValue, WpsWorksheet } from '../../tools/wps.js'

import { _T } from './_constants.js'
import { showTokenDialog } from './token.js'

// ========== 本地类型定义 ==========

/**
 * 构造并展示上传同步结果弹窗（从 syncFromPanel 步骤11 的 try 块抽出，降低 try-complexity）
 */
function presentUploadResult(
  result: Awaited<ReturnType<typeof SyncToBangumiAsync>>,
  startTime: number,
): void {
  const totalElapsed = Date.now() - startTime
  const totalProcessed = result.success + result.fail
  const avgSpeed =
    totalProcessed > 0 && totalElapsed > 0 ? Math.round((totalProcessed / totalElapsed) * 1000) : 0
  const summary = `📊 同步 ${String(result.success + result.fail + result.skip)} 条 | 耗时 ${formatDuration(totalElapsed)}\n\n✅ 成功: ${String(result.success)}\n❌ 失败: ${String(result.fail)}\n⏭️ 跳过: ${String(result.skip)}`
  const details: string[] = result.stopped
    ? [
        '⚠️ 同步被用户停止',
        `成功 ${String(result.success)} 条`,
        `失败 ${String(result.fail)} 条`,
        `跳过 ${String(result.skip)} 条`,
        `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
        `⚡️ 平均速度: ${avgSpeed > 0 ? `${String(avgSpeed)} 行/秒` : '--'}`,
      ]
    : [
        `成功 ${String(result.success)} 条`,
        `失败 ${String(result.fail)} 条`,
        `跳过 ${String(result.skip)} 条`,
        `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
        `⚡️ 平均速度: ${avgSpeed > 0 ? `${String(avgSpeed)} 行/秒` : '--'}`,
      ]
  // 构造 SyncProgressStats 用于图表渲染（将 Bangumi 同步的 success 映射为 added）
  const stats: SyncProgressStats = {
    added: result.success,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    failed: result.fail,
    skipped: result.skip,
    remoteTotal: result.success + result.fail + result.skip,
    elapsedMs: totalElapsed,
    avgSpeed,
    strategyLabel: '同步到 Bangumi',
  }
  completeSyncProgressDialog(summary, details, result.stopped, undefined, stats)
}

/**
 * Bangumi 收藏条目结构（仅用到的字段）
 */
interface BangumiCollectionItem {
  subject_id: number
  subject_type?: number
  type?: number
  rate?: number
  tags?: string[]
  comment?: string
  subject?: {
    name_cn?: string
    name?: string
  }
}

/**
 * 同步准备结果：包含执行同步所需的全部上下文。
 */
interface SyncPreparedData {
  worksheet: WpsWorksheet
  columnMap: Map<string, number>
  token: string
  lastRow: number
  headerRow: number
  incremental: boolean
  fingerprintMap: Map<string, string> | undefined
  originalActiveSheet: WpsWorksheet | null
  syncSheet: WpsWorksheet | null
  app: WpsApp
  startTime: number
}

/** 收藏填充的单行待写单元格（列号 + 值；口径与旧逐格写逐字一致） */
interface FillWrites {
  column: number
  value: unknown
}

/** 收藏填充的单行待写计划 */
interface FillPendingRow {
  row: number
  writes: FillWrites[]
}

/** 批量矩形写的单批行数上限（限制单次写失败的波及面） */
const FILL_BATCH_ROWS = 200

/**
 * 将 Bangumi 收藏列表填充到空工作表。
 * 仅写入 columnMap 中存在的列，避免向不存在的列写入。
 *
 * **批量写（§5.6 A3）**：旧实现每条收藏逐格写 ~8 列（500 条 ≈ 4000 次 COM）。
 * 现改为「连续行合并成一次 `Range.Value2` 矩形写」（500 条 ≈ 十余次）：
 *  1. **旧值基底**：写入区间一次 `readRangeCellValues` 矩形读（`preserveCellValue`
 *     保留原始类型）——矩形写会覆盖 1..maxWriteCol 整段，未提供的列必须写回旧值，
 *     否则 `null`/空串会清掉区间中段的列（§2.2）；读不到旧值（空表 / 读失败）时
 *     基底为 `null`，与空表填充场景一致。
 *  2. **批量写**：连续行每至多 {@link FILL_BATCH_ROWS} 行一次矩形写；写抛错时
 *     该批回退逐格 `setCellValue`（保留其 `Formula`/`Value` 回退链与逐格失败语义）。
 *  3. 无 `subject_id` 的条目行不写、也不并入矩形区间（与旧行为一致）；
 *     每行的待写列集合与旧逐格写逐字一致（空值列照样不写）。
 * @returns 实际写入的数据行数（无单元格写失败的行数，与旧口径一致）
 */
async function _fillSheetWithCollections(
  worksheet: WpsWorksheet,
  collections: BangumiCollectionItem[],
  headerRow: number,
  columnMap: Map<string, number>,
): Promise<number> {
  const total = collections.length

  // 1. 逐条计算待写单元格（口径与旧逐格写一致；每 50 行让出事件循环）
  const pending: FillPendingRow[] = []
  let maxWriteCol = 0
  for (let index = 0; index < total; index += 1) {
    const item = collections[index]
    if (item?.subject_id) {
      const row = headerRow + 1 + index
      const { subject } = item
      const name = (subject?.name_cn || subject?.name) ?? '' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- API 字段空串需退到备用字段（`??` 会保留空串）
      const alias = subject?.name_cn && subject.name ? subject.name : ''
      const url = `https://bgm.tv/subject/${String(item.subject_id)}`

      const writes: FillWrites[] = []

      const seqCol = columnMap.get('序列号')
      if (seqCol !== undefined) writes.push({ column: seqCol, value: index + 1 })

      const nameCol = columnMap.get('名称')
      if (nameCol !== undefined && name) writes.push({ column: nameCol, value: name })

      const aliasCol = columnMap.get('别名')
      if (aliasCol !== undefined && alias) writes.push({ column: aliasCol, value: alias })

      const urlCol = columnMap.get('Bangumi_URL')
      if (urlCol !== undefined) writes.push({ column: urlCol, value: url })

      const categoryCol = columnMap.get('类别')
      if (categoryCol !== undefined) {
        writes.push({ column: categoryCol, value: BGM_SUBJECT_TYPES[item.subject_type ?? 2] ?? '' })
      }

      const finishedCol = columnMap.get('是否看完')
      if (finishedCol !== undefined) {
        // type 2 = 看过，视为已看完；其余状态视为未看完
        writes.push({ column: finishedCol, value: item.type === 2 ? '是' : '否' })
      }

      const scoreCol = columnMap.get('打分')
      if (scoreCol !== undefined && item.rate != null)
        writes.push({ column: scoreCol, value: item.rate })

      const tagsCol = columnMap.get('标签/分级')
      if (tagsCol !== undefined && item.tags && item.tags.length > 0) {
        writes.push({ column: tagsCol, value: item.tags.join(', ') })
      }

      const commentCol = columnMap.get('剧透/感言')
      if (commentCol !== undefined && item.comment) {
        writes.push({ column: commentCol, value: item.comment })
      }

      pending.push({ row, writes })
      for (const { column } of writes) {
        if (column > maxWriteCol) maxWriteCol = column
      }
    }

    // 每 50 行更新一次状态并让出事件循环，避免 UI 卡死
    if ((index + 1) % 50 === 0) {
      setStatus(`正在填充收藏数据：${String(index + 1)}/${String(total)}`, 'info')
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    }
  }

  let written = 0
  if (pending.length === 0) return written

  // 2. 旧值基底：整个写入区间一次矩形读（保留原始类型，数字/日期列不被 String() 化）
  const firstRow = pending[0]?.row ?? 0
  const lastRow = pending.at(-1)?.row ?? 0
  const oldRows =
    maxWriteCol > 0 ? readRangeCellValues(worksheet, firstRow, lastRow, 1, maxWriteCol) : []
  const oldValueAt = (row: number, column: number): WpsCellValue =>
    oldRows[row - firstRow]?.[column - 1] ?? null

  // 3. 连续行分批矩形写；批写失败回退该批逐格 setCellValue
  let batchStart = 0
  while (batchStart < pending.length) {
    let batchEnd = batchStart
    while (
      batchEnd + 1 < pending.length &&
      (pending[batchEnd + 1]?.row ?? 0) === (pending[batchEnd]?.row ?? 0) + 1 &&
      batchEnd - batchStart + 1 < FILL_BATCH_ROWS
    ) {
      batchEnd += 1
    }
    const batch = pending.slice(batchStart, batchEnd + 1)
    const batchFirstRow = batch[0]?.row ?? 0
    const batchLastRow = batch.at(-1)?.row ?? 0

    const values: WpsCellValue[][] = batch.map(({ row, writes }) => {
      const line: WpsCellValue[] = []
      for (let column = 1; column <= maxWriteCol; column += 1) {
        const override = writes.find((write) => write.column === column)
        line.push(override ? (override.value as WpsCellValue) : oldValueAt(row, column))
      }
      return line
    })

    let isBatchOk = false
    if (maxWriteCol > 0) {
      try {
        const range = worksheet.Range(
          `${columnNumberToLetter(1)}${String(batchFirstRow)}:${columnNumberToLetter(maxWriteCol)}${String(batchLastRow)}`,
        )
        range.Value2 = values
        isBatchOk = true
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[_fillSheetWithCollections] 批量写入第 ${String(batchFirstRow)}-${String(batchLastRow)} 行失败，回退逐格写入: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else {
      // 无可写列：旧行为同样一行都不写且全部计 written
      isBatchOk = true
    }

    if (isBatchOk) {
      written += batch.length
    } else {
      // 回退路径与旧实现逐字一致：逐格 setCellValue，统计失败行
      for (const { row, writes } of batch) {
        let isRowOk = true
        for (const { column, value } of writes) {
          if (!setCellValue(worksheet, row, column, value)) {
            isRowOk = false
          }
        }
        if (isRowOk) written += 1
      }
    }

    batchStart = batchEnd + 1
  }

  setStatus(`收藏数据填充完成：${String(written)}/${String(total)}`, 'info')
  return written
}

// ========== 从面板同步（异步，带进度条） ==========

/**
 * 准备同步所需的数据与工作表（步骤 1-10）。
 * 任何检查失败时返回 null（已显示相应提示）。
 */
function prepareSyncFromPanel(): SyncPreparedData | null {
  // 防重入检查已由 syncFromPanel 入口的 enterRunningState() 处理，此处不再重复
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] ========== 开始执行同步操作 ==========')

  // 1. 检查必要函数是否加载
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤1: 检查必要函数是否加载')
  if (
    typeof findHeaderRow !== 'function' ||
    typeof getColumnMap !== 'function' ||
    typeof getLastRow !== 'function'
  ) {
    bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 必要函数未加载完成')
    showAlert(_T.loadingWait)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（函数未加载），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return null
  }

  // 2. 检查 Token
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤2: 检查 Token')
  const token = loadBgToken()
  if (!token) {
    bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] Token 未设置')
    showAlert(_T.pleaseSetBgmToken)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（Token未设置），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return null
  }
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] Token 已设置（长度: ${String(token.length)}）`)

  // 3. 获取应用和工作表对象
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3: 获取应用和工作表对象')
  const app = getApp()
  if (!app?.ActiveWorkbook) {
    bgmLog(LOG_LEVELS.ERROR, '[syncFromPanel] 无法获取 Application 对象')
    showAlert('无法获取 Application 对象！')
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（无法获取Application），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return null
  }
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] Application 对象获取成功')

  // 3.1 记住用户当前活动的工作表
  let originalActiveSheet: WpsWorksheet | null = null
  try {
    originalActiveSheet = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 记住用户当前工作表: ${originalActiveSheet.Name}`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 获取当前工作表失败: ${(error as Error).message}`)
  }

  // 3.2 确保同步记录工作表存在（不激活）
  let syncSheet: WpsWorksheet | null = null
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3.2: 确保同步记录工作表存在')
  if (typeof getOrCreateSyncRecordSheet === 'function') {
    syncSheet = getOrCreateSyncRecordSheet()
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 同步记录工作表已创建/获取（暂不激活）')
  }

  // 4. 获取数据工作表并激活（确保筛选检测正确）
  const worksheet = getDataSheet()
  if (!worksheet) {
    bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到数据工作表')
    showAlert('未找到数据工作表，请先锁定工作表。')
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（未找到数据工作表），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return null
  }
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 数据工作表获取成功')

  try {
    worksheet.Activate()
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活数据工作表: ${worksheet.Name}（用于筛选检测）`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活数据工作表失败: ${(error as Error).message}`)
  }

  // 5. 解析表头和列映射
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤5: 解析表头和列映射')
  const headerRow = findHeaderRow(worksheet)
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 表头行: ${String(headerRow)}`)

  const lastRow = getLastRow(worksheet)
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 最后一行: ${String(lastRow)}`)

  const columnMap = getColumnMap(worksheet, headerRow)
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 列映射完成，共 ${String(columnMap.size)} 列`)

  if (!columnMap.has('Bangumi_URL')) {
    bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到 Bangumi_URL 列')
    showAlert('未找到 "Bangumi URL" 列！')
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（缺少Bangumi_URL列），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return null
  }

  // 6. 增量同步开关（直接读配置；主面板已不再有该复选框，避免在设置页一处改动后不同步）
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤6: 检查增量同步设置')
  const isIncremental = isIncrementalSyncEnabled()
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步: ${isIncremental ? '开启' : '关闭'}`)

  // 构建增量同步的指纹映射
  let fingerprintMap: Map<string, string> | undefined
  if (isIncremental) {
    const allRecords = getAllSyncRecords()
    fingerprintMap = new Map()
    for (const r of allRecords) {
      if (r.sid && r.fingerprint) {
        fingerprintMap.set(r.sid, r.fingerprint)
      }
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 增量同步模式：已加载 ${String(fingerprintMap.size)} 条历史指纹`,
    )
  }

  return {
    worksheet,
    columnMap,
    token,
    lastRow,
    headerRow,
    incremental: isIncremental,
    fingerprintMap,
    originalActiveSheet,
    syncSheet,
    app,
    startTime,
  }
}

/**
 * 冲突确认与执行同步（步骤 11-16）。
 * @returns true 表示同步已执行（成功或异常），false 表示用户取消。
 */
async function confirmAndExecuteSync(prepared: SyncPreparedData): Promise<boolean> {
  const {
    worksheet,
    columnMap,
    token,
    lastRow,
    headerRow,
    incremental,
    fingerprintMap,
    syncSheet,
    app,
    startTime,
  } = prepared

  // 7. 获取同步预览统计（传入增量同步选项）
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤7: 获取同步预览统计')
  const preview = getSyncPreview(worksheet, columnMap, lastRow, headerRow, {
    incremental,
    ...(fingerprintMap !== undefined && { fingerprintMap }),
  })
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncFromPanel] 数据预览 - 总行数: ${String(preview.total)}, 有效: ${String(preview.valid)}, 已上传: ${String(preview.alreadyUploaded)}, 待同步: ${String(preview.plannedSyncCount)}, 跳过: ${String(preview.plannedSkipCount)}, 无URL: ${String(preview.noUrl)}, 空状态: ${String(preview.emptyStatus)}, 增量跳过: ${String(preview.incrementalSkipped)}`,
  )

  // 8. 冲突检测与策略
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤8: 冲突检测')
  const conflictSelect = document.getElementById('conflictStrategy') as HTMLSelectElement | null
  const conflictStrategy = conflictSelect?.value || 'skip' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
  bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突策略: ${conflictStrategy}`)

  let conflictSids: Set<string> | undefined
  let conflictMessage = ''
  try {
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 开始检测冲突...')
    const { conflicts, conflictCount } = await detectConflicts(
      worksheet,
      columnMap,
      lastRow,
      headerRow,
      token,
    )
    if (conflictCount > 0) {
      bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 检测到 ${String(conflictCount)} 条冲突`)
      if (conflictStrategy === 'skip') {
        conflictSids = new Set(conflicts.map((c) => c.sid))
        conflictMessage = `检测到 ${String(conflictCount)} 条冲突，已选择【跳过冲突】。\n\n`
        bgmLog(
          LOG_LEVELS.INFO,
          `[syncFromPanel] 冲突处理策略: 跳过 ${String(conflictCount)} 条冲突条目`,
        )
      } else {
        conflictMessage = `检测到 ${String(conflictCount)} 条冲突，将使用【Excel数据覆盖】。\n\n`
        bgmLog(
          LOG_LEVELS.INFO,
          `[syncFromPanel] 冲突处理策略: 使用Excel数据覆盖 ${String(conflictCount)} 条冲突`,
        )
      }
    } else {
      bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 未检测到冲突')
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 冲突检测失败: ${(error as Error).message}`)
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.WARN,
      context: 'syncFromPanel',
    })
  }

  // 9. 确认对话框
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤9: 显示确认对话框')
  const message = `数据预览：
            总行数：${String(preview.total)}
            有效条目：${String(preview.valid)}
            已上传（跳过）：${String(preview.alreadyUploaded)}
            待同步：${String(preview.plannedSyncCount)}
            不上传（状态跳过）：${String(preview.plannedSkipCount)}
            无URL：${String(preview.noUrl)}
            空状态：${String(preview.emptyStatus)}
            ${incremental ? `增量跳过：${String(preview.incrementalSkipped)}\n` : ''}${conflictMessage}是否继续同步？\n\n同步开始后将切换到同步记录工作表查看进度。`

  const isConfirmed = await confirmAsync(message)
  if (!isConfirmed) {
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 用户取消同步')
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] 同步操作终止（用户取消），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return false
  }

  // 10. 切换到同步记录工作表，让用户看到实时写入
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤10: 切换到同步记录工作表')
  if (syncSheet) {
    try {
      syncSheet.Activate()
      bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活同步记录工作表: ${syncSheet.Name}`)
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活同步记录工作表失败: ${(error as Error).message}`)
    }
  }

  // 11. 执行同步
  bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤11: 开始执行同步')
  try {
    const syncFromPanelConfig: SyncConfigSummary = buildSyncConfig({
      source: '当前工作表',
      strategy: conflictStrategy === 'skip' ? '跳过冲突' : '覆盖冲突',
      direction: 'Excel → Bangumi',
      extra: [
        { label: '数据范围', value: `第${String(headerRow + 1)}~${String(lastRow)}行` },
        { label: '增量同步', value: incremental ? '开启' : '关闭' },
        { label: '冲突数', value: conflictMessage ? String(conflictSids?.size ?? 0) : '0' },
      ],
    })
    showSyncProgressDialog(
      '正在同步 - 同步到 Bangumi',
      createSyncControlHandlers(BGM.sync),
      syncFromPanelConfig,
    )
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 调用 SyncToBangumiAsync...')
    // StatusBar 节流（200ms）：逐行赋值 = 逐行一次 COM 往返
    const statusBar = createStatusBarWriter(app)
    const result = await SyncToBangumiAsync(worksheet, columnMap, token, lastRow, headerRow, {
      ...(conflictSids !== undefined && { skipSids: conflictSids }),
      incremental,
      onProgress: (current: number, total: number, statusMessage: string) => {
        updateSyncProgressDialog(current, total, statusMessage)
        statusBar.write(`[${String(current)}/${String(total)}] ${statusMessage}`)
        bgmLog(
          LOG_LEVELS.INFO,
          `[syncFromPanel] 同步进度: ${String(current)}/${String(total)} - ${statusMessage}`,
        )
      },
    })
    // 切换弹窗为完成状态并展示统计
    presentUploadResult(result, startTime)
    if (app.StatusBar !== undefined) app.StatusBar = false

    if (result.stopped) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromPanel] 同步已被用户停止！成功: ${String(result.success)}, 失败: ${String(result.fail)}, 跳过: ${String(result.skip)}`,
      )
    } else {
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromPanel] 同步完成！成功: ${String(result.success)}, 失败: ${String(result.fail)}, 跳过: ${String(result.skip)}`,
      )
    }
  } catch (error: unknown) {
    hideSyncProgressDialog()
    if (app.StatusBar !== undefined) app.StatusBar = false
    bgmLog(LOG_LEVELS.ERROR, `[syncFromPanel] 同步失败: ${(error as Error).message}`)
    BGM.handleError(error, { context: 'syncFromPanel', showAlert: true })
  } finally {
    BGM.sync.exitRunningState()
  }

  return true
}

export async function syncFromPanel(): Promise<void> {
  // 防重入检查：在执行任何耗时操作前就获取运行锁，避免预览/冲突检测期间用户重复点击
  if (!BGM.sync.enterRunningState()) {
    bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 同步正在进行中，拒绝重入')
    showAlert('同步正在进行中，请稍后再试', '提示')
    return
  }
  const prepared = prepareSyncFromPanel()
  if (prepared === null) {
    BGM.sync.exitRunningState()
    return
  }
  const isCompleted = await (async (): Promise<boolean> => {
    try {
      return await confirmAndExecuteSync(prepared)
    } finally {
      // 兜底释放运行锁（正常完成/异常路径已由 confirmAndExecuteSync 释放，此处仅处理用户取消的情况）
      if (BGM.sync.isRunning) {
        BGM.sync.exitRunningState()
      }
      // 无论成功失败或取消，最后都尝试恢复用户之前的工作表
      if (prepared.originalActiveSheet) {
        try {
          prepared.originalActiveSheet.Activate()
          bgmLog(
            LOG_LEVELS.INFO,
            `[syncFromPanel] 已恢复用户之前的工作表: ${prepared.originalActiveSheet.Name}`,
          )
        } catch (error: unknown) {
          bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 恢复工作表失败: ${(error as Error).message}`)
        }
      }
    }
  })()
  if (isCompleted) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromPanel] ========== 同步操作结束，总耗时: ${String(Date.now() - prepared.startTime)}ms ==========`,
    )
  }
}

// ========== 从BGM同步收藏标记 ==========

export function syncCollectionFromBgm(): void {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] ========== 开始从 BGM 同步收藏标记 ==========')

  const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
  // parseInt 失败返回 NaN（非 nullish），`??` 兜不住，须显式 isFinite 兜底
  const parsedSheetIndex = BGM.sheet.lockedIndex ?? Math.trunc(Number(select?.value ?? ''))
  const sheetIndex = Number.isFinite(parsedSheetIndex) ? parsedSheetIndex : 1
  bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 目标工作表索引: ${String(sheetIndex)}`)

  // 默认收藏列表类型已收拢到设置页；直接读配置，避免主面板缺失该下拉时取不到值
  const listType = getListType()
  const typeLabelMap = { collect: '已看', wish: '想看', do: '在看' }
  // 设置页「全部收藏」等价于不限定 type（syncFromBgmByAPI 以 null/undefined 表示全部）
  const listTypeLabel = listType === 'all' ? '全部' : typeLabelMap[listType]
  bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 收藏类型: ${listTypeLabel}`)

  const token = loadBgToken()
  if (!token) {
    bgmLog(LOG_LEVELS.WARN, '[syncCollectionFromBgm] Token 未设置')
    showAlert(_T.pleaseSetBgmToken)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncCollectionFromBgm] 操作终止（Token未设置），耗时: ${String(Date.now() - startTime)}ms`,
    )
    return
  }
  bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] Token 已设置（长度: ${String(token.length)}）`)

  try {
    bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] 调用 syncFromBgmByAPI...')
    syncFromBgmByAPI(sheetIndex, listType === 'all' ? null : listType)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncCollectionFromBgm] 同步完成，耗时: ${String(Date.now() - startTime)}ms`,
    )
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[syncCollectionFromBgm] 同步失败: ${(error as Error).message}`)
    BGM.handleError(error, { context: 'syncCollectionFromBgm', showAlert: true })
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[syncCollectionFromBgm] ========== 操作结束，总耗时: ${String(Date.now() - startTime)}ms ==========`,
  )
}

export function syncFromBgmByAPI(
  sheetIndex: number,
  type?: 'collect' | 'wish' | 'do' | null,
): void {
  const token = loadBgToken()
  if (!token) {
    showAlert(_T.pleaseSetBgmToken)
    showTokenDialog('')
    return
  }
  const typeLabelMap = { collect: '已看', wish: '想看', do: '在看' }
  const typeLabel = type ? typeLabelMap[type] : '全部'
  showConfirm(
    `将 从 BGM API 获取你的${typeLabel}收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？`,
    (confirmed) => {
      if (confirmed) {
        void _doAPISync(sheetIndex, token, type)
      }
    },
  )
}

async function _doAPISync(
  sheetIndex: number,
  token: string,
  type?: 'collect' | 'wish' | 'do' | null,
): Promise<void> {
  const syncStartTs = Date.now()

  // 记住原始活动工作表
  const app = getApp()
  if (!app?.ActiveWorkbook) {
    showAlert('无法获取 Application')
    return
  }
  let originalActiveSheet: WpsWorksheet | null = null
  try {
    originalActiveSheet = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 记住原始工作表: ${originalActiveSheet.Name}`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 获取原始工作表失败: ${(error as Error).message}`)
  }

  // 获取同步记录工作表
  const syncSheet: WpsWorksheet | null =
    typeof getOrCreateSyncRecordSheet === 'function' ? getOrCreateSyncRecordSheet() : null

  const worksheet = app.ActiveWorkbook.Worksheets.Item(sheetIndex)

  // 1. 验证 Token 并获取收藏列表
  setStatus('正在验证 Token...', 'info')
  const verifyResult = await verifyToken(token)
  if (!verifyResult.valid) {
    showAlert(`✘ ${verifyResult.message}`)
    return
  }
  _setBgmUserId(verifyResult.userId ?? '')

  setStatus('正在获取收藏列表...', 'info')
  const collectionOptions: {
    limit?: number
    maxTotal?: number
    type?: 'collect' | 'wish' | 'do' | null
    onProgress?: (page: number, total: number) => void
  } = {}
  if (type) collectionOptions.type = type
  const userCollections = await fetchAllUserCollections(token, undefined, collectionOptions)

  // 2. 解析表头与空表检测
  // §5.6 C3：barrel 已统一到 tools/util/index.js，不存在「另一条 specifier 拿到
  // undefined」的风险；此前的 typeof 死守卫（: 1 / : 200 / : new Map）会静默产出
  // 错误默认值，已删除。函数缺失的模块加载竞态由 syncFromPanel 入口的早退守卫兜住。
  let headerRow = findHeaderRow(worksheet)
  let columnMap = getColumnMap(worksheet, headerRow)
  let lastRow = getLastRow(worksheet)

  // 空表时提供从 Bangumi API 自动填充
  if (headerRow === 0 || lastRow <= headerRow) {
    if (userCollections.length === 0) {
      bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 工作表为空且 Bangumi 账号无收藏数据')
      showAlert('当前工作表为空，且 Bangumi 账号暂无收藏数据，无法填充。')
      return
    }

    const isConfirmed = await confirmAsync(
      `当前工作表为空，是否从 Bangumi 收藏列表自动填充 ${String(userCollections.length)} 条条目？`,
    )
    if (!isConfirmed) {
      bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 用户取消空表填充')
      return
    }

    // 缺少表头时先写入标准表头
    if (headerRow === 0 || !columnMap.has('Bangumi_URL')) {
      if (!ensureSheetHeaders(worksheet)) {
        showAlert('工作表为空且无法写入标准表头，请检查工作表状态。')
        return
      }
      clearSheetCache(worksheet)
      headerRow = findHeaderRow(worksheet)
      columnMap = getColumnMap(worksheet, headerRow)
      if (headerRow === 0 || !columnMap.has('Bangumi_URL')) {
        showAlert('写入标准表头后仍未找到 Bangumi URL 列，请检查模板。')
        return
      }
    }

    setStatus('正在填充收藏数据到 Excel...', 'info')
    const filledCount = await _fillSheetWithCollections(
      worksheet,
      userCollections,
      headerRow,
      columnMap,
    )
    if (filledCount === 0) {
      showAlert('未能写入任何收藏数据，请检查工作表是否可编辑。')
      return
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[_doAPISync] 空表填充完成：${String(filledCount)}/${String(userCollections.length)}`,
    )

    // 重新计算待处理行（§5.6 C3：barrel 已统一，直接调用）
    clearSheetCache(worksheet)
    lastRow = getLastRow(worksheet, true, headerRow)
    headerRow = findHeaderRow(worksheet)
    columnMap = getColumnMap(worksheet, headerRow)
  }

  // 3. 必须有 Bangumi_URL 列
  if (!columnMap.has('Bangumi_URL')) {
    showAlert('未找到 Bangumi URL 列！')
    return
  }

  const rowsToProcess: number[] = []
  for (let r = headerRow + 1; r <= lastRow; r += 1) rowsToProcess.push(r)

  if (rowsToProcess.length === 0) {
    showAlert('没有需要处理的数据行！')
    return
  }

  const collectionMap = new Map<string, BangumiCollectionItem>()
  for (const c of userCollections) {
    collectionMap.set(String(c.subject_id), c)
  }

  // 切换到同步记录工作表，让用户能看到实时写入
  if (syncSheet) {
    try {
      syncSheet.Activate()
      bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已激活同步记录工作表: ${syncSheet.Name}`)
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 激活同步记录工作表失败: ${(error as Error).message}`)
    }
  }

  let syncRecords: SyncRecord[] = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : []
  const syncCountMap = new Map<string, number>()
  for (const r of syncRecords)
    syncCountMap.set(r.sid ?? '', (syncCountMap.get(r.sid ?? '') ?? 0) + 1)

  // 使用从 ../index.js 导入的 BGM_SUBJECT_TYPES 常量（与 core/constants.ts 中定义一致）
  // 启动同步状态机：使用 enterRunningState 进行防重入检查
  if (!BGM.sync.enterRunningState()) {
    bgmLog(LOG_LEVELS.WARN, '[_doAPISync] 已有同步进行中，拒绝重入')
    showAlert('同步正在进行中，请稍后再试', '提示')
    return
  }
  const runApiSyncFlow = async (): Promise<void> => {
    const collectionConfig: SyncConfigSummary = buildSyncConfig({
      source: 'Bangumi 收藏列表',
      strategy: '收藏下载',
      direction: 'Bangumi → Excel',
      extra: [
        { label: '收藏条目', value: String(userCollections.length) },
        { label: '待处理行', value: String(rowsToProcess.length) },
      ],
    })
    showSyncProgressDialog('正在收藏下载', createSyncControlHandlers(BGM.sync), collectionConfig)

    // 两阶段进度合并：累计 total，避免阶段切换时进度条从 100% 回退到 0%
    const totalCollect = userCollections.length
    const totalRows = rowsToProcess.length
    const totalCombined = totalCollect + totalRows
    let currentCombined = 0

    // 阶段1：写入收藏到同步记录表（显示进度，但不需要定位单元格）
    // 先累积、循环外一次性批量写入：逐条 addSyncRecord 会在每次写入前触发全表去重扫描（O(n²) COM 调用）
    const pendingSyncRecords: UpdateRecordParameters[] = []
    for (const [index, item] of userCollections.entries()) {
      if (BGM.sync.checkShouldStop()) break
      if (BGM.sync.checkPaused()) await BGM.sync.waitForResume()
      if (BGM.sync.checkShouldStop()) break

      const itemName = item.subject?.name_cn || item.subject?.name || '(无名称)' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- API 字段空串需退到备用字段（`??` 会保留空串）
      pendingSyncRecords.push({
        name: itemName,
        url: `https://bgm.tv/subject/${String(item.subject_id)}`,
        sid: String(item.subject_id),
        type: BGM_SUBJECT_TYPES[item.subject_type ?? 2] ?? '',
        content: '标记同步',
        status: '成功',
        count: 1,
        collType: COLLECTION_TYPE_NAMES[item.type] ?? '',
      })
      currentCombined += 1
      updateSyncProgressDialog(
        currentCombined,
        totalCombined,
        `阶段1: 收藏写入同步记录 ${String(index + 1)}/${String(totalCollect)}`,
        `📥 [${String(index + 1)}/${String(totalCollect)}] ${itemName}`,
      )
    }

    if (typeof addSyncRecords === 'function' && !addSyncRecords(pendingSyncRecords)) {
      // 失败必须让用户看见：收藏已同步到 Bangumi，但本地同步记录没落盘（P1-E）
      showToast(
        `同步记录写入失败：${String(pendingSyncRecords.length)} 条收藏未登记，请检查「同步记录」工作表`,
        'error',
      )
    }

    syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : []
    syncCountMap.clear()
    for (const r of syncRecords)
      syncCountMap.set(r.sid ?? '', (syncCountMap.get(r.sid ?? '') ?? 0) + 1)

    // 阶段2：在 Excel 数据表上标记已收藏的行（需要定位单元格）
    // 切换回数据工作表，便于暂停时定位
    try {
      worksheet.Activate()
      bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 阶段2：已切回数据工作表进行标记`)
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 切回数据工作表失败: ${(error as Error).message}`)
    }

    const urlCol = columnMap.get('Bangumi_URL')
    const seqColForLocate = columnMap.get('序列号') ?? 9
    BGM.sync.updatePosition(worksheet, 0, seqColForLocate)

    let matchedCount = 0
    for (const [index, row] of rowsToProcess.entries()) {
      if (BGM.sync.checkShouldStop()) {
        bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 阶段2：检测到停止请求，终止')
        break
      }
      if (BGM.sync.checkPaused()) {
        bgmLog(
          LOG_LEVELS.INFO,
          `[_doAPISync] 阶段2：已暂停，进度 ${String(index)}/${String(totalRows)}，等待恢复...`,
        )
        await BGM.sync.waitForResume()
        if (BGM.sync.checkShouldStop()) break
      }

      BGM.sync.updatePosition(undefined, row)

      const bgmUrlCell = urlCol === undefined ? null : getCell(worksheet, row, urlCol)
      const bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value ?? '')) : ''
      const sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : ''
      let isMatched = false
      if (sid && collectionMap.has(sid)) {
        const seqCol = columnMap.get('序列号') ?? 9
        const seqCell = getCell(worksheet, row, seqCol)
        if (seqCell?.Interior) {
          const syncCount = syncCountMap.get(sid) ?? 0
          if (syncCount === 1) {
            seqCell.Interior.Color = BGM_COLOR.BGM_SYNC
          } else if (syncCount === 2) {
            seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN
          } else {
            seqCell.Interior.Color = BGM_COLOR.DARK_GREEN
          }
        }
        matchedCount += 1
        isMatched = true
      }
      currentCombined += 1
      updateSyncProgressDialog(
        currentCombined,
        totalCombined,
        `阶段2: 标记数据表 ${String(index + 1)}/${String(totalRows)}（匹配 ${String(matchedCount)}）`,
        isMatched
          ? `✓ [${String(index + 1)}/${String(totalRows)}] 行${String(row)} 匹配 SID=${sid ?? ''}`
          : `· [${String(index + 1)}/${String(totalRows)}] 行${String(row)} 未匹配`,
      )
    }

    // 输出同步统计
    const totalCollections = userCollections.length
    const wasStopped = BGM.sync.checkShouldStop()
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ========== 同步统计 ==========`)
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] BGM 收藏总数: ${String(totalCollections)}`)
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 数据表总行数: ${String(rowsToProcess.length)}`)
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 匹配标记数: ${String(matchedCount)}`)
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 同步记录条数: ${String(syncRecords.length)}`)
    bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ================================`)

    // 切换弹窗为完成状态
    const totalElapsed = Date.now() - syncStartTs
    const totalProcessed = matchedCount
    const avgSpeed =
      totalProcessed > 0 && totalElapsed > 0
        ? Math.round((totalProcessed / totalElapsed) * 1000)
        : 0
    const summary = `📊 BGM 收藏 ${String(totalCollections)} 条 | 数据表 ${String(rowsToProcess.length)} 行 | 耗时 ${formatDuration(totalElapsed)}\n\n✅ 匹配标记: ${String(matchedCount)}\n📝 同步记录: ${String(syncRecords.length)}`
    const detailsArray: string[] = [
      ...(wasStopped ? ['⚠️ 同步被用户停止'] : []),
      `BGM 收藏总数: ${String(totalCollections)}`,
      `数据表总行数: ${String(rowsToProcess.length)}`,
      `匹配标记数: ${String(matchedCount)}`,
      `同步记录条数: ${String(syncRecords.length)}`,
      `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
      `⚡️ 平均速度: ${avgSpeed > 0 ? `${String(avgSpeed)} 行/秒` : '--'}`,
    ]
    const stats: SyncProgressStats = {
      added: matchedCount,
      updated: 0,
      deleted: 0,
      unchanged: rowsToProcess.length - matchedCount,
      failed: 0,
      skipped: 0,
      remoteTotal: totalCollections,
      elapsedMs: totalElapsed,
      avgSpeed,
      strategyLabel: 'BGM 收藏同步',
    }
    completeSyncProgressDialog(summary, detailsArray, wasStopped, undefined, stats)

    // 恢复原始工作表
    if (originalActiveSheet) {
      try {
        originalActiveSheet.Activate()
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已恢复原始工作表: ${originalActiveSheet.Name}`)
      } catch (error: unknown) {
        bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 恢复原始工作表失败: ${(error as Error).message}`)
      }
    }
  }
  try {
    await runApiSyncFlow()
  } catch (error: unknown) {
    hideSyncProgressDialog()
    BGM.handleError(error, { showAlert: false, level: BGM.ErrorLevel.WARN, context: '_doAPISync' })
    showAlert(_T.syncFailed + (error as Error).message, _T.syncFailed)
    setStatus(_T.syncFailed, 'error')
  } finally {
    BGM.sync.exitRunningState()
    // 确保即使发生异常也尝试恢复原始工作表
    if (originalActiveSheet) {
      try {
        originalActiveSheet.Activate()
      } catch {
        // 静默处理恢复失败
      }
    }
  }
}

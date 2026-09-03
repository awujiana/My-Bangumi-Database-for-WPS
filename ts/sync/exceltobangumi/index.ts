/**
 * @fileoverview Excel到Bangumi同步模块 - 统一导出入口
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * 拆分结构：
 *   - exceltobangumi/api.ts：API 请求（bgmRequestSync、setBangumiToken、testTokenValidityForRibbon、openBangumiTokenPage、notifyUserInfoUpdated）
 *   - exceltobangumi/chapterMarker.ts：章节标记（fetchEpisodeIds、markEpisodesComplete）
 *   - exceltobangumi/progressReporter.ts：进度上报（SyncTask、applySyncSuccessResults、applySyncFailResults、handleStoppedRemainingTasks、finalizeSyncResults）
 *   - exceltobangumi/index.ts：常量、辅助函数、getFilterStatus、getSequentialRowsBySeqCol、buildJsonPayload、SyncToBangumiAsync、syncSelectedRows 等
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */

import { BGM_COLOR, LOG_LEVELS } from '../../core/constants.js'
import {
  bgmLog,
  getApp,
  getCell,
  trim,
  getColumnMap,
  findHeaderRow,
  colNumToLetter as colNumberToLetter,
  getCellValue,
  loadBgToken,
  BGM,
  _getUserApiPath,
  readRangeValues,
  delay,
  calcFingerprint,
  clearSheetCache,
} from '../../tools/util/index.js'
import type { WpsApplication as WpsApp, WpsWorksheet, WpsRange } from '../../tools/wps.js'
import { wpsMsgBox as wpsMessageBox, isWpsWorksheet } from '../../tools/wps.js'
import {
  showConfirm,
  showSyncProgressDialog,
  buildSyncConfig,
  updateSyncProgressDialog,
  completeSyncProgressDialog,
  hideSyncProgressDialog,
  showToast,
} from '../../ui/dialog.js'
import type { SyncConfigSummary } from '../../ui/dialog.js'
import {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  getSeqColIndex,
  addTagsFromStr as addTagsFromString,
} from '../pureUtils.js'
import { getAllSyncRecords, getOrCreateSyncRecordSheet } from '../syncRecord.js'

// 子模块内部依赖（不通过 re-export 暴露给外部）
import { bgmRequestSync as _bgmRequestSync } from './api.js'
import { markEpisodesComplete as _markEpisodesComplete } from './chapterMarker.js'
import {
  finalizeSyncResults as _finalizeSyncResults,
  DEFAULT_SEQ_COL as _DEFAULT_SEQ_COL,
} from './progressReporter.js'
import type {
  SyncTask as _SyncTask,
  SyncResultStats as _SyncResultStats,
} from './progressReporter.js'

// Re-export 纯函数，保持模块对外 API 兼容
export {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  getSeqColIndex,
  addTagsFromStr,
  buildTagsArray,
} from '../pureUtils.js'

// Re-export 子模块公开 API
export {
  openBangumiTokenPage,
  testTokenValidityForRibbon,
  bgmRequestSync,
  setBangumiToken,
  notifyUserInfoUpdated,
  type BgmApiResponse,
  extractResponseMessage,
  parseErrorResponse,
} from './api.js'

export { fetchEpisodeIds, markEpisodesComplete } from './chapterMarker.js'

export {
  type SyncTask,
  type SyncResultStats,
  TYPE_NAMES,
  DEFAULT_SEQ_COL,
  markSyncResultColor,
  applySyncSuccessResults,
  applySyncFailResults,
  handleStoppedRemainingTasks,
  finalizeSyncResults,
} from './progressReporter.js'

// ========== 常量定义 (优化点：集中管理) ==========
/** 批量读取时需要获取的列名 */
const BATCH_READ_COLUMNS = [
  'Bangumi_URL',
  '名称',
  '是否看完',
  '状态',
  '观看状态',
  '打分',
  '标签/分级',
  '原作标签',
  '完播日',
  '类别',
  '剧透/感言',
  '集号',
  '集数',
  '特点/印象',
] as const

/** 默认并发请求数 */
const DEFAULT_CONCURRENCY = 5
/** 请求最小间隔（毫秒） */
const MIN_REQUEST_INTERVAL = 100

// ========== 辅助函数 (优化点：拆分复用) ==========

/**
 * 检查单元格是否已标记为同步成功（颜色判断）
 * @param ws 工作表
 * @param row 行号
 * @param seqCol 序列号列索引（可选，默认4）
 */
function isCellMarkedSuccess(ws: WpsWorksheet, row: number, seqCol?: number): boolean {
  try {
    const col = seqCol || _DEFAULT_SEQ_COL
    const cell = getCell(ws, row, col)
    if (!cell?.Interior) return false
    const color = cell.Interior.Color
    return (
      color === BGM_COLOR.SUCCESS ||
      color === BGM_COLOR.LIGHT_GREEN ||
      color === BGM_COLOR.DARK_GREEN
    )
  } catch {
    return false
  }
}

/**
 * 批量读取数据并创建字段快速访问器
 * 优化点：集中批量读取，减少 COM 调用
 */
function createFieldGetter(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  startRow: number,
  lastRow: number,
): (row: number, key: string) => string {
  // 批量读取所有需要的数据列
  let maxCol = 1
  for (const key of BATCH_READ_COLUMNS) {
    if (colMap.has(key)) maxCol = Math.max(maxCol, colMap.get(key)!)
  }
  const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol)

  return (row: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    const rowIndex = row - startRow
    if (rowIndex >= 0 && rowIndex < allData.length) {
      const rowData = allData[rowIndex]
      if (Array.isArray(rowData) && col - 1 < rowData.length) {
        return trim(rowData[col - 1])
      }
    }
    // 回退到逐单元格读取
    return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key)!)) : ''
  }
}

// 以下纯函数（extractSubjectId / mapWatchStatus / addTagsFromStr / buildTagsArray）
// 已迁移至 ./pureUtils.js，通过顶部 import 与 re-export 引入。

/**
 * 获取筛选状态（可见行）
 * @param wsOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 wsOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export function getFilterStatus(
  wsOrLastRow?: WpsWorksheet | number,
  lastRow?: number,
  headerRow?: number,
  // true: 也检测非 AutoFilter 的隐藏行（性能开销）
  deepCheck?: boolean,
): {
  hasFilter: boolean
  visibleRows: number[]
  hiddenRows: number[]
} {
  const result = {
    hasFilter: false,
    visibleRows: [] as number[],
    hiddenRows: [] as number[],
  }

  try {
    const app = getApp()
    if (!app?.ActiveWorkbook) return result

    let ws: WpsWorksheet | null = null
    let effectiveLastRow: number | undefined
    let effectiveHeaderRow: number | undefined

    if (typeof wsOrLastRow === 'number') {
      effectiveLastRow = wsOrLastRow
      effectiveHeaderRow = lastRow
      ws = app.ActiveWorkbook.ActiveSheet
      bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（兼容模式）`)
    } else if (wsOrLastRow) {
      ws = wsOrLastRow
      effectiveLastRow = lastRow
      effectiveHeaderRow = headerRow
      bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用传入的工作表: ${ws.Name}`)
    } else {
      ws = app.ActiveWorkbook.ActiveSheet
      bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（无参数）`)
    }

    if (!isWpsWorksheet(ws)) return result

    let isAutoFilterMode = false
    try {
      isAutoFilterMode = !!ws.AutoFilterMode
    } catch (error: unknown) {
      BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `getFilterStatus: AutoFilterMode=${String(isAutoFilterMode)}, ws.Name=${ws.Name}, deepCheck=${String(deepCheck ?? '')}`,
    )

    // 2. 快速检测：仅在 deepCheck 时才扫描全范围
    //    旧用法（无 deepCheck）只查 AutoFilter，这是兼容的快速路径
    if (!isAutoFilterMode && !deepCheck) {
      bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 快速路径：无 AutoFilter')
      return result
    }

    // 3. 确定扫描范围（非 AutoFilter 模式需要全范围扫描隐藏行）
    const maxRow = effectiveLastRow && effectiveLastRow > 0 ? effectiveLastRow : ws.Rows.Count
    const scanRange = ws.Range(`A1:A${String(maxRow)}`)
    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 扫描范围 A1:A${String(maxRow)}`)

    // 4. 获取可见单元格来检测筛选/隐藏行
    let visibleCells: WpsRange | null = null
    if (isAutoFilterMode) {
      try {
        if (ws.AutoFilter?.Range) {
          visibleCells = ws.AutoFilter.Range.SpecialCells(12)
          bgmLog(LOG_LEVELS.INFO, `getFilterStatus: AutoFilter 模式`)
        }
      } catch (error: unknown) {
        BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
      }
    } else {
      // deepCheck 模式：用全范围检测手动隐藏行
      try {
        visibleCells = scanRange.SpecialCells(12)
      } catch {
        /* 所有行可见时抛出异常，忽略 */
      }
    }

    if (!visibleCells) {
      bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 无筛选')
      return result
    }

    // 5. 快速判断：可见行数 ≈ 总行数 → 无隐藏行（仅对非 AutoFilter 的 deepCheck 模式）
    if (!isAutoFilterMode) {
      try {
        const totalCount = scanRange.Count
        const visibleCount = visibleCells.Count
        if (visibleCount >= totalCount) {
          bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 所有 ${String(maxRow)} 行均可见，无筛选`)
          return result
        }
      } catch {
        /* Count 异常则继续走完整检测 */
      }
    }

    result.hasFilter = true

    // 6. 提取所有可见行号（去重）
    const rawRows = new Set<number>()
    const areas: WpsRange[] = []
    try {
      if (visibleCells.Areas) {
        for (let a = 1; a <= visibleCells.Areas.Count; a += 1) {
          areas.push(visibleCells.Areas.Item(a))
        }
      } else {
        areas.push(visibleCells)
      }
    } catch (error: unknown) {
      BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
      areas.push(visibleCells)
    }

    for (const area of areas) {
      const rows = area.Rows
      for (let r = 1; r <= rows.Count; r += 1) {
        rawRows.add(rows.Item(r).Row)
      }
    }
    bgmLog(LOG_LEVELS.INFO, `SpecialCells 收集到 ${String(rawRows.size)} 个原始行号`)
    const rowList = Array.from(rawRows).sort((a, b) => a - b)
    // 仅打印行号摘要，不逐行读取单元格值（避免大量 COM 调用导致卡顿）
    bgmLog(
      LOG_LEVELS.INFO,
      `  前 ${String(Math.min(rowList.length, 10))} 行: ${rowList.slice(0, 10).join(', ')}`,
    )
    if (rowList.length > 10) {
      bgmLog(LOG_LEVELS.INFO, `  ... 剩余 ${String(rowList.length - 10)} 行省略`)
    }

    // 6. 生成最终可见行列表（排除表头行）
    for (const r of rawRows) {
      if (!(effectiveHeaderRow != null && r === effectiveHeaderRow)) {
        result.visibleRows.push(r)
      }
    }
    result.visibleRows.sort((a, b) => a - b)

    bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${String(result.visibleRows.length)} 行`)
    if (result.visibleRows.length > 0) {
      bgmLog(LOG_LEVELS.INFO, `可见行前10: ${result.visibleRows.slice(0, 10).join(',')}`)
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
  }

  return result
}

/**
 * 根据序列号列获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @param {Map<string, number>} [colMap] - 列映射（可选）
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描序列号列，找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export function getSequentialRowsBySeqCol(
  startRow: number,
  endRow: number,
  colMap?: Map<string, number>,
): { validRows: number[]; seqMap: Map<string, number> } {
  const result = {
    validRows: [] as number[],
    seqMap: new Map<string, number>(),
  }

  try {
    const app = getApp()
    if (!app?.ActiveWorkbook) return result

    const ws = app.ActiveWorkbook.ActiveSheet

    const seqCol = getSeqColIndex(colMap)
    for (let r = startRow; r <= endRow; r += 1) {
      try {
        const value = getCellValue(ws, r, seqCol)
        if (value !== '') {
          const seqNumber = value.trim()
          if (/^\d+$/.test(seqNumber)) {
            result.validRows.push(r)
            result.seqMap.set(seqNumber, r)
          }
        }
      } catch (error: unknown) {
        BGM.handleError(error, { context: 'getSequentialRowsBySeqCol', showAlert: false })
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getSequentialRowsBySeqCol', showAlert: false })
  }

  return result
}

/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param {WpsWorksheet} ws - 工作表对象
 * @param {number} rowNum - 数据行号
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} finishedDate - 完播日期
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、private（是否私有）
 */
export function buildJsonPayload(getField: (key: string) => string, _finishedDate: string): string {
  try {
    const payload: Record<string, unknown> = {}

    // 观看状态 - 支持多种列名
    const statusKeys = ['是否看完', '状态', '观看状态', '收藏类型', 'type']
    let isStatusFound = false
    let rawStatusValue = ''
    for (const key of statusKeys) {
      const statusValue = trim(getField(key))
      if (statusValue) {
        rawStatusValue = statusValue
        const mappedStatus = mapWatchStatus(statusValue)
        if (mappedStatus > 0) {
          payload.type = mappedStatus
          isStatusFound = true
          bgmLog(
            LOG_LEVELS.INFO,
            `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusValue}" -> ${String(mappedStatus)}`,
          )
          break
        } else {
          bgmLog(
            LOG_LEVELS.WARN,
            `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusValue}" -> ${String(mappedStatus)} (无效)`,
          )
        }
      }
    }
    if (!isStatusFound) {
      if (rawStatusValue) {
        bgmLog(
          LOG_LEVELS.ERROR,
          `[buildJsonPayload] 未找到有效的观看状态，返回空对象，原始值: "${rawStatusValue}"`,
        )
        return '{}'
      }
      // 所有状态字段为空 → 默认视为「想看」(status=1)
      payload.type = 1
      bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 未找到观看状态，默认设为「想看」(type=1)`)
    }

    // 评分
    const rateValue = trim(getField('打分'))
    if (rateValue && rateValue !== 'true' && rateValue !== 'True') {
      const rate = parseFloat(rateValue)
      if (!isNaN(rate) && rate >= 0 && rate <= 10) {
        payload.rate = rate
      }
    }

    // 标签 - 合并 "标签/分级" 与 "原作标签" 两列
    const tagSet = new Set<string>()
    const tagsGradeValue = trim(getField('标签/分级'))
    const originalTagValue = trim(getField('原作标签'))
    if (tagsGradeValue) addTagsFromString(tagSet, tagsGradeValue)
    if (originalTagValue) addTagsFromString(tagSet, originalTagValue)
    if (tagSet.size > 0) {
      payload.tags = Array.from(tagSet)
      bgmLog(
        LOG_LEVELS.INFO,
        `[buildJsonPayload] 标签合并: 标签/分级="${tagsGradeValue || '(空)'}" + 原作标签="${originalTagValue || '(空)'}" -> ${JSON.stringify(payload.tags)}`,
      )
    }

    // 感言（支持 emoji、中文、日文等 UTF-8 字符；过滤控制字符并截断到 1000 字符）
    let commentValue = trim(getField('剧透/感言') || getField('感言'))
    const nValue = trim(getField('特点/印象'))
    bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 剧透/感言="${commentValue}", 特点/印象="${nValue}"`)
    if (nValue) {
      commentValue = commentValue ? `${commentValue}\n${nValue}` : nValue
    }
    if (commentValue) {
      // 移除控制字符（保留换行符 \n 和制表符 \t）
      // eslint-disable-next-line no-control-regex -- 有意匹配控制字符以清洗文本
      const cleaned = commentValue.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // Bangumi API comment 字段长度限制约 1000 字符，超出截断
      const MAX_COMMENT_LEN = 1000
      const finalComment =
        cleaned.length > MAX_COMMENT_LEN ? cleaned.slice(0, MAX_COMMENT_LEN) : cleaned
      if (finalComment) {
        payload.comment = finalComment
        if (cleaned.length > MAX_COMMENT_LEN) {
          bgmLog(
            LOG_LEVELS.WARN,
            `[buildJsonPayload] 感言长度 ${String(cleaned.length)} 超过 ${String(MAX_COMMENT_LEN)}，已截断`,
          )
        }
      }
    }

    // 隐私收藏
    const privateValue = trim(getField('私密收藏')).toLowerCase()
    if (privateValue === '是' || privateValue === '1' || privateValue === 'true') {
      payload.private = true
    }

    return JSON.stringify(payload)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'buildJsonPayload', showAlert: false })
    return '{}'
  }
}

/**
 * 同步选项接口
 */
export interface SyncOptions {
  /** 进度回调 */
  onProgress?: (current: number, total: number, message: string) => void
  /** 单条完成回调 */
  onItemComplete?: (
    row: number,
    success: boolean,
    result: { code: number; message: string },
  ) => void
  /** 需要跳过的SID集合（冲突处理） */
  skipSids?: Set<string>
  /** 是否启用增量同步（基于指纹） */
  incremental?: boolean
}
/**
 * 单行处理结果：task 有值表示需要同步；skipped/failed 互斥表示跳过或失败原因。
 */
interface RowProcessOutcome {
  task: _SyncTask | null
  skipped: boolean
  failed: boolean
}

/**
 * 获取可见行（数据获取层 - 步骤1）
 * 根据筛选状态确定需要处理的行号列表；无筛选时返回 [startRow, lastRow] 全量行。
 * @param ws 工作表
 * @param startRow 起始数据行
 * @param lastRow 最后一行
 * @param headerRow 表头行（用于排除）
 * @returns 待处理的行号数组
 */
function fetchVisibleRowsForSync(
  ws: WpsWorksheet,
  startRow: number,
  lastRow: number,
  headerRow: number,
): number[] {
  const filterStatus = getFilterStatus(ws, lastRow, headerRow, true)
  if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
    const rows = filterStatus.visibleRows.filter((r) => r >= startRow)
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 筛选模式：处理 ${String(rows.length)} 个可见行`)
    return rows
  }
  const rows: number[] = []
  for (let r = startRow; r <= lastRow; r += 1) rows.push(r)
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 总行数: ${String(rows.length)}`)
  return rows
}

/**
 * 构建历史指纹映射（数据获取层 - 步骤3）
 * 增量同步模式下从同步记录加载历史指纹，用于后续对比跳过未变更项。
 * @param incremental 是否启用增量同步
 * @returns 指纹映射（sid -> fingerprint）；未启用增量时返回 undefined
 */
function buildFingerprintMap(incremental: boolean | undefined): Map<string, string> | undefined {
  if (!incremental) return undefined
  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 正在加载历史同步记录...')
  const allRecords = getAllSyncRecords()
  const fingerprintMap = new Map<string, string>()
  for (const r of allRecords) {
    if (r.sid && r.fingerprint) {
      fingerprintMap.set(r.sid, r.fingerprint)
    }
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync] 增量同步模式：已加载 ${String(fingerprintMap.size)} 条历史指纹`,
  )
  return fingerprintMap
}

/**
 * 处理单行数据并转换为同步任务（业务处理层 - 步骤4循环体）
 * 校验链：URL → SID → 冲突跳过 → 观看状态 → 状态类型 → 指纹对比 → 颜色标记 → 构建 SyncTask。
 * 任何校验失败均返回 skipped=true；异常返回 failed=true。
 * @param ws 工作表
 * @param rowNum 当前行号
 * @param getField 字段访问器（基于批量缓存）
 * @param skipSids 需跳过的 SID 集合（冲突处理）
 * @param fingerprintMap 历史指纹映射（增量同步用）
 * @param seqCol 序列号列索引（用于颜色检查）
 * @returns 处理结果：task 有值表示需要同步
 */
function processRowToSyncTask(
  ws: WpsWorksheet,
  rowNum: number,
  getField: (row: number, key: string) => string,
  skipSids: Set<string> | undefined,
  fingerprintMap: Map<string, string> | undefined,
  seqCol: number,
): RowProcessOutcome {
  try {
    const bgmUrl = getField(rowNum, 'Bangumi_URL')
    if (!bgmUrl) return { task: null, skipped: true, failed: false }

    const sid = extractSubjectId(bgmUrl)
    if (!sid) return { task: null, skipped: true, failed: false }

    // 冲突跳过
    if (skipSids?.has(sid)) {
      return { task: null, skipped: true, failed: false }
    }

    // 读取观看状态（空状态视为「想看」，由 mapWatchStatus 返回 1）
    const watchStatusField =
      getField(rowNum, '是否看完') || getField(rowNum, '状态') || getField(rowNum, '观看状态')

    // 获取观看状态类型（空值 → 1=想看，未识别 → 0 跳过）
    const watchType = mapWatchStatus(watchStatusField)
    if (watchType === 0) {
      return { task: null, skipped: true, failed: false }
    }

    // 增量同步指纹检查（标签包含 标签/分级 + 原作标签，与 buildJsonPayload 保持一致）
    let currentFingerprint: string | undefined
    if (fingerprintMap) {
      currentFingerprint = calcFingerprint([
        getField(rowNum, '名称'),
        watchType.toString(),
        getField(rowNum, '打分'),
        getField(rowNum, '标签/分级'),
        getField(rowNum, '原作标签'),
        getField(rowNum, '剧透/感言'),
        getField(rowNum, '集数'),
        getField(rowNum, '集号'),
      ])

      const storedFingerprint = fingerprintMap.get(sid)
      if (storedFingerprint === currentFingerprint) {
        return { task: null, skipped: true, failed: false }
      }
    }

    // 检查已上传颜色（非增量模式）
    if (!fingerprintMap && isCellMarkedSuccess(ws, rowNum, seqCol)) {
      return { task: null, skipped: true, failed: false }
    }

    const finishedDate = getField(rowNum, '完播日')
    const jsonBody = buildJsonPayload((key) => getField(rowNum, key), finishedDate)
    const name = getField(rowNum, '名称')
    const epRaw = trim(getField(rowNum, '集数') || getField(rowNum, '集号') || '')
    const epNumber = parseInt(epRaw, 10)

    const task: _SyncTask = {
      rowNum,
      sid,
      bgmUrl,
      name,
      jsonBody,
      ...(currentFingerprint === undefined ? {} : { fingerprint: currentFingerprint }),
      type: watchType,
      ...(!isNaN(epNumber) && epNumber > 0 ? { epCount: epNumber } : {}),
    }

    return { task, skipped: false, failed: false }
  } catch (error: unknown) {
    BGM.handleError(error, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:preprocess' })
    return { task: null, skipped: false, failed: true }
  }
}

/**
 * 预处理同步任务（协调函数 - 步骤 1-4）
 * 协调 fetchVisibleRowsForSync → buildFingerprintMap → processRowToSyncTask 三个子步骤，
 * 完成筛选可见行、批量读取数据缓存、构建历史指纹映射、收集所有需要同步的任务。
 * @param ws 工作表
 * @param colMap 列映射
 * @param options 同步选项
 * @param startRow 起始数据行（headerRow + 1）
 * @param lastRow 最后一行
 * @param seqCol 序列号列索引
 * @returns 待同步任务列表及预处理阶段的跳过/失败计数
 */
function prepareSyncTasks(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  options: SyncOptions | undefined,
  startRow: number,
  lastRow: number,
  seqCol: number,
): { syncTasks: _SyncTask[]; skip: number; fail: number } {
  let skip = 0
  let fail = 0
  const headerRow = startRow - 1

  // 步骤1：获取可见行（数据获取）
  const rowsToProcess = fetchVisibleRowsForSync(ws, startRow, lastRow, headerRow)

  // 步骤2：批量读取数据缓存（性能关键）
  const getField = createFieldGetter(ws, colMap, startRow, lastRow)

  // 步骤3：构建历史指纹映射（数据获取）
  const fingerprintMap = buildFingerprintMap(options?.incremental)

  // 步骤4：预处理收集同步任务（业务处理）
  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤4: 预处理收集同步任务')
  const syncTasks: _SyncTask[] = []
  const skipSids = options?.skipSids

  for (const rowNumber of rowsToProcess) {
    const outcome = processRowToSyncTask(ws, rowNumber, getField, skipSids, fingerprintMap, seqCol)
    if (outcome.failed) {
      fail += 1
    } else if (outcome.skipped) {
      skip += 1
    } else if (outcome.task) {
      syncTasks.push(outcome.task)
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync] 预处理完成：${String(syncTasks.length)} 条待同步，${String(skip)} 条跳过（失败${String(fail)}条）`,
  )

  return { syncTasks, skip, fail }
}

/**
 * 批量执行同步请求（并发控制）
 * 优化点：提取独立函数，保留所有原有日志
 * @param tasks 同步任务列表
 * @param token API Token
 * @param userIdPath 用户路径
 * @param concurrency 并发数
 * @param onProgress 进度回调（current=已完成数, total=总数, message=描述）
 * @returns 成功和失败的任务列表以及是否停止
 */
async function batchSyncRequests(
  tasks: _SyncTask[],
  token: string,
  userIdPath: string,
  concurrency: number = DEFAULT_CONCURRENCY,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<{ success: _SyncTask[]; fail: _SyncTask[]; stopped: boolean }> {
  const success: _SyncTask[] = []
  const fail: _SyncTask[] = []
  let lastRequestTime = 0
  let isStopped = false
  const total = tasks.length

  const queue = [...tasks]
  const executing: { promise: Promise<void>; task: _SyncTask; done: boolean }[] = []

  while (queue.length > 0 || executing.length > 0) {
    if (BGM.sync.checkShouldStop()) {
      bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 检测到停止请求，正在停止...')
      isStopped = true
      if (executing.length > 0) {
        await Promise.all(executing.map((e) => e.promise))
      }
      break
    }

    // 暂停检查：如果用户请求暂停，等待恢复后再继续
    if (BGM.sync.checkPaused()) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[batchSyncRequests] 同步已暂停，剩余 ${String(queue.length)} 个任务，等待恢复...`,
      )
      await BGM.sync.waitForResume()
      if (BGM.sync.checkShouldStop()) {
        bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 暂停期间收到停止请求，正在停止...')
        isStopped = true
        if (executing.length > 0) {
          await Promise.all(executing.map((e) => e.promise))
        }
        break
      }
      bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 同步已恢复，继续处理')
    }

    while (executing.length < concurrency && queue.length > 0) {
      const task = queue.shift()!
      // 更新当前行号（工作表和列在调用方 SyncToBangumiAsync 中已通过 updatePosition 设置）
      BGM.sync.updatePosition(undefined, task.rowNum)
      const entry = { promise: null as unknown as Promise<void>, task, done: false }

      entry.promise = (async () => {
        try {
          const now = Date.now()
          const elapsed = now - lastRequestTime
          if (elapsed < MIN_REQUEST_INTERVAL) {
            await delay(MIN_REQUEST_INTERVAL - elapsed)
          }

          const apiResult = await _bgmRequestSync(
            'POST',
            `/v0/users${userIdPath}/collections/${task.sid}`,
            task.jsonBody,
            token,
          )
          lastRequestTime = Date.now()

          if (apiResult.code >= 200 && apiResult.code < 300) {
            success.push(task)
            bgmLog(
              LOG_LEVELS.INFO,
              `[batchSyncRequests] SID ${task.sid} 同步成功，HTTP ${String(apiResult.code)}`,
            )

            // 标记章节为已完成（仅"看过" type=2 需要标记章节；"在看" ）
            if (task.type === 2 && task.epCount && task.epCount > 0) {
              try {
                bgmLog(
                  LOG_LEVELS.INFO,
                  `[batchSyncRequests] SID ${task.sid} 状态"看过"(type=2)，集数: ${String(task.epCount)}，开始标记章节...`,
                )
                const epResult = await _markEpisodesComplete(task.sid, task.epCount, token)
                bgmLog(
                  LOG_LEVELS.INFO,
                  `[batchSyncRequests] SID ${task.sid} 章节标记结果: ${epResult.message}`,
                )
              } catch (error: unknown) {
                bgmLog(
                  LOG_LEVELS.WARN,
                  `[batchSyncRequests] SID ${task.sid} 章节标记异常: ${error instanceof Error ? error.message : String(error)}`,
                )
              }
            } else if (task.type === 3 && task.epCount && task.epCount > 0) {
              bgmLog(
                LOG_LEVELS.INFO,
                `[batchSyncRequests] SID ${task.sid} 状态"在看"(type=3)，跳过章节标记`,
              )
            } else if (task.epCount && task.epCount > 0) {
              bgmLog(
                LOG_LEVELS.INFO,
                `[batchSyncRequests] SID ${task.sid} 状态非"看过"(type=${String(task.type)})，跳过章节标记`,
              )
            }
          } else {
            fail.push(task)
            bgmLog(
              LOG_LEVELS.WARN,
              `[batchSyncRequests] SID ${task.sid} 同步失败，HTTP ${String(apiResult.code)}，消息: ${apiResult.message}`,
            )
          }
        } catch (error: unknown) {
          fail.push(task)
          bgmLog(
            LOG_LEVELS.ERROR,
            `[batchSyncRequests] SID ${task.sid} 同步异常: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          entry.done = true
          // 报告进度（每完成一个任务回调一次）
          if (onProgress) {
            const completed = success.length + fail.length
            try {
              onProgress(completed, total, `同步中 ${String(completed)}/${String(total)}`)
            } catch (error: unknown) {
              bgmLog(
                LOG_LEVELS.WARN,
                `[batchSyncRequests] onProgress 回调异常: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      })()

      executing.push(entry)
    }

    if (executing.length > 0) {
      await Promise.race(executing.map((e) => e.promise))
      for (let index = executing.length - 1; index >= 0; index -= 1) {
        if (executing[index]!.done) executing.splice(index, 1)
      }
    }
  }

  return { success, fail, stopped: isStopped }
}

/**
 * 批量执行同步请求（步骤 5）：创建同步记录表、设置同步状态机位置、调用 batchSyncRequests。
 * @param syncTasks 待同步任务列表
 * @param token API Token
 * @param userIdPath 用户 API 路径
 * @param options 同步选项
 * @param ws 工作表
 * @param headerRow 表头行
 * @param seqCol 序列号列索引
 * @returns 成功/失败任务列表及是否被停止
 */
async function executeBatchSync(
  syncTasks: _SyncTask[],
  token: string,
  userIdPath: string,
  options: SyncOptions | undefined,
  ws: WpsWorksheet,
  headerRow: number,
  seqCol: number,
): Promise<{ successTasks: _SyncTask[]; failTasks: _SyncTask[]; stopped: boolean }> {
  // 尝试创建同步记录表
  try {
    getOrCreateSyncRecordSheet()
  } catch (error: unknown) {
    BGM.handleError(error, {
      level: BGM.ErrorLevel.WARN,
      context: 'SyncToBangumiAsync:createSheet',
    })
  }

  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤5: 开始批量同步请求')
  // 设置同步状态机的当前位置（工作表 + 序列号列），供暂停时定位
  BGM.sync.updatePosition(ws, headerRow, seqCol)
  const {
    success: successTasks,
    fail: failTasks,
    stopped,
  } = await batchSyncRequests(
    syncTasks,
    token,
    userIdPath,
    DEFAULT_CONCURRENCY,
    options?.onProgress,
  )
  return { successTasks, failTasks, stopped }
}

export async function SyncToBangumiAsync(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  token: string,
  lastRow: number,
  headerRow: number,
  options?: SyncOptions,
): Promise<{ success: number; fail: number; skip: number; stopped: boolean }> {
  const result: _SyncResultStats = { success: 0, fail: 0, skip: 0, stopped: false }
  const startRow = headerRow + 1
  const startTime = Date.now()
  const seqCol = getSeqColIndex(colMap)
  const userIdPath = _getUserApiPath()

  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] ========== 开始批量同步 ==========')
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 配置参数：`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 增量同步模式: ${options?.incremental ? '开启' : '关闭'}`,
  )
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 跳过冲突数量: ${String(options?.skipSids?.size || 0)}`,
  )
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 表头行: ${String(headerRow)}`)
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 最后一行: ${String(lastRow)}`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 序列号列: ${String(seqCol)} (列${colNumberToLetter(seqCol)})`,
  )

  // 步骤 1-4: 预处理（筛选可见行 + 数据缓存 + 指纹映射 + 任务收集）
  const { syncTasks, skip, fail } = prepareSyncTasks(ws, colMap, options, startRow, lastRow, seqCol)
  result.skip = skip
  result.fail = fail

  // 步骤 5: 批量执行同步请求（并发控制）
  const { successTasks, failTasks, stopped } = await executeBatchSync(
    syncTasks,
    token,
    userIdPath,
    options,
    ws,
    headerRow,
    seqCol,
  )

  // 步骤 6: 批量更新 UI 和记录
  const reportProgress = (current: number, message: string) => {
    if (options?.onProgress) options.onProgress(current, syncTasks.length, message)
  }
  _finalizeSyncResults(
    ws,
    seqCol,
    successTasks,
    failTasks,
    syncTasks,
    stopped,
    result,
    startTime,
    reportProgress,
  )

  return result
}

/**
 * 从当前选中区域收集行号（含非连续区域 Areas 处理）
 * @param app WPS Application 对象
 * @returns 原始行号数组；若未选中或异常则返回空数组（已提示用户）
 */
function collectSelectedRows(app: WpsApp): number[] {
  const rawRows: number[] = []
  try {
    const sel = app.Selection
    if (!sel) {
      bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未选中任何区域')
      void wpsMessageBox('请先在Excel中选中要同步的数据行', 0, 48)
      return rawRows
    }

    // 记录选中区域地址用于调试
    let selAddress = ''
    try {
      selAddress = sel.Address ?? ''
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[exceltobangumi] 获取地址失败: ${error instanceof Error ? error.message : String(error)}`,
      )
      selAddress = '(无法获取)'
    }
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] Selection.Address: ${selAddress}`)

    // 处理非连续选择（多区域）
    const areas = sel.Areas
    const areaCount = areas?.Count ?? 1

    if (areaCount > 1 && areas) {
      // 非连续选择：遍历每个 Area 收集行号
      bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 检测到非连续选择，共 ${String(areaCount)} 个区域`)
      for (let ai = 1; ai <= areaCount; ai += 1) {
        const area = areas.Item(ai)
        const aStartRow = area.Row
        const aRowCount = area.Rows.Count
        for (let r = aStartRow; r < aStartRow + aRowCount; r += 1) {
          if (!rawRows.includes(r)) rawRows.push(r)
        }
      }
    } else {
      // 连续选择：直接读取
      const startRow = sel.Row
      const rowCount = sel.Rows.Count
      for (let r = startRow; r < startRow + rowCount; r += 1) {
        rawRows.push(r)
      }
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncSelectedRows] 选中区域: ${String(rawRows.length)} 行，行号 ${String(Math.min(...rawRows))}-${String(Math.max(...rawRows))}`,
    )
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'syncSelectedRows', showAlert: false })
    void wpsMessageBox('获取选中区域失败，请检查是否选中了有效区域', 0, 48)
    return []
  }
  return rawRows
}

/**
 * 校验选中行并准备同步所需数据（排除表头、阈值确认、构建列映射、加载 Token）
 * @param ws 工作表
 * @param rawRows 原始选中行号
 * @param headerRow 表头行号
 * @returns 准备结果（rows/colMap/token）；若校验失败则返回 null（已提示用户）
 */
async function validateSelectedRows(
  ws: WpsWorksheet,
  rawRows: number[],
  headerRow: number,
): Promise<{ rows: number[]; colMap: Map<string, number>; token: string } | null> {
  // 排除表头行
  const rows = rawRows.filter((r) => r > headerRow)
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] 排除表头后有效数据行: ${String(rows.length)} 行（原始选中 ${String(rawRows.length)} 行）`,
  )

  if (rows.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 排除表头后没有有效数据行')
    showToast('未选中任何数据行', 'warn')
    return null
  }

  // 选中行数超过阈值时弹出确认对话框
  if (rows.length > 10) {
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 选中 ${String(rows.length)} 行，弹出确认对话框`)
    const isConfirmed = await new Promise<boolean>((resolve) => {
      showConfirm(
        `选中了 ${String(rows.length)} 行数据，确认要同步全部吗？\n\n行号范围: ${String(Math.min(...rows))} - ${String(Math.max(...rows))}`,
        (result: boolean) => {
          resolve(result)
        },
        '批量同步确认',
      )
    })
    if (!isConfirmed) {
      bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 用户取消同步')
      void wpsMessageBox('已取消同步', 0, 64)
      return null
    }
  }

  clearSheetCache(ws)
  const colMap = getColumnMap(ws, headerRow)
  bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 列映射完成，共 ${String(colMap.size)} 列`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] 集数列号: ${String(colMap.get('集数') ?? '')}, 集号列号: ${String(colMap.get('集号') ?? '')}, Bangumi_URL列号: ${String(colMap.get('Bangumi_URL') ?? '')}`,
  )

  if (!colMap.has('Bangumi_URL')) {
    bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未找到 Bangumi_URL 列')
    void wpsMessageBox('未找到 Bangumi URL 列', 0, 48)
    return null
  }

  const token = loadBgToken()
  if (!token) {
    bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] Token 未设置')
    void wpsMessageBox('请先设置 Token', 0, 48)
    return null
  }
  bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] Token 已设置（长度: ${String(token.length)}）`)

  return { rows, colMap, token }
}

/**
 * 执行选中行同步（启动状态机、显示进度弹窗、循环同步、完成弹窗、异常处理、重置状态机）
 * @param ws 工作表
 * @param rows 待同步行号数组（已排除表头）
 * @param colMap 列映射
 * @param token Bangumi Token
 * @param headerRow 表头行号
 * @param startTime 同步开始时间戳（用于耗时统计）
 */
async function executeSelectedSync(
  ws: WpsWorksheet,
  rows: number[],
  colMap: Map<string, number>,
  token: string,
  headerRow: number,
  startTime: number,
): Promise<void> {
  let isEnteredRunning = false
  try {
    const urlCol = colMap.get('Bangumi_URL')!
    const nameCol = colMap.has('名称') ? colMap.get('名称')! : undefined
    const userPath = _getUserApiPath()

    let successCount = 0
    let failCount = 0
    let skipCount = 0
    let episodeMarkCount = 0
    const details: string[] = []

    // P2：进入运行状态（防重入 + 重置标志 + 置位）
    if (!BGM.sync.enterRunningState()) return
    isEnteredRunning = true
    const selectedRowsConfig: SyncConfigSummary = buildSyncConfig({
      source: '当前工作表',
      strategy: '选中行同步',
      direction: 'Excel → Bangumi',
      selectedRowsOnly: true,
      extra: [
        { label: '选中行数', value: String(rows.length) },
        {
          label: '行号范围',
          value:
            rows.length > 0
              ? `${String(rows[0] ?? '')}~${String(rows[rows.length - 1] ?? '')}`
              : '-',
        },
      ],
    })
    // P1：显示同步进度弹窗（新 API：handlers 对象，暂停状态由 dialog 内部管理）
    showSyncProgressDialog(
      '正在同步 - 选中行同步',
      {
        onPause: () => {
          BGM.sync.pause()
        },
        onResume: () => {
          BGM.sync.resume()
        },
        onStop: () => {
          BGM.sync.requestStop()
        },
      },
      selectedRowsConfig,
    )
    // 设置同步状态机位置（用于暂停时定位到单元格）
    BGM.sync.updatePosition(ws, 0, urlCol)

    for (let index = 0; index < rows.length; index += 1) {
      // 检查停止
      if (BGM.sync.checkShouldStop()) {
        bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 检测到停止请求，终止循环')
        break
      }
      // 暂停检查：等待恢复后再继续
      if (BGM.sync.checkPaused()) {
        bgmLog(
          LOG_LEVELS.INFO,
          `[syncSelectedRows] 同步已暂停，当前进度 ${String(index)}/${String(rows.length)}，等待恢复...`,
        )
        await BGM.sync.waitForResume()
        if (BGM.sync.checkShouldStop()) {
          bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 暂停期间收到停止请求，终止循环')
          break
        }
        bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 同步已恢复，继续处理')
      }

      const rowNumber = rows[index]!
      const rowProgress = `[${String(index + 1)}/${String(rows.length)}]`
      // 更新当前位置（行号），供暂停时定位
      BGM.sync.updatePosition(undefined, rowNumber)

      try {
        const bgmUrl = trim(getCellValue(ws, rowNumber, urlCol) || '')
        const name = nameCol
          ? trim(getCellValue(ws, nameCol === urlCol ? rowNumber : rowNumber, nameCol) || '')
          : ''

        if (bgmUrl)
          if (isBangumiUrl(bgmUrl)) {
            const sid = extractSubjectId(bgmUrl)
            if (sid) {
              bgmLog(
                LOG_LEVELS.INFO,
                `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 开始同步: 名称="${name || '无名'}", SID=${sid}, URL=${bgmUrl}`,
              )
              updateSyncProgressDialog(
                index + 1,
                rows.length,
                `${rowProgress} 行${String(rowNumber)} "${name || sid}" 同步中...`,
                `⏳ ${rowProgress} 行${String(rowNumber)} "${name || sid}" SID=${sid} 开始同步`,
              )

              const finishedDate = colMap.has('完播日')
                ? trim(getCellValue(ws, rowNumber, colMap.get('完播日')!) || '')
                : ''
              const jsonBody = buildJsonPayload(
                (key) =>
                  colMap.has(key) ? trim(getCellValue(ws, rowNumber, colMap.get(key)!)) : '',
                finishedDate,
              )

              if (jsonBody === '{}') {
                const message = `行${String(rowNumber)} "${name || sid}" 请求体为空，跳过`
                bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
                showToast(message, 'warn')
                details.push(`⊘ 行${String(rowNumber)} ${name || sid} 跳过: 请求体为空`)
                skipCount += 1
                updateSyncProgressDialog(
                  index + 1,
                  rows.length,
                  message,
                  `⊘ ${rowProgress} ${message}`,
                )
              } else {
                bgmLog(
                  LOG_LEVELS.INFO,
                  `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 请求体: ${jsonBody.length > 300 ? `${jsonBody.substring(0, 300)}...` : jsonBody}`,
                )

                const endpoint = `/v0/users${userPath}/collections/${sid}`
                const result = await _bgmRequestSync('POST', endpoint, jsonBody, token)

                if (result.code >= 200 && result.code < 300) {
                  successCount += 1
                  details.push(
                    `✓ 行${String(rowNumber)} ${name || sid} HTTP:${String(result.code)}`,
                  )
                  bgmLog(
                    LOG_LEVELS.INFO,
                    `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} "${name || sid}" 同步成功！HTTP: ${String(result.code)}`,
                  )
                  updateSyncProgressDialog(
                    index + 1,
                    rows.length,
                    `${rowProgress} 行${String(rowNumber)} "${name || sid}" ✓ HTTP:${String(result.code)}`,
                    `✓ ${rowProgress} 行${String(rowNumber)} "${name || sid}" 成功 HTTP:${String(result.code)}`,
                  )

                  // 标记章节为已完成（"看过" type=2 和 "在看" type=3 都需要标记）
                  let watchType = 0
                  try {
                    const parsedBody = JSON.parse(jsonBody) as { type?: number }
                    watchType = parsedBody.type ?? 0
                  } catch (error: unknown) {
                    bgmLog(
                      LOG_LEVELS.WARN,
                      `[syncSelectedRows] 行${String(rowNumber)} jsonBody 解析失败: ${error instanceof Error ? error.message : String(error)}`,
                    )
                  }
                  const epRaw = trim(
                    getCellValue(
                      ws,
                      rowNumber,
                      colMap.has('集数') ? colMap.get('集数')! : colMap.get('集号')!,
                    ),
                  )
                  const epCount = parseInt(epRaw, 10)
                  if ((watchType === 2 || watchType === 3) && !isNaN(epCount) && epCount > 0) {
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 状态${watchType === 2 ? '"看过"' : '"在看"'}(type=${String(watchType)})，集数: ${String(epCount)}，开始标记章节...`,
                    )
                    const epResult = await _markEpisodesComplete(sid, epCount, token)
                    episodeMarkCount += 1
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 章节标记结果: ${epResult.message}`,
                    )
                  } else if (!isNaN(epCount) && epCount > 0) {
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 状态非"看过/在看"(type=${String(watchType)})，跳过章节标记`,
                    )
                  }
                } else {
                  failCount += 1
                  details.push(
                    `✗ 行${String(rowNumber)} ${name || sid} HTTP:${String(result.code)}`,
                  )
                  bgmLog(
                    LOG_LEVELS.WARN,
                    `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} "${name || sid}" 同步失败！HTTP: ${String(result.code)}, 消息: ${result.message}`,
                  )
                  updateSyncProgressDialog(
                    index + 1,
                    rows.length,
                    `${rowProgress} 行${String(rowNumber)} "${name || sid}" ✗ HTTP:${String(result.code)}`,
                    `✗ ${rowProgress} 行${String(rowNumber)} "${name || sid}" 失败 HTTP:${String(result.code)} ${result.message}`,
                  )
                }
              }
            } else {
              const message = `行${String(rowNumber)} "${name || '无名'}" 无法提取 Subject ID，跳过`
              bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
              showToast(message, 'warn')
              details.push(`⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: 无效ID`)
              skipCount += 1
              updateSyncProgressDialog(
                index + 1,
                rows.length,
                message,
                `⊘ ${rowProgress} ${message}`,
              )
            }
          } else {
            const message = `行${String(rowNumber)} "${name || '无名'}" 非BGM链接，跳过`
            bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
            showToast(message, 'warn')
            details.push(
              `⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: 非BGM链接 (${bgmUrl.substring(0, 30)})`,
            )
            skipCount += 1
            updateSyncProgressDialog(index + 1, rows.length, message, `⊘ ${rowProgress} ${message}`)
          }
        else {
          const message = `行${String(rowNumber)} "${name || '无名'}" URL为空，跳过`
          bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
          showToast(message, 'warn')
          details.push(`⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: URL为空`)
          skipCount += 1
          updateSyncProgressDialog(index + 1, rows.length, message, `⊘ ${rowProgress} ${message}`)
        }
      } catch (error: unknown) {
        failCount += 1
        const errorMessage = error instanceof Error ? error.message : String(error)
        bgmLog(
          LOG_LEVELS.ERROR,
          `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 处理异常: ${errorMessage}`,
        )
        updateSyncProgressDialog(
          index + 1,
          rows.length,
          `${rowProgress} 行${String(rowNumber)} 异常: ${errorMessage}`,
          `✗ ${rowProgress} 行${String(rowNumber)} 异常: ${errorMessage}`,
        )
      }
    }

    // 输出最终汇总日志
    const elapsed = Date.now() - startTime
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 汇总 ==========`)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncSelectedRows] 总行数: ${String(rows.length)}  |  成功: ${String(successCount)}  |  失败: ${String(failCount)}  |  跳过: ${String(skipCount)}  |  标记章节: ${String(episodeMarkCount)}  |  耗时: ${String(elapsed)}ms`,
    )
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 详情: ${details.join('  |  ')}`)

    // 切换弹窗为完成状态（保留弹窗，显示统计 + 详情）
    const wasStopped = BGM.sync.checkShouldStop()
    const summary = `📊 选中 ${String(rows.length)} 行 | 耗时 ${(elapsed / 1000).toFixed(1)}s\n\n✅ 成功: ${String(successCount)}\n❌ 失败: ${String(failCount)}\n⏭️ 跳过: ${String(skipCount)}\n📺 标记章节: ${String(episodeMarkCount)}`
    completeSyncProgressDialog(summary, details, wasStopped)
  } catch (error: unknown) {
    hideSyncProgressDialog()
    BGM.handleError(error, { context: 'syncSelectedRows', showAlert: false })
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${errorMessage}`)
    void wpsMessageBox(`选中行同步异常: ${errorMessage}`, 0, 16)
  } finally {
    // 统一在 finally 中清理运行状态，避免 catch/success 路径重复调用 exitRunningState
    // 正常完成时 completeSyncProgressDialog 已切换弹窗状态；异常时 hideSyncProgressDialog 已隐藏弹窗
    if (isEnteredRunning) {
      BGM.sync.exitRunningState()
    }
  }
}

/**
 * 选中行同步到 Bangumi（多行/单行）
 *
 * @function syncSelectedRows
 */
export async function syncSelectedRows(): Promise<void> {
  // P0：防重入预检，避免并发同步
  if (BGM.sync.isRunning) {
    showToast('同步正在进行中，请稍后', 'warn')
    return
  }
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] ========== 开始选中行同步 ==========')
  try {
    const app = getApp()
    if (!app?.ActiveWorkbook) {
      bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 无法获取 Application')
      void wpsMessageBox('无法获取 Application', 0, 48)
      return
    }
    const ws = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 工作表获取成功')

    // 1. 收集选中行号（含非连续区域 Areas 处理）
    const rawRows = collectSelectedRows(app)
    if (rawRows.length === 0) return

    // 2. 定位表头行
    const headerRow = findHeaderRow(ws)
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 表头行: ${String(headerRow)}`)
    if (headerRow === 0) {
      bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 未找到有效表头行，中止同步')
      void wpsMessageBox(
        '未在当前工作表中检测到有效表头行！\n请确保表头包含"名称"、"是否看完"、"Bangumi URL"等关键词。',
        0,
        48,
      )
      return
    }

    // 3. 校验选中行并准备同步数据（排除表头、阈值确认、列映射、Token）
    const validated = await validateSelectedRows(ws, rawRows, headerRow)
    if (!validated) return

    // 4. 执行同步（状态机、弹窗、循环、完成、异常处理、重置状态机）
    await executeSelectedSync(
      ws,
      validated.rows,
      validated.colMap,
      validated.token,
      headerRow,
      startTime,
    )
  } catch (error: unknown) {
    hideSyncProgressDialog()
    BGM.handleError(error, { context: 'syncSelectedRows', showAlert: false })
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${errorMessage}`)
    void wpsMessageBox(`选中行同步异常: ${errorMessage}`, 0, 16)
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] ========== 选中行同步结束，总耗时: ${String(Date.now() - startTime)}ms ==========`,
  )
}

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
 *   - exceltobangumi/index.ts：常量、辅助函数、getFilterStatus、buildJsonPayload、SyncToBangumiAsync、syncSelectedRows 等
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */

import { BGM_COLOR, LOG_LEVELS } from '../../core/constants.js'
import { createSyncControlHandlers } from '../../core/sync-progress-handlers.js'
import {
  bgmLog,
  getApp,
  getCell,
  trim,
  getColumnMap,
  findHeaderRow,
  columnNumberToLetter,
  loadBgToken,
  BGM,
  _getUserApiPath,
  delay,
  clearSheetCache,
} from '../../tools/util/index.js'
// createBatchFieldGetter 与 calcSyncRowFingerprint 直连子模块 field-getter.js：
// 本模块的测试对 '../../tools/util/index.js' 做原子集 mock，经 barrel 取这两个
// 函数时，mock 工厂执行期的共享模块自引用请求会绕过替身落到真实现（COM 矩形读
// 在假 worksheet 上返回空）。直连子模块后，其内部 './index.js' 读取经普通
// import 链正常命中 mock，矩形读替身与原本地 createFieldGetter 行为一致。
// 同型先例：enrich-engine.ts 直连 ../tools/util/sheet.js。
import { createBatchFieldGetter, calcSyncRowFingerprint } from '../../tools/util/field-getter.js'
import type { WpsApp, WpsWorksheet, WpsRange } from '../../tools/wps.js'
import { wpsMessageBox, isWpsWorksheet } from '../../tools/wps.js'
import { readRangeAddress } from '../../tools/wps-range.js'
// 通知与同步进度弹窗走依赖反转桥：本模块属于底层（sync/），不得 runtime-import
// 上层 UI 层（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。实现由 ui/dialog.ts 注册。
import { getNotifyApi, getSyncProgressApi } from '../../core/ui-bridge.js'
// 同步配置摘要的构造是纯函数，已下沉到 sync 层（原先在 ui/dialog.ts 里）
import { buildSyncConfig } from '../sync-config-summary.js'
import type { SyncConfigSummary } from '../sync-config-summary.js'
import {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  getSeqColumnIndex,
  addTagsFromString,
} from '../pure-utilities.js'
import { getAllSyncRecords, getOrCreateSyncRecordSheet } from '../sync-record.js'
// 失败行号留档：同步只把失败压成计数就丢了，用户无从只重试那几行
import { setLastFailedRows } from '../../core/failed-rows.js'

// 子模块内部依赖（不通过 re-export 暴露给外部）
import { bgmRequestSync as _bgmRequestSync } from './api.js'
import { markEpisodesComplete as _markEpisodesComplete } from './chapter-marker.js'
import {
  finalizeSyncResults as _finalizeSyncResults,
  DEFAULT_SEQ_COLUMN as _DEFAULT_SEQ_COL,
} from './progress-reporter.js'
import type {
  SyncTask as _SyncTask,
  SyncResultStats as _SyncResultStats,
} from './progress-reporter.js'

// Re-export 纯函数，保持模块对外 API 兼容
export {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  getSeqColumnIndex,
  addTagsFromString,
  buildTagsArray,
} from '../pure-utilities.js'

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

export { fetchEpisodeIds, markEpisodesComplete } from './chapter-marker.js'

export {
  type SyncTask,
  type SyncResultStats,
  TYPE_NAMES,
  DEFAULT_SEQ_COLUMN,
  markSyncResultColor,
  applySyncSuccessResults,
  applySyncFailResults,
  handleStoppedRemainingTasks,
  finalizeSyncResults,
} from './progress-reporter.js'

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
 * @param worksheet 工作表
 * @param row 行号
 * @param seqColumn 序列号列索引（可选，默认4）
 */
function isCellMarkedSuccess(worksheet: WpsWorksheet, row: number, seqColumn?: number): boolean {
  try {
    const column = seqColumn ?? _DEFAULT_SEQ_COL
    const cell = getCell(worksheet, row, column)
    if (!cell?.Interior) return false
    const color = cell.Interior.Color
    return [BGM_COLOR.SUCCESS, BGM_COLOR.LIGHT_GREEN, BGM_COLOR.DARK_GREEN].includes(color)
  } catch {
    return false
  }
}

/**
 * 批量读取数据并创建字段快速访问器
 *
 * 已收敛到 `tools/util/field-getter.ts` 的 {@link createBatchFieldGetter}
 * （矩形读 + 逐格回退，与 ribbon-service 的同步预览共用一份实现），
 * 此处经 `../../tools/util/index.js` 引入。
 */

// 以下纯函数（extractSubjectId / mapWatchStatus / addTagsFromString / buildTagsArray） 已迁移至 ./pure-utilities.js，通过顶部 import 与 re-export 引入。

/**
 * 获取筛选状态（可见行）
 * @param worksheetOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 worksheetOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export function getFilterStatus(
  worksheetOrLastRow?: WpsWorksheet | number,
  lastRow?: number,
  headerRow?: number,
  // true: 也检测非 AutoFilter 的隐藏行（性能开销）
  shouldDeepCheck?: boolean,
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
    return getFilterStatusCore(result, worksheetOrLastRow, lastRow, headerRow, shouldDeepCheck)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
  }

  return result
}

/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param getField - 按列名读取单元格值的取数函数
 * @param _finishedDate - 完播日期（预留，当前未参与构建）
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、private（是否私有）
 */
export function buildJsonPayload(getField: (key: string) => string, _finishedDate: string): string {
  try {
    return buildJsonPayloadInner(getField, _finishedDate)
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
    isSuccess: boolean,
    result: { code: number; message: string },
  ) => void
  /** 需要跳过的SID集合（冲突处理） */
  skipSubjectIds?: Set<string>
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
 * @param worksheet 工作表
 * @param startRow 起始数据行
 * @param lastRow 最后一行
 * @param headerRow 表头行（用于排除）
 * @returns 待处理的行号数组
 */
function fetchVisibleRowsForSync(
  worksheet: WpsWorksheet,
  startRow: number,
  lastRow: number,
  headerRow: number,
): number[] {
  const filterStatus = getFilterStatus(worksheet, lastRow, headerRow, true)
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
 * @returns 指纹映射（subjectId -> fingerprint）；未启用增量时返回 undefined
 */
function buildFingerprintMap(incremental: boolean | undefined): Map<string, string> | undefined {
  if (!incremental) return undefined
  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 正在加载历史同步记录...')
  const allRecords = getAllSyncRecords()
  const fingerprintMap = new Map<string, string>()
  for (const r of allRecords) {
    if (r.subjectId && r.fingerprint) {
      fingerprintMap.set(r.subjectId, r.fingerprint)
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
 * @param worksheet 工作表
 * @param rowNumber 当前行号
 * @param getField 字段访问器（基于批量缓存）
 * @param skipSubjectIds 需跳过的 SID 集合（冲突处理）
 * @param fingerprintMap 历史指纹映射（增量同步用）
 * @param seqColumn 序列号列索引（用于颜色检查）
 * @returns 处理结果：task 有值表示需要同步
 */
function processRowToSyncTask(
  worksheet: WpsWorksheet,
  rowNumber: number,
  getField: (row: number, key: string) => string,
  skipSubjectIds: Set<string> | undefined,
  fingerprintMap: Map<string, string> | undefined,
  seqColumn: number,
): RowProcessOutcome {
  try {
    return processRowToSyncTaskInner(
      worksheet,
      rowNumber,
      getField,
      skipSubjectIds,
      fingerprintMap,
      seqColumn,
    )
  } catch (error: unknown) {
    BGM.handleError(error, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:preprocess' })
    return { task: null, skipped: false, failed: true }
  }
}

/**
 * processRowToSyncTask 主体（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function processRowToSyncTaskInner(
  worksheet: WpsWorksheet,
  rowNumber: number,
  getField: (row: number, key: string) => string,
  skipSubjectIds: Set<string> | undefined,
  fingerprintMap: Map<string, string> | undefined,
  seqColumn: number,
): RowProcessOutcome {
  const bgmUrl = getField(rowNumber, 'Bangumi_URL')
  if (!bgmUrl) return { task: null, skipped: true, failed: false }

  const subjectId = extractSubjectId(bgmUrl)
  if (!subjectId) return { task: null, skipped: true, failed: false }

  // 冲突跳过
  if (skipSubjectIds?.has(subjectId)) {
    return { task: null, skipped: true, failed: false }
  }

  // 读取观看状态（空状态视为「想看」，由 mapWatchStatus 返回 1）
  const watchStatusField =
    getField(rowNumber, '是否看完') ||
    getField(rowNumber, '状态') ||
    getField(rowNumber, '观看状态')

  // 获取观看状态类型（空值 → 1=想看，未识别 → 0 跳过）
  const watchType = mapWatchStatus(watchStatusField)
  if (watchType === 0) {
    return { task: null, skipped: true, failed: false }
  }

  // 增量同步指纹检查（标签包含 标签/分级 + 原作标签，与 buildJsonPayload 保持一致）
  let currentFingerprint: string | undefined
  if (fingerprintMap) {
    currentFingerprint = calcSyncRowFingerprint((key) => getField(rowNumber, key), watchType)

    const storedFingerprint = fingerprintMap.get(subjectId)
    if (storedFingerprint === currentFingerprint) {
      return { task: null, skipped: true, failed: false }
    }
  }

  // 检查已上传颜色（非增量模式）
  if (!fingerprintMap && isCellMarkedSuccess(worksheet, rowNumber, seqColumn)) {
    return { task: null, skipped: true, failed: false }
  }

  const finishedDate = getField(rowNumber, '完播日')
  const jsonBody = buildJsonPayload((key) => getField(rowNumber, key), finishedDate)
  const name = getField(rowNumber, '名称')
  const epRaw = trim(getField(rowNumber, '集数') || getField(rowNumber, '集号') || '')
  const epNumber = Number(epRaw)

  const task: _SyncTask = {
    rowNum: rowNumber,
    subjectId,
    bgmUrl,
    name,
    jsonBody,
    ...(currentFingerprint !== undefined && { fingerprint: currentFingerprint }),
    type: watchType,
    ...(!Number.isNaN(epNumber) && epNumber > 0 && { epCount: epNumber }),
  }

  return { task, skipped: false, failed: false }
}

/**
 * 预处理同步任务（协调函数 - 步骤 1-4）
 * 协调 fetchVisibleRowsForSync → buildFingerprintMap → processRowToSyncTask 三个子步骤，
 * 完成筛选可见行、批量读取数据缓存、构建历史指纹映射、收集所有需要同步的任务。
 * @param worksheet 工作表
 * @param columnMap 列映射
 * @param options 同步选项
 * @param startRow 起始数据行（headerRow + 1）
 * @param lastRow 最后一行
 * @param seqColumn 序列号列索引
 * @returns 待同步任务列表及预处理阶段的跳过/失败计数
 */
function prepareSyncTasks(
  worksheet: WpsWorksheet,
  columnMap: Map<string, number>,
  options: SyncOptions | undefined,
  startRow: number,
  lastRow: number,
  seqColumn: number,
): { syncTasks: _SyncTask[]; skip: number; fail: number } {
  let skip = 0
  let fail = 0
  const headerRow = startRow - 1

  // 步骤1：获取可见行（数据获取）
  const rowsToProcess = fetchVisibleRowsForSync(worksheet, startRow, lastRow, headerRow)

  // 步骤2：批量读取数据缓存（性能关键）
  const getField = createBatchFieldGetter(
    worksheet,
    columnMap,
    startRow,
    lastRow,
    BATCH_READ_COLUMNS,
  )

  // 步骤3：构建历史指纹映射（数据获取）
  const fingerprintMap = buildFingerprintMap(options?.incremental)

  // 步骤4：预处理收集同步任务（业务处理）
  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤4: 预处理收集同步任务')
  const syncTasks: _SyncTask[] = []
  const skipSubjectIds = options?.skipSubjectIds

  for (const rowNumber of rowsToProcess) {
    const outcome = processRowToSyncTask(
      worksheet,
      rowNumber,
      getField,
      skipSubjectIds,
      fingerprintMap,
      seqColumn,
    )
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

/**
 * 按收藏类型处理章节标记："看过"(type=2) 和 "在看"(type=3) 均需标记章节；标记失败仅警告不中断。
 * （从 batchSyncRequests 并发任务的 try 块抽出，降低 try-complexity）
 */
async function markEpisodesByType(task: _SyncTask, token: string): Promise<void> {
  if ((task.type === 2 || task.type === 3) && task.epCount && task.epCount > 0) {
    try {
      bgmLog(
        LOG_LEVELS.INFO,
        `[batchSyncRequests] SID ${task.subjectId} 状态${task.type === 2 ? '"看过"' : '"在看"'}(type=${String(task.type)})，集数: ${String(task.epCount)}，开始标记章节...`,
      )
      const epResult = await _markEpisodesComplete(task.subjectId, task.epCount, token)
      bgmLog(
        LOG_LEVELS.INFO,
        `[batchSyncRequests] SID ${task.subjectId} 章节标记结果: ${epResult.message}`,
      )
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[batchSyncRequests] SID ${task.subjectId} 章节标记异常: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } else if (task.epCount && task.epCount > 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[batchSyncRequests] SID ${task.subjectId} 状态非"看过/在看"(type=${String(task.type)})，跳过章节标记`,
    )
  }
}

async function batchSyncRequests(
  tasks: _SyncTask[],
  token: string,
  userIdPath: string,
  concurrency: number = DEFAULT_CONCURRENCY,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<{ success: _SyncTask[]; fail: _SyncTask[]; stopped: boolean }> {
  const success: _SyncTask[] = []
  const fail: _SyncTask[] = []
  // 用对象包裹上次请求时间：闭包内通过属性赋值更新，避免 no-loop-func 捕获循环外可变 let 变量
  const requestThrottle = { lastRequestTime: 0 }
  let isStopped = false
  const total = tasks.length

  const queue = [...tasks]
  const executing: { promise: Promise<void>; task: _SyncTask; done: boolean }[] = []

  while (queue.length > 0 || executing.length > 0) {
    if (BGM.sync.checkShouldStop()) {
      bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 检测到停止请求，正在停止...')
      isStopped = true
      if (executing.length > 0) {
        await Promise.all(executing.map((task) => task.promise))
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
          await Promise.all(executing.map((task) => task.promise))
        }
        break
      }
      bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 同步已恢复，继续处理')
    }

    // 一次性取出本轮并发窗口内的任务（每轮 executing 同步 +1，
    // 取出数量恰为 concurrency - executing.length，与原逐个 shift 等价）
    const batchTasks = queue.splice(0, concurrency - executing.length)
    for (const task of batchTasks) {
      // 更新当前行号（工作表和列在调用方 SyncToBangumiAsync 中已通过 updatePosition 设置）
      BGM.sync.updatePosition(undefined, task.rowNum)
      const entry = { promise: null as unknown as Promise<void>, task, done: false }

      entry.promise = (async () => {
        try {
          const now = Date.now()
          const elapsed = now - requestThrottle.lastRequestTime
          if (elapsed < MIN_REQUEST_INTERVAL) {
            await delay(MIN_REQUEST_INTERVAL - elapsed)
          }

          const apiResult = await _bgmRequestSync(
            'POST',
            `/v0/users${userIdPath}/collections/${task.subjectId}`,
            task.jsonBody,
            token,
          )
          requestThrottle.lastRequestTime = Date.now()

          if (apiResult.code >= 200 && apiResult.code < 300) {
            success.push(task)
            bgmLog(
              LOG_LEVELS.INFO,
              `[batchSyncRequests] SID ${task.subjectId} 同步成功，HTTP ${String(apiResult.code)}`,
            )

            // 按收藏类型处理章节标记（"看过" type=2 和 "在看" type=3 均需标记）
            await markEpisodesByType(task, token)
          } else {
            fail.push(task)
            bgmLog(
              LOG_LEVELS.WARN,
              `[batchSyncRequests] SID ${task.subjectId} 同步失败，HTTP ${String(apiResult.code)}，消息: ${apiResult.message}`,
            )
          }
        } catch (error: unknown) {
          fail.push(task)
          bgmLog(
            LOG_LEVELS.ERROR,
            `[batchSyncRequests] SID ${task.subjectId} 同步异常: ${error instanceof Error ? error.message : String(error)}`,
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
      await Promise.race(executing.map((task) => task.promise))
      for (let index = executing.length - 1; index >= 0; index -= 1) {
        if (executing[index]?.done) executing.splice(index, 1)
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
 * @param worksheet 工作表
 * @param headerRow 表头行
 * @param seqColumn 序列号列索引
 * @returns 成功/失败任务列表及是否被停止
 */
async function executeBatchSync(
  syncTasks: _SyncTask[],
  token: string,
  userIdPath: string,
  options: SyncOptions | undefined,
  worksheet: WpsWorksheet,
  headerRow: number,
  seqColumn: number,
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
  BGM.sync.updatePosition(worksheet, headerRow, seqColumn)
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
  worksheet: WpsWorksheet,
  columnMap: Map<string, number>,
  token: string,
  lastRow: number,
  headerRow: number,
  options?: SyncOptions,
): Promise<{ success: number; fail: number; skip: number; stopped: boolean }> {
  const result: _SyncResultStats = { success: 0, fail: 0, skip: 0, stopped: false }
  const startRow = headerRow + 1
  const startTime = Date.now()
  const seqColumn = getSeqColumnIndex(columnMap)
  const userIdPath = _getUserApiPath()

  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] ========== 开始批量同步 ==========')
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 配置参数：`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 增量同步模式: ${options?.incremental ? '开启' : '关闭'}`,
  )
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 跳过冲突数量: ${String(options?.skipSubjectIds?.size ?? 0)}`,
  )
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 表头行: ${String(headerRow)}`)
  bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 最后一行: ${String(lastRow)}`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync]   - 序列号列: ${String(seqColumn)} (列${columnNumberToLetter(seqColumn)})`,
  )

  // 步骤 1-4: 预处理（筛选可见行 + 数据缓存 + 指纹映射 + 任务收集）
  const { syncTasks, skip, fail } = prepareSyncTasks(
    worksheet,
    columnMap,
    options,
    startRow,
    lastRow,
    seqColumn,
  )
  result.skip = skip
  result.fail = fail

  // 步骤 5: 批量执行同步请求（并发控制）
  const { successTasks, failTasks, stopped } = await executeBatchSync(
    syncTasks,
    token,
    userIdPath,
    options,
    worksheet,
    headerRow,
    seqColumn,
  )

  // 失败行留档（含所属表名）：供「重试失败行」只重发这几行，而不是整表重跑
  setLastFailedRows(
    failTasks.map((task) => task.rowNum),
    worksheet.Name || '',
  )

  // 步骤 6: 批量更新 UI 和记录
  const reportProgress = (current: number, message: string) => {
    if (options?.onProgress) options.onProgress(current, syncTasks.length, message)
  }
  _finalizeSyncResults(
    worksheet,
    seqColumn,
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
 * 从 Selection 收集行号（处理非连续多区域 / 连续单区域两种形态）
 * （从 collectSelectedRows 的 try 块抽出，降低 try-complexity）
 */
function collectRowNumbersFromSelection(sel: WpsRange, rawRows: number[]): void {
  // 记录选中区域地址用于调试
  // 走 readRangeAddress：Address 在部分 WPS 版本是函数形式，属性直读恒得函数对象
  const selAddress = readRangeAddress(sel)
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] Selection.Address: ${selAddress === '' ? '(无法获取)' : selAddress}`,
  )

  // 处理非连续选择（多区域）
  const areas = sel.Areas
  const areaCount = areas?.Count ?? 1

  if (areas && areaCount > 1) {
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

    collectRowNumbersFromSelection(sel, rawRows)

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
 * @param worksheet 工作表
 * @param rawRows 原始选中行号
 * @param headerRow 表头行号
 * @returns 准备结果（rows/columnMap/token）；若校验失败则返回 null（已提示用户）
 */
async function validateSelectedRows(
  worksheet: WpsWorksheet,
  rawRows: number[],
  headerRow: number,
): Promise<{ rows: number[]; columnMap: Map<string, number>; token: string } | null> {
  // 排除表头行
  const rows = rawRows.filter((r) => r > headerRow)
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] 排除表头后有效数据行: ${String(rows.length)} 行（原始选中 ${String(rawRows.length)} 行）`,
  )

  if (rows.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 排除表头后没有有效数据行')
    getNotifyApi().toast('未选中任何数据行', 'warn')
    return null
  }

  // 选中行数超过阈值时弹出确认对话框
  if (rows.length > 10) {
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 选中 ${String(rows.length)} 行，弹出确认对话框`)
    const shouldSync = await new Promise<boolean>((resolve) => {
      getNotifyApi().confirm(
        `选中了 ${String(rows.length)} 行数据，确认要同步全部吗？\n\n行号范围: ${String(Math.min(...rows))} - ${String(Math.max(...rows))}`,
        (isConfirmed: boolean) => {
          resolve(isConfirmed)
        },
        '批量同步确认',
      )
    })
    if (!shouldSync) {
      bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 用户取消同步')
      void wpsMessageBox('已取消同步', 0, 64)
      return null
    }
  }

  clearSheetCache(worksheet)
  const columnMap = getColumnMap(worksheet, headerRow)
  bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 列映射完成，共 ${String(columnMap.size)} 列`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[syncSelectedRows] 集数列号: ${String(columnMap.get('集数') ?? '')}, 集号列号: ${String(columnMap.get('集号') ?? '')}, Bangumi_URL列号: ${String(columnMap.get('Bangumi_URL') ?? '')}`,
  )

  if (!columnMap.has('Bangumi_URL')) {
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

  return { rows, columnMap, token }
}

/**
 * 执行选中行同步（启动状态机、显示进度弹窗、循环同步、完成弹窗、异常处理、重置状态机）
 * @param worksheet 工作表
 * @param rows 待同步行号数组（已排除表头）
 * @param columnMap 列映射
 * @param token Bangumi Token
 * @param headerRow 表头行号
 * @param startTime 同步开始时间戳（用于耗时统计）
 */
async function executeSelectedSync(
  worksheet: WpsWorksheet,
  rows: number[],
  columnMap: Map<string, number>,
  token: string,
  headerRow: number,
  startTime: number,
): Promise<void> {
  // 用对象包裹运行态标志，避免闭包内赋值不被类型收窄识别（ESLint no-unnecessary-condition 误报恒为 false）
  const runState: { entered: boolean } = { entered: false }
  // 上游 prepareSelectedSync 已校验列存在；?? 0 仅为类型层兜底（列号 1-based，0 不合法）
  const urlColumn = columnMap.get('Bangumi_URL') ?? 0
  const nameColumn = columnMap.get('名称')
  const runSelectedRowsLoop = async (): Promise<void> => {
    // P2：进入运行状态（防重入 + 重置标志 + 置位）
    if (!BGM.sync.enterRunningState()) return
    runState.entered = true

    // 用户 API 路径（声明移到 early return 之后，满足 unicorn/no-declarations-before-early-exit）
    const userPath = _getUserApiPath()

    // 计数器与明细（声明移到 early return 之后；用对象包裹计数器，
    // 供循环内异步闭包通过属性更新，避免 no-loop-func 捕获循环外可变 let 变量）
    const counters = { success: 0, fail: 0, skip: 0, episodeMark: 0 }
    // 失败行号：与 counters.fail 同步累积，供「重试失败行」只重发这几行
    const failedRows: number[] = []
    const details: string[] = []
    const selectedRowsConfig: SyncConfigSummary = buildSyncConfig({
      source: '当前工作表',
      strategy: '选中行同步',
      direction: 'Excel → Bangumi',
      selectedRowsOnly: true,
      extra: [
        { label: '选中行数', value: String(rows.length) },
        {
          label: '行号范围',
          value: rows.length > 0 ? `${String(rows[0] ?? '')}~${String(rows.at(-1) ?? '')}` : '-',
        },
      ],
    })
    // P1：显示同步进度弹窗（新 API：handlers 对象，暂停状态由 dialog 内部管理）
    getSyncProgressApi().show(
      '正在同步 - 选中行同步',
      createSyncControlHandlers(BGM.sync),
      selectedRowsConfig,
    )
    // 设置同步状态机位置（用于暂停时定位到单元格）
    BGM.sync.updatePosition(worksheet, 0, urlColumn)

    // 性能：复用 tools/util 的 createBatchFieldGetter 做一次矩形读（原先每行要
    // URL / 名称 / 完播日 / 集数 + buildJsonPayload 的十余个字段，全是逐格读）。
    // 它内部已带「矩形读不完整 → 回退逐格」的兜底。
    let batchMinRow = rows[0] ?? 0
    let batchMaxRow = batchMinRow
    for (const row of rows) {
      if (row < batchMinRow) batchMinRow = row
      if (row > batchMaxRow) batchMaxRow = row
    }
    const readField = createBatchFieldGetter(
      worksheet,
      columnMap,
      batchMinRow,
      batchMaxRow,
      BATCH_READ_COLUMNS,
    )

    for (const [index, rowNumber] of rows.entries()) {
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

      const rowProgress = `[${String(index + 1)}/${String(rows.length)}]`
      // 更新当前位置（行号），供暂停时定位
      BGM.sync.updatePosition(undefined, rowNumber)

      const syncSingleRowTask = async (): Promise<void> => {
        const bgmUrl = trim(readField(rowNumber, 'Bangumi_URL') || '')
        const name = nameColumn ? trim(readField(rowNumber, '名称') || '') : ''

        if (bgmUrl)
          if (isBangumiUrl(bgmUrl)) {
            const subjectId = extractSubjectId(bgmUrl)
            if (subjectId) {
              bgmLog(
                LOG_LEVELS.INFO,
                `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 开始同步: 名称="${name || '无名'}", SID=${subjectId}, URL=${bgmUrl}`,
              )
              getSyncProgressApi().update(
                index + 1,
                rows.length,
                `${rowProgress} 行${String(rowNumber)} "${name || subjectId}" 同步中...`,
                `⏳️ ${rowProgress} 行${String(rowNumber)} "${name || subjectId}" SID=${subjectId} 开始同步`,
              )

              const finishColumn = columnMap.get('完播日')
              const finishedDate =
                finishColumn === undefined ? '' : trim(readField(rowNumber, '完播日') || '')
              const jsonBody = buildJsonPayload((key) => readField(rowNumber, key), finishedDate)

              if (jsonBody === '{}') {
                const message = `行${String(rowNumber)} "${name || subjectId}" 请求体为空，跳过`
                bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
                getNotifyApi().toast(message, 'warn')
                details.push(`⊘ 行${String(rowNumber)} ${name || subjectId} 跳过: 请求体为空`)
                counters.skip += 1
                getSyncProgressApi().update(
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

                const endpoint = `/v0/users${userPath}/collections/${subjectId}`
                const result = await _bgmRequestSync('POST', endpoint, jsonBody, token)

                if (result.code >= 200 && result.code < 300) {
                  counters.success += 1
                  details.push(
                    `✓ 行${String(rowNumber)} ${name || subjectId} HTTP:${String(result.code)}`,
                  )
                  bgmLog(
                    LOG_LEVELS.INFO,
                    `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} "${name || subjectId}" 同步成功！HTTP: ${String(result.code)}`,
                  )
                  getSyncProgressApi().update(
                    index + 1,
                    rows.length,
                    `${rowProgress} 行${String(rowNumber)} "${name || subjectId}" ✓ HTTP:${String(result.code)}`,
                    `✓ ${rowProgress} 行${String(rowNumber)} "${name || subjectId}" 成功 HTTP:${String(result.code)}`,
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
                  // 「集数」为空时退到「集号」（与原 Number(...) 取值口径一致）
                  const epRaw = trim(readField(rowNumber, '集数') || readField(rowNumber, '集号'))
                  const epCount = Number(epRaw)
                  if (
                    (watchType === 2 || watchType === 3) &&
                    !Number.isNaN(epCount) &&
                    epCount > 0
                  ) {
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 状态${watchType === 2 ? '"看过"' : '"在看"'}(type=${String(watchType)})，集数: ${String(epCount)}，开始标记章节...`,
                    )
                    const epResult = await _markEpisodesComplete(subjectId, epCount, token)
                    counters.episodeMark += 1
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 章节标记结果: ${epResult.message}`,
                    )
                  } else if (!Number.isNaN(epCount) && epCount > 0) {
                    bgmLog(
                      LOG_LEVELS.INFO,
                      `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 状态非"看过/在看"(type=${String(watchType)})，跳过章节标记`,
                    )
                  }
                } else {
                  counters.fail += 1
                  failedRows.push(rowNumber)
                  details.push(
                    `✗ 行${String(rowNumber)} ${name || subjectId} HTTP:${String(result.code)}`,
                  )
                  bgmLog(
                    LOG_LEVELS.WARN,
                    `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} "${name || subjectId}" 同步失败！HTTP: ${String(result.code)}, 消息: ${result.message}`,
                  )
                  getSyncProgressApi().update(
                    index + 1,
                    rows.length,
                    `${rowProgress} 行${String(rowNumber)} "${name || subjectId}" ✗ HTTP:${String(result.code)}`,
                    `✗ ${rowProgress} 行${String(rowNumber)} "${name || subjectId}" 失败 HTTP:${String(result.code)} ${result.message}`,
                  )
                }
              }
            } else {
              const message = `行${String(rowNumber)} "${name || '无名'}" 无法提取 Subject ID，跳过`
              bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
              getNotifyApi().toast(message, 'warn')
              details.push(`⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: 无效ID`)
              counters.skip += 1
              getSyncProgressApi().update(
                index + 1,
                rows.length,
                message,
                `⊘ ${rowProgress} ${message}`,
              )
            }
          } else {
            const message = `行${String(rowNumber)} "${name || '无名'}" 非BGM链接，跳过`
            bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
            getNotifyApi().toast(message, 'warn')
            details.push(
              `⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: 非BGM链接 (${bgmUrl.substring(0, 30)})`,
            )
            counters.skip += 1
            getSyncProgressApi().update(
              index + 1,
              rows.length,
              message,
              `⊘ ${rowProgress} ${message}`,
            )
          }
        else {
          const message = `行${String(rowNumber)} "${name || '无名'}" URL为空，跳过`
          bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${message}`)
          getNotifyApi().toast(message, 'warn')
          details.push(`⊘ 行${String(rowNumber)} ${name || '无名'} 跳过: URL为空`)
          counters.skip += 1
          getSyncProgressApi().update(
            index + 1,
            rows.length,
            message,
            `⊘ ${rowProgress} ${message}`,
          )
        }
      }
      try {
        await syncSingleRowTask()
      } catch (error: unknown) {
        counters.fail += 1
        failedRows.push(rowNumber)
        const errorMessage = error instanceof Error ? error.message : String(error)
        bgmLog(
          LOG_LEVELS.ERROR,
          `[syncSelectedRows] ${rowProgress} 行${String(rowNumber)} 处理异常: ${errorMessage}`,
        )
        getSyncProgressApi().update(
          index + 1,
          rows.length,
          `${rowProgress} 行${String(rowNumber)} 异常: ${errorMessage}`,
          `✗ ${rowProgress} 行${String(rowNumber)} 异常: ${errorMessage}`,
        )
      }
    }

    // 输出最终汇总日志
    const elapsed = Date.now() - startTime
    // 失败行留档（含所属表名）：下一次「重试失败行」就只重发这几行
    setLastFailedRows(failedRows, worksheet.Name || '')
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 汇总 ==========`)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncSelectedRows] 总行数: ${String(rows.length)}  |  成功: ${String(counters.success)}  |  失败: ${String(counters.fail)}  |  跳过: ${String(counters.skip)}  |  标记章节: ${String(counters.episodeMark)}  |  耗时: ${String(elapsed)}ms`,
    )
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 详情: ${details.join('  |  ')}`)

    // 切换弹窗为完成状态（保留弹窗，显示统计 + 详情）
    const wasStopped = BGM.sync.checkShouldStop()
    const summary = `📊 选中 ${String(rows.length)} 行 | 耗时 ${(elapsed / 1000).toFixed(1)}s\n\n✅ 成功: ${String(counters.success)}\n❌ 失败: ${String(counters.fail)}\n⏭️ 跳过: ${String(counters.skip)}\n📺 标记章节: ${String(counters.episodeMark)}`
    getSyncProgressApi().complete(summary, details, wasStopped)
  }
  try {
    await runSelectedRowsLoop()
  } catch (error: unknown) {
    getSyncProgressApi().hide()
    BGM.handleError(error, { context: 'syncSelectedRows', showAlert: false })
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${errorMessage}`)
    void wpsMessageBox(`选中行同步异常: ${errorMessage}`, 0, 16)
  } finally {
    // 统一在 finally 中清理运行状态，避免 catch/success 路径重复调用 exitRunningState
    // 正常完成时 completeSyncProgressDialog 已切换弹窗状态；异常时 hideSyncProgressDialog 已隐藏弹窗
    if (runState.entered) {
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
    getNotifyApi().toast('同步正在进行中，请稍后', 'warn')
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
    const worksheet = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 工作表获取成功')

    // 1. 收集选中行号（含非连续区域 Areas 处理）
    const rawRows = collectSelectedRows(app)
    if (rawRows.length === 0) return

    // 2. 定位表头行
    const headerRow = findHeaderRow(worksheet)
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
    const validated = await validateSelectedRows(worksheet, rawRows, headerRow)
    if (!validated) return

    // 4. 执行同步（状态机、弹窗、循环、完成、异常处理、重置状态机）
    await executeSelectedSync(
      worksheet,
      validated.rows,
      validated.columnMap,
      validated.token,
      headerRow,
      startTime,
    )
  } catch (error: unknown) {
    getSyncProgressApi().hide()
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

/**
 * getFilterStatusCore（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function getFilterStatusCore(
  result: { hasFilter: boolean; visibleRows: number[]; hiddenRows: number[] },
  worksheetOrLastRow?: WpsWorksheet | number,
  lastRow?: number,
  headerRow?: number,
  shouldDeepCheck?: boolean,
): { hasFilter: boolean; visibleRows: number[]; hiddenRows: number[] } {
  const app = getApp()
  if (!app?.ActiveWorkbook) return result

  // 三个分支均会赋值 worksheet，无需初始化为 null（消除 no-useless-assignment）
  let worksheet: WpsWorksheet | null
  let effectiveLastRow: number | undefined
  let effectiveHeaderRow: number | undefined

  if (typeof worksheetOrLastRow === 'number') {
    effectiveLastRow = worksheetOrLastRow
    effectiveHeaderRow = lastRow
    worksheet = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（兼容模式）`)
  } else if (worksheetOrLastRow) {
    worksheet = worksheetOrLastRow
    effectiveLastRow = lastRow
    effectiveHeaderRow = headerRow
    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用传入的工作表: ${worksheet.Name}`)
  } else {
    worksheet = app.ActiveWorkbook.ActiveSheet
    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（无参数）`)
  }

  if (!isWpsWorksheet(worksheet)) return result

  let isAutoFilterMode = false
  try {
    isAutoFilterMode = !!worksheet.AutoFilterMode
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getFilterStatus', showAlert: false })
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `getFilterStatus: AutoFilterMode=${String(isAutoFilterMode)}, worksheet.Name=${worksheet.Name}, deepCheck=${String(shouldDeepCheck ?? '')}`,
  )

  // 2. 快速检测：仅在 deepCheck 时才扫描全范围
  //    旧用法（无 deepCheck）只查 AutoFilter，这是兼容的快速路径
  if (!isAutoFilterMode && !shouldDeepCheck) {
    bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 快速路径：无 AutoFilter')
    return result
  }

  // 3. 确定扫描范围（非 AutoFilter 模式需要全范围扫描隐藏行）
  const maxRow = effectiveLastRow && effectiveLastRow > 0 ? effectiveLastRow : worksheet.Rows.Count
  const scanRange = worksheet.Range(`A1:A${String(maxRow)}`)
  bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 扫描范围 A1:A${String(maxRow)}`)

  // 4. 获取可见单元格来检测筛选/隐藏行
  let visibleCells: WpsRange | null = null
  if (isAutoFilterMode) {
    try {
      if (worksheet.AutoFilter?.Range) {
        visibleCells = worksheet.AutoFilter.Range.SpecialCells(12)
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
      // `visibleCells.Areas` 是**两跳 COM 属性链**（读一次就是 2 次跨进程往返），
      // 所以集合只取一次、Count 只读一次；写在循环条件里会放大成 2N 次往返
      const areaCollection = visibleCells.Areas
      const areaCount = areaCollection.Count
      for (let a = 1; a <= areaCount; a += 1) {
        areas.push(areaCollection.Item(a))
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
    // ⚠️ 这里是**按可见行**循环：筛选后可见行常有几千行，
    // 把 `rows.Count` 写在循环条件里会放大成几千次跨进程 COM 往返（本函数最热的一处）
    const rowCount = rows.Count
    for (let r = 1; r <= rowCount; r += 1) {
      rawRows.add(rows.Item(r).Row)
    }
  }
  bgmLog(LOG_LEVELS.INFO, `SpecialCells 收集到 ${String(rawRows.size)} 个原始行号`)
  const rowList = [...rawRows].sort((a, b) => a - b)
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
    if (effectiveHeaderRow == null || r !== effectiveHeaderRow) {
      result.visibleRows.push(r)
    }
  }
  result.visibleRows.sort((a, b) => a - b)

  bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${String(result.visibleRows.length)} 行`)
  if (result.visibleRows.length > 0) {
    bgmLog(LOG_LEVELS.INFO, `可见行前10: ${result.visibleRows.slice(0, 10).join(',')}`)
  }
  return result
}

/**
 * buildJsonPayloadInner（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function buildJsonPayloadInner(getField: (key: string) => string, _finishedDate: string) {
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
      }
      bgmLog(
        LOG_LEVELS.WARN,
        `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusValue}" -> ${String(mappedStatus)} (无效)`,
      )
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
    const rate = Number(rateValue)
    if (!Number.isNaN(rate) && rate >= 0 && rate <= 10) {
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
    payload.tags = [...tagSet]
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
    // eslint-disable-next-line no-control-regex, unicorn/prefer-unicode-code-point-escapes -- 有意匹配控制字符以清洗文本；\u{...} 码点转义会被 security/detect-unsafe-regex 误报为 unsafe（safe-regex 不识别），必须用 \x 转义，故同时豁免 unicorn 码点转义规则
    const cleaned = commentValue.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu, '')
    // Bangumi API comment 字段长度限制约 1000 字符，超出截断
    const MAX_COMMENT_LENGTH = 1000
    const finalComment =
      cleaned.length > MAX_COMMENT_LENGTH ? cleaned.slice(0, MAX_COMMENT_LENGTH) : cleaned
    if (finalComment) {
      payload.comment = finalComment
      if (cleaned.length > MAX_COMMENT_LENGTH) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[buildJsonPayload] 感言长度 ${String(cleaned.length)} 超过 ${String(MAX_COMMENT_LENGTH)}，已截断`,
        )
      }
    }
  }

  // 隐私收藏
  const privateValue = trim(getField('私密收藏')).toLowerCase()
  if (['是', '1', 'true'].includes(privateValue)) {
    payload.private = true
  }

  return JSON.stringify(payload)
}

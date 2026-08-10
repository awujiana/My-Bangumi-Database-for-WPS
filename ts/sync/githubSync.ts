/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSONL 文件，每行一个 JSON 对象）：
 *   { "sid": "12345", "name": "...", "updatedAt": "2026-07-21",
 *     "date": "2024-01-01", "meta_tags": ["标签1","标签2"], "nsfw": false,
 *     "话数": "12", "播放结束": "...", "动画制作公司": "...", ... }
 *
 * url 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：bgmLog 定义在 tools/util.ts（不在 core/constants.ts），与 BGM/getDataSheet 等同源导入
import { LOG_LEVELS, BGM_SUBJECT_TYPES } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'
import {
  bgmLog,
  getDataSheet,
  findHeaderRow,
  getLastRow,
  getColumnMap,
  getCellValue,
  setCellValue,
  colNumToLetter,
  trim,
  ensureSheetHeaders,
  getApp,
} from '../tools/util.js'
import type { WpsCellValue, WpsWorksheet } from '../tools/wps.js'

import { buildRawUrl, isGithubConfigComplete } from './githubConfig.js'
import {
  computeDiff,
  tagsToString,
  parseJsonl,
  EXTENDED_FIELD_MAP,
  filterByTime,
  type ConflictResolution,
  type GithubRemoteEntry,
  type GithubSyncDiff,
  type LocalRowEntry,
  type SyncStrategy,
  type SyncTimeFilter,
} from './githubSyncDiff.js'
import { extractSubjectId } from './pureUtils.js'
import { addSyncRecords, addSyncRecordSummary } from './syncRecord.js'
import type { UpdateRecordParams } from './syncRecord.js'
import type { SyncSource } from './SyncSource.js'
import {
  beginUndoSession,
  endUndoSession,
  recordRowDeleteEntry,
  recordUndoEntry,
} from './undoStack.js'

// 类型导入：避免运行时循环依赖（githubSync → ribbonService → index → githubSync）

// 纯函数与类型从 githubSyncDiff.ts re-export，避免重复定义
// githubSyncDiff.ts 为零依赖纯模块，可在 Node 测试环境中直接运行
export {
  computeDiff,
  tagsToString,
  parseJsonl,
  isGithubRemoteEntry,
  filterByTime,
  SYNC_STRATEGY_LABELS,
  EXTENDED_FIELD_MAP,
  type GithubRemoteEntry,
  type GithubSyncDiff,
  type LocalRowEntry,
  type SyncStrategy,
  type SyncTimeFilter,
} from './githubSyncDiff.js'

/** 同步结果统计 */
export interface GithubSyncResult {
  /** 远程总条目数 */
  remoteTotal: number
  /** 新增条目数 */
  added: number
  /** 更新条目数 */
  updated: number
  /** 删除条目数（mirror 策略） */
  deleted: number
  /** 无变更条目数 */
  unchanged: number
  /** 跳过条目数（无 SID 或无效） */
  skipped: number
  /** 失败条目数 */
  failed: number
}

/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000

/**
 * 从 GitHub Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象。
 * 解析时按行分割，逐行 JSON.parse，跳过空行，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGithubJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
  return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
    let url: string
    try {
      if (!isGithubConfigComplete()) {
        throw new Error('GitHub 仓库配置不完整')
      }
      url = buildRawUrl()
    } catch (e: unknown) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }

    // 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 开始下载: ${url}`)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.timeout = REQUEST_TIMEOUT_MS
    xhr.setRequestHeader('Accept', 'application/json')

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()，并在请求完成后移除监听器
    let abortHandler: (() => void) | null = null
    const removeAbortHandler = (): void => {
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler)
        abortHandler = null
      }
    }
    if (signal) {
      abortHandler = () => {
        xhr.abort()
      }
      signal.addEventListener('abort', abortHandler)
    }

    xhr.onload = (): void => {
      removeAbortHandler()
      if (xhr.status === 200) {
        try {
          const { entries, errors } = parseJsonl(xhr.responseText)
          if (entries.length === 0 && errors.length > 0) {
            reject(
              new Error(
                `JSONL 解析失败：${errors.length} 行全部非法。` +
                  `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`,
              ),
            )
            return
          }
          if (errors.length > 0) {
            bgmLog(
              LOG_LEVELS.WARN,
              `[githubSync] JSONL 解析完成：${entries.length} 条合法，${errors.length} 行非法（已跳过）。` +
                `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`,
            )
          } else {
            bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${entries.length} 条记录`)
          }
          resolve(entries)
        } catch (e: unknown) {
          reject(new Error(`JSONL 解析失败: ${e instanceof Error ? e.message : String(e)}`))
        }
      } else if (xhr.status === 404) {
        reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`))
      } else if (xhr.status === 403) {
        reject(
          new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`),
        )
      } else {
        reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`))
      }
    }

    xhr.onerror = (): void => {
      removeAbortHandler()
      // 如果是 abort 导致的 onerror，归类为取消
      if (signal?.aborted) {
        reject(new Error('请求被取消'))
        return
      }
      reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`))
    }

    xhr.ontimeout = (): void => {
      removeAbortHandler()
      reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`))
    }

    xhr.send()
  })
}

// ========== SyncSource 接口实现 ==========

/**
 * GitHub 同步源实现
 *
 * 包装 fetchGithubJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 通过 syncFromGithub 主流程统一调用：
 * 1. validateConfig() 在下载前校验配置完整性
 * 2. fetchRemoteEntries() 复用既有 fetchGithubJson 实现，保持向后兼容
 */
export class GithubSyncSource implements SyncSource {
  /** 数据源类型标识 */
  getSourceType(): string {
    return 'github'
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return 'GitHub'
  }

  /**
   * 获取远程条目（委托给 fetchGithubJson）
   * @param signal 可选的 AbortSignal
   */
  async fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
    return fetchGithubJson(signal)
  }

  /**
   * 校验配置是否完整可用
   * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!isGithubConfigComplete()) {
      return Result.failVoid(
        new BgmError('GitHub 仓库配置不完整，请填写 owner/repo/branch/path', 'CONFIG_INCOMPLETE'),
      )
    }
    return Result.okVoid()
  }
}

// ========== 本地数据读取 ==========

/**
 * 读取本地 Excel 工作表的所有条目（按 SID 索引）
 * @param ws 工作表
 * @param colMap 列映射
 * @param headerRow 表头行
 * @param lastRow 最后数据行
 * @returns SID → 本地行条目 的映射
 */
function readLocalEntries(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  headerRow: number,
  lastRow: number,
): Map<string, LocalRowEntry> {
  const result = new Map<string, LocalRowEntry>()
  const startRow = headerRow + 1
  if (startRow > lastRow) {
    bgmLog(LOG_LEVELS.INFO, '[githubSync] 本地无数据行')
    return result
  }

  // ===== 批量读取优化：用一次 Range.Value2 替代逐单元格 getCellValue =====
  // 收集需要读取的列（与旧版 getField 读取的列一致）
  const readColNames = [
    'Bangumi_URL',
    '名称',
    '是否看完',
    '状态',
    '观看状态',
    '标签/分级',
    '集数',
    '集号',
    ...EXTENDED_FIELD_MAP.map(([, excel]) => excel),
  ]
  const readCols: { name: string; col: number }[] = []
  for (const name of readColNames) {
    const col = colMap.get(name)
    if (col) readCols.push({ name, col })
  }
  if (readCols.length === 0 || !colMap.has('Bangumi_URL')) {
    bgmLog(LOG_LEVELS.WARN, '[githubSync] 未找到任何可读取的列')
    return result
  }

  readCols.sort((a, b) => a.col - b.col)
  const minCol = readCols[0]!.col
  const maxCol = readCols[readCols.length - 1]!.col
  const rowCount = lastRow - startRow + 1

  // 一次性读取整个矩形区域
  let rawData: unknown[][] | null = null
  try {
    const startColLetter = colNumToLetter(minCol)
    const endColLetter = colNumToLetter(maxCol)
    const rangeAddr = `${startColLetter}${startRow}:${endColLetter}${lastRow}`
    const range = ws.Range(rangeAddr)
    if (range) {
      const raw = range.Value2 as unknown
      if (Array.isArray(raw)) {
        rawData = raw as unknown[][]
      }
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[githubSync] 批量读取失败，回退到逐单元格: ${(e as Error).message}`)
  }

  // 构建 col name → 数组索引 的映射
  const colIndexMap = new Map<string, number>()
  for (const rc of readCols) {
    colIndexMap.set(rc.name, rc.col - minCol)
  }

  /** 从批量数据中读取字段值 */
  const getFieldFromBatch = (rowOffset: number, key: string): string => {
    const idx = colIndexMap.get(key)
    if (idx === undefined) return ''
    const rowArr = rawData?.[rowOffset]
    if (!rowArr) return ''
    const val = rowArr[idx]
    if (val === null || val === undefined) return ''
    return trim(String(val))
  }

  /** 逐单元格读取（回退用） */
  const getFieldFromCell = (row: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    return trim(getCellValue(ws, row, col))
  }

  for (let i = 0; i < rowCount; i++) {
    const row = startRow + i
    const getField = (key: string): string =>
      rawData ? getFieldFromBatch(i, key) : getFieldFromCell(row, key)
    const url = getField('Bangumi_URL')
    if (!url) continue
    const sid = extractSubjectId(url)
    if (!sid) continue

    const extFields: Record<string, string> = {}
    for (const [, excelField] of EXTENDED_FIELD_MAP) {
      extFields[excelField] = getField(excelField)
    }

    result.set(sid, {
      row,
      sid,
      fields: {
        Bangumi_URL: url,
        名称: getField('名称'),
        是否看完: getField('是否看完') || getField('状态') || getField('观看状态'),
        '标签/分级': getField('标签/分级'),
        集数: getField('集数'),
        集号: getField('集号'),
        ...extFields,
      },
    })
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] 本地读取完成：${result.size} 条有效记录（批量模式: ${rawData ? '是' : '否'}）`,
  )
  return result
}

/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 *
 * 边界情况处理：
 * - 工作表无效（ws 为 null）：返回 null，调用方应抛出错误
 * - 无 Bangumi_URL 列（空文档或表头未识别）：返回空 entries + lastRow=0
 *   调用方 computeDiff 会将所有远程条目视为新增
 */
export function readLocalEntriesForSync(): {
  entries: Map<string, LocalRowEntry>
  lastRow: number
} | null {
  const ws = getDataSheet()
  if (!ws) return null
  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  if (!colMap.has('Bangumi_URL')) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[githubSync] 未找到 Bangumi_URL 列（headerRow=${headerRow}），视为空文档，所有远程条目将作为新增`,
    )
    // 返回空 entries，让 computeDiff 将所有远程条目视为新增
    return { entries: new Map(), lastRow: headerRow }
  }
  const entries = readLocalEntries(ws, colMap, headerRow, lastRow)
  return { entries, lastRow }
}

// ========== 日期工具函数 ==========

/**
 * 日期列名集合（写入时转换为本地"年月日"字符串格式）
 */
const DATE_COLUMNS = new Set(['开播日期', '完播日'])

/**
 * 将远程日期字符串（YYYY-MM-DD 等格式）转换为本地"年月日"格式字符串
 *
 * 本地 Excel 的"开播日期""完播日"列使用"YYYY年MM月DD日"格式的字符串，
 * 远程仓库使用 YYYY-MM-DD 格式，同步时需转换为本地格式写入。
 *
 * @param dateStr 日期字符串，支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
 * @returns "年月日"格式字符串，如"2015年12月15日"，解析失败返回 null
 */
function formatDateToLocal(dateStr: string): string | null {
  if (!dateStr) return null
  const match = String(dateStr).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!match) return null
  const year = match[1]
  const month = match[2]!.padStart(2, '0')
  const day = match[3]!.padStart(2, '0')
  return `${year}年${month}月${day}日`
}

// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 * @param ws 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（含 '*' 表示写入所有字段）
 * @param forceOverwrite 是否强制覆盖（true 时远程空值也清空本地；false 时远程空值跳过）
 */
function writeRemoteEntryToRow(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  row: number,
  remote: GithubRemoteEntry,
  fieldsToWrite: string[],
  forceOverwrite: boolean,
): void {
  /**
   * 安全写入字符串值：列存在时写入值（forceOverwrite=true 时空值也写入清空本地）
   * 对于日期列（开播日期、完播日），自动转换为数值序列号以保留本地列格式。
   */
  const safeSet = (key: string, value: string): void => {
    const col = colMap.get(key)
    if (!col) return
    if (!forceOverwrite && !value) return
    // 记录 undo 条目（旧值 → 新值），便于撤销时恢复
    const oldValue = getCellValue(ws, row, col)
    // 值无变化时跳过写入，避免空字符串重复写入并污染 undo 栈
    if (oldValue === value) return

    // 日期列：转换为本地"年月日"字符串格式
    if (DATE_COLUMNS.has(key)) {
      const localDate = formatDateToLocal(value)
      if (localDate !== null) {
        recordUndoEntry({ row, col, oldValue, newValue: localDate })
        setCellValue(ws, row, col, localDate)
        return
      }
    }

    // 非日期列或日期解析失败：写入字符串
    recordUndoEntry({ row, col, oldValue, newValue: value })
    setCellValue(ws, row, col, value)
  }

  const writeAll = fieldsToWrite.includes('*')

  // URL（从 sid 构造）
  if (writeAll || fieldsToWrite.includes('Bangumi_URL')) {
    safeSet('Bangumi_URL', `https://bgm.tv/subject/${remote.sid}`)
  }
  // 名称
  if (writeAll || fieldsToWrite.includes('名称')) {
    safeSet('名称', remote.name ?? '')
  }
  // 标签（使用 meta_tags）
  if (writeAll || fieldsToWrite.includes('标签/分级')) {
    safeSet('标签/分级', tagsToString(remote.meta_tags))
  }
  // 集数（使用 infobox 的「话数」）
  if (writeAll || fieldsToWrite.includes('集数')) {
    safeSet('集数', remote['话数'] ?? '')
  }
  // 扩展字段（EXTENDED_FIELD_MAP 中定义的 19 个字段）
  for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
    if (writeAll || fieldsToWrite.includes(excelField)) {
      const value = remote[jsonlField as keyof GithubRemoteEntry]
      if (typeof value === 'string') {
        safeSet(excelField, value)
      } else if (typeof value === 'number') {
        safeSet(excelField, String(value))
      }
      // 忽略 undefined / null / boolean / string[]（EXTENDED_FIELD_MAP 不含这些类型）
    }
  }
}

// ========== 批量写入与性能追踪 ==========

/** 批量写入批次大小（行数），防止单次 COM 调用数据量过大 */
const BATCH_WRITE_SIZE = 500

/** 更新阶段批量写入的批次大小（行数），远小于新增批次，确保频繁让出主线程 */
const BATCH_UPDATE_SIZE = 50

/**
 * 让出事件循环，允许 DOM 渲染和 UI 响应
 * 通过在批次间调用此函数，避免同步 COM 操作阻塞主线程
 */
function yieldToEventLoop(): Promise<void> {
  // 使用 10ms 延迟替代 0ms，确保 WPS 浏览器控件有足够时间处理 DOM 渲染
  // 在 WPS 内嵌浏览器中，setTimeout(0) 可能被合并到当前渲染批次而无法触发重绘
  return new Promise<void>((resolve) => setTimeout(resolve, 10))
}

/**
 * 格式化持续时间（毫秒 → 可读字符串）
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}分${secs}秒`
}

/**
 * 格式化预估剩余时间
 */
function formatEta(ms: number): string {
  if (ms <= 0) return '剩余: 计算中...'
  return `预计剩余: ${formatDuration(ms)}`
}

/**
 * 批量写入新增行（使用 Range.Value2 二维数组，比逐行写入快 100-1000x）
 *
 * 原理：WPS COM 的跨进程调用是主要瓶颈。逐行写入时每个 setCellValue 都是
 * 一次独立 COM 调用。Range.Value2 接受二维数组后，WPS 内部批量处理，
 * 一次 COM 调用即可完成整个矩形区域的写入。
 *
 * @param ws 工作表
 * @param colMap 列映射（列名 → 列号）
 * @param startRow 起始行号
 * @param rows 要写入的行数据（GithubRemoteEntry 格式）
 * @param records 同步记录收集器（传入后函数会 push 记录）
 * @returns 成功写入的行数
 */
function batchWriteNewRows(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  startRow: number,
  rows: { remote: GithubRemoteEntry; sid: string }[],
  records: UpdateRecordParams[],
): number {
  if (rows.length === 0) return 0

  // 1. 收集需要写入的列（按列号升序排列）
  interface WriteCol {
    name: string
    col: number
  }
  const writeCols: WriteCol[] = []
  const seen = new Set<string>()
  const tryAddCol = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    const col = colMap.get(name)
    if (col) writeCols.push({ name, col })
  }

  tryAddCol('Bangumi_URL')
  tryAddCol('名称')
  tryAddCol('标签/分级')
  tryAddCol('集数')
  for (const [, excelField] of EXTENDED_FIELD_MAP) {
    tryAddCol(excelField)
  }

  if (writeCols.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[batchWriteNewRows] 未找到任何可写入的列')
    return 0
  }

  writeCols.sort((a, b) => a.col - b.col)
  const minCol = writeCols[0]!.col
  const maxCol = writeCols[writeCols.length - 1]!.col
  const colCount = maxCol - minCol + 1

  // 2. 构建二维值数组（列对齐到 minCol 偏移）
  // 日期列（开播日期、完播日）写入数值序列号以保留本地列格式
  const values: (string | number | null)[][] = []
  for (const entry of rows) {
    const row = new Array<string | number | null>(colCount).fill(null)
    for (const wc of writeCols) {
      const idx = wc.col - minCol
      let value: string | number | null = null
      if (wc.name === 'Bangumi_URL') {
        value = `https://bgm.tv/subject/${entry.remote.sid}`
      } else if (wc.name === '名称') {
        value = entry.remote.name ?? null
      } else if (wc.name === '标签/分级') {
        value = tagsToString(entry.remote.meta_tags) || null
      } else if (wc.name === '集数') {
        value = entry.remote['话数'] ?? null
      } else {
        // 扩展字段：遍历 EXTENDED_FIELD_MAP 匹配
        for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
          if (excelField === wc.name) {
            const v = entry.remote[jsonlField as keyof GithubRemoteEntry]
            if (typeof v === 'string') {
              // 日期列：转换为本地"年月日"字符串格式
              if (DATE_COLUMNS.has(wc.name)) {
                value = formatDateToLocal(v) ?? v
              } else {
                value = v
              }
            } else if (typeof v === 'number') {
              value = String(v)
            }
            break
          }
        }
      }
      row[idx] = value
    }
    values.push(row)
  }

  // 3. 批量写入 Range.Value2
  const startColLetter = colNumToLetter(minCol)
  const endColLetter = colNumToLetter(maxCol)
  const endRow = startRow + rows.length - 1
  try {
    const rangeAddr = `${startColLetter}${startRow}:${endColLetter}${endRow}`
    const range = ws.Range(rangeAddr)
    if (range) {
      range.Value2 = values as unknown as WpsCellValue
    } else {
      bgmLog(LOG_LEVELS.WARN, '[batchWriteNewRows] Range 对象无效，回退到逐行写入')
      return 0
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[batchWriteNewRows] 批量写入失败，回退到逐行写入: ${(e as Error).message}`,
    )
    return 0
  }

  // 4. 记录 undo 条目（一次性记录所有变更）
  // 注意：日期列的值可能是数值序列号，需转换为字符串存储 undo 记录
  for (let i = 0; i < rows.length; i++) {
    for (const wc of writeCols) {
      const row = startRow + i
      const raw = values[i]![wc.col - minCol]
      const val = raw != null ? String(raw) : ''
      recordUndoEntry({ row, col: wc.col, oldValue: '', newValue: val })
    }
    records.push({
      sid: rows[i]!.sid,
      name: rows[i]!.remote.name ?? '',
      url: `https://bgm.tv/subject/${rows[i]!.sid}`,
      type: BGM_SUBJECT_TYPES[2] ?? '',
      source: 'repo',
      content: '仓库同步-新增',
      status: '成功',
      count: 1,
    })
  }

  return rows.length
}

/**
 * 批量更新已存在的行（使用 Range.Value2 二维数组，避免逐行逐字段 COM 调用）
 *
 * 与 writeRemoteEntryToRow 的区别：
 * - writeRemoteEntryToRow：每行每字段一次 setCellValue COM 调用（~23 次/行）
 * - batchUpdateRows：收集所有变更，一次 Range.Value2 写入整个矩形区域（1 次/批）
 *
 * @param ws 工作表
 * @param colMap 列映射
 * @param updates 要更新的行列表（row=行号, remote=远程数据, fields=要更新的字段）
 * @param forceOverwrite 是否强制覆盖
 * @param records 同步记录收集器
 * @returns 成功更新的行数
 */
function batchUpdateRows(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  updates: { row: number; remote: GithubRemoteEntry; sid: string; fields: string[] }[],
  forceOverwrite: boolean,
  records: UpdateRecordParams[],
): number {
  if (updates.length === 0) return 0

  // 1. 收集需要写入的列
  interface WriteCol {
    name: string
    col: number
  }
  const writeCols: WriteCol[] = []
  const seen = new Set<string>()
  const tryAddCol = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    const col = colMap.get(name)
    if (col) writeCols.push({ name, col })
  }

  // 根据 updates 中所有 fields 的并集确定需要写入的列
  for (const u of updates) {
    const writeAll = u.fields.includes('*')
    if (writeAll || u.fields.includes('Bangumi_URL')) tryAddCol('Bangumi_URL')
    if (writeAll || u.fields.includes('名称')) tryAddCol('名称')
    if (writeAll || u.fields.includes('标签/分级')) tryAddCol('标签/分级')
    if (writeAll || u.fields.includes('集数')) tryAddCol('集数')
    for (const [, excelField] of EXTENDED_FIELD_MAP) {
      if (writeAll || u.fields.includes(excelField)) tryAddCol(excelField)
    }
  }

  if (writeCols.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[batchUpdateRows] 未找到任何可写入的列')
    return 0
  }

  writeCols.sort((a, b) => a.col - b.col)
  const minCol = writeCols[0]!.col
  const maxCol = writeCols[writeCols.length - 1]!.col
  const colCount = maxCol - minCol + 1

  // 2. 逐行计算新值，并记录 undo 条目
  // 注意：更新行的行号不连续，不能一次 Range.Value2 写入，需按行逐个写入
  // 但仍然比逐字段 setCellValue 快，因为每行只 1 次 COM 调用而非 ~23 次
  let successCount = 0
  for (const u of updates) {
    const row = u.row
    const remote = u.remote
    const fields = u.fields
    const writeAll = fields.includes('*')

    // 构建该行的值数组
    const rowValues = new Array<string | number | null>(colCount).fill(null)

    for (const wc of writeCols) {
      const idx = wc.col - minCol
      let value: string | number | null = null
      let shouldWrite = false

      if (wc.name === 'Bangumi_URL') {
        if (writeAll || fields.includes('Bangumi_URL')) {
          value = `https://bgm.tv/subject/${remote.sid}`
          shouldWrite = true
        }
      } else if (wc.name === '名称') {
        if (writeAll || fields.includes('名称')) {
          value = remote.name ?? ''
          shouldWrite = true
        }
      } else if (wc.name === '标签/分级') {
        if (writeAll || fields.includes('标签/分级')) {
          value = tagsToString(remote.meta_tags)
          shouldWrite = true
        }
      } else if (wc.name === '集数') {
        if (writeAll || fields.includes('集数')) {
          value = remote['话数'] ?? ''
          shouldWrite = true
        }
      } else {
        // 扩展字段
        for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
          if (excelField === wc.name && (writeAll || fields.includes(excelField))) {
            const v = remote[jsonlField as keyof GithubRemoteEntry]
            if (typeof v === 'string') {
              if (DATE_COLUMNS.has(wc.name)) {
                value = formatDateToLocal(v) ?? v
              } else {
                value = v
              }
              shouldWrite = true
            } else if (typeof v === 'number') {
              value = String(v)
              shouldWrite = true
            }
            break
          }
        }
      }

      if (shouldWrite) {
        // 空值且非强制覆盖时跳过
        if (!forceOverwrite && !value) continue
        // 日期列特殊处理
        if (DATE_COLUMNS.has(wc.name) && typeof value === 'string' && value) {
          const localDate = formatDateToLocal(value)
          if (localDate !== null) value = localDate
        }
        rowValues[idx] = value
      }
    }

    // 3. 写入该行（一次 COM 调用写入整行）
    try {
      const startColLetter = colNumToLetter(minCol)
      const endColLetter = colNumToLetter(maxCol)
      const rangeAddr = `${startColLetter}${row}:${endColLetter}${row}`
      const range = ws.Range(rangeAddr)
      if (range) {
        // 读取旧值用于 undo 记录
        const oldValues = range.Value2 as unknown as (string | number | null)[] | null
        const oldArr = Array.isArray(oldValues)
          ? ((oldValues[0] as (string | number | null)[] | undefined) ?? [])
          : []

        // 只写入有变化的单元格
        let hasChanges = false
        const finalValues = [...rowValues]
        for (let c = 0; c < colCount; c++) {
          const newVal = finalValues[c]
          if (newVal === null) continue
          const oldVal = oldArr[c] != null ? String(oldArr[c]) : ''
          const newValStr = String(newVal)
          if (oldVal === newValStr) {
            finalValues[c] = null // 无变化，跳过
          } else {
            hasChanges = true
            // 记录 undo
            recordUndoEntry({
              row,
              col: minCol + c,
              oldValue: oldVal,
              newValue: newValStr,
            })
          }
        }

        if (hasChanges) {
          // 只写入有变化的列：构建最小写入范围
          // 简化处理：直接写入整行（一次 COM 调用）
          range.Value2 = finalValues as unknown as WpsCellValue
        }
        successCount++
        records.push({
          sid: u.sid,
          name: remote.name ?? '',
          url: `https://bgm.tv/subject/${u.sid}`,
          type: BGM_SUBJECT_TYPES[2] ?? '',
          source: 'repo',
          content: '仓库同步-更新',
          status: '成功',
          message: u.fields.join(', '),
          count: 1,
        })
      }
    } catch (e: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[batchUpdateRows] 行 ${row} 写入失败，回退到逐字段写入: ${(e as Error).message}`,
      )
      // 回退到逐字段写入
      try {
        writeRemoteEntryToRow(ws, colMap, row, remote, fields, forceOverwrite)
        successCount++
        records.push({
          sid: u.sid,
          name: remote.name ?? '',
          url: `https://bgm.tv/subject/${u.sid}`,
          type: BGM_SUBJECT_TYPES[2] ?? '',
          source: 'repo',
          content: '仓库同步-更新',
          status: '成功',
          message: u.fields.join(', '),
          count: 1,
        })
      } catch (e2: unknown) {
        bgmLog(
          LOG_LEVELS.ERROR,
          `[batchUpdateRows] 行 ${row} 逐字段写入也失败: ${(e2 as Error).message}`,
        )
        records.push({
          sid: u.sid,
          source: 'repo',
          content: '仓库同步-更新失败',
          status: '失败',
          message: (e2 as Error).message,
          count: 1,
        })
      }
    }
  }

  return successCount
}

/**
 * 应用 diff 到 Excel 工作表
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message, eta）
 * @param source 同步来源显示名称（如 GitHub/GitLab/Gitee），用于写入同步记录
 * @returns 同步结果统计
 */
export async function applyDiffToSheet(
  diffs: GithubSyncDiff[],
  strategy: SyncStrategy,
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  source?: string,
): Promise<GithubSyncResult> {
  const result: GithubSyncResult = {
    remoteTotal: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  }

  const ws = getDataSheet()
  if (!ws) {
    bgmLog(LOG_LEVELS.ERROR, '[githubSync] applyDiffToSheet: 未找到数据工作表')
    result.failed = diffs.length
    return result
  }

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  let nextAppendRow = lastRow + 1
  const forceOverwrite = strategy === 'force-overwrite'

  // delete 操作需倒序执行（从大行号到小行号），避免行号错位
  const sortedDiffs = [...diffs]

  // 在开始前先发送初始进度：显示总条目数，避免进度条停留在"0/0"
  const total = diffs.length
  const addDiffs = sortedDiffs.filter((d) => d.kind === 'add' && d.remote)
  const addTotal = addDiffs.length
  onProgress?.(0, total, `准备写入：新增 ${addTotal} 条，共 ${total} 条差异`)

  // 让出事件循环，允许 DOM 渲染初始进度
  await yieldToEventLoop()

  // 性能优化：关闭屏幕刷新和自动计算，大幅减少 COM 调用开销
  const app = getApp()
  let prevScreenUpdating: boolean | undefined
  let prevCalculation: number | undefined
  try {
    if (app) {
      prevScreenUpdating = app.ScreenUpdating
      prevCalculation = app.Calculation
      app.ScreenUpdating = false
      app.Calculation = -4135 // xlCalculationManual
      bgmLog(LOG_LEVELS.INFO, '[githubSync] 已关闭屏幕刷新和自动计算')
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[githubSync] 关闭屏幕刷新失败: ${(e as Error).message}`)
  }

  // 性能追踪：记录开始时间
  const syncStartTime = Date.now()
  let lastProgressTime = syncStartTime

  // 开启 undo 会话：记录本次同步的所有单元格变更，便于用户撤销
  beginUndoSession(`${source ?? 'GitHub'} 同步 - 策略: ${strategy}`)

  // 收集本次同步记录
  const syncRecords: UpdateRecordParams[] = []

  const nonAddDiffs = sortedDiffs.filter((d) => d.kind !== 'add')

  // 将 add diffs 分批写入（每批 BATCH_WRITE_SIZE 行）
  let addProcessed = 0
  for (let batchStart = 0; batchStart < addTotal; batchStart += BATCH_WRITE_SIZE) {
    const batch = addDiffs.slice(batchStart, batchStart + BATCH_WRITE_SIZE)
    const batchEntries = batch.map((d) => ({ remote: d.remote!, sid: d.sid }))

    // 尝试批量写入
    const batchWritten = batchWriteNewRows(ws, colMap, nextAppendRow, batchEntries, syncRecords)

    if (batchWritten > 0) {
      result.added += batchWritten
      nextAppendRow += batchWritten
    } else {
      // 批量写入失败，回退到逐行写入
      for (const diff of batch) {
        if (diff.remote) {
          try {
            writeRemoteEntryToRow(ws, colMap, nextAppendRow, diff.remote, ['*'], forceOverwrite)
            nextAppendRow++
            result.added++
            syncRecords.push({
              sid: diff.sid,
              name: diff.remote.name ?? '',
              url: `https://bgm.tv/subject/${diff.sid}`,
              type: BGM_SUBJECT_TYPES[2] ?? '',
              source,
              content: '仓库同步-新增',
              status: '成功',
              count: 1,
            })
          } catch (e: unknown) {
            result.failed++
            bgmLog(
              LOG_LEVELS.ERROR,
              `[githubSync] 逐行写入失败 sid=${diff.sid}: ${(e as Error).message}`,
            )
            syncRecords.push({
              sid: diff.sid,
              source,
              content: '仓库同步-新增失败',
              status: '失败',
              message: (e as Error).message,
              count: 1,
            })
          }
        }
      }
    }

    addProcessed += batch.length
    const now = Date.now()
    const elapsed = now - syncStartTime
    const speed = addProcessed > 0 && elapsed > 0 ? (addProcessed / elapsed) * 1000 : 0
    const remaining = addTotal - addProcessed
    const eta = speed > 0 ? (remaining / speed) * 1000 : 0

    // 每批或每 500ms 更新一次进度（避免高频回调）
    if (now - lastProgressTime > 500 || addProcessed >= addTotal) {
      onProgress?.(
        addProcessed,
        addTotal,
        `新增 ${addProcessed}/${addTotal} 条 (${speed > 0 ? speed.toFixed(0) : '?'} 行/秒)`,
        formatEta(eta),
      )
      lastProgressTime = now
    }

    // 让出事件循环，允许 DOM 渲染进度更新，避免 UI 卡顿
    if (addProcessed < addTotal) {
      await yieldToEventLoop()
    }
  }

  // ---- 阶段 2: 处理 'update' / 'delete' / 'skip' diffs ----
  // 按行号倒序排列（delete 需从大行号到小行号）
  nonAddDiffs.sort((a, b) => {
    const aRow = a.localRow ?? Number.MAX_SAFE_INTEGER
    const bRow = b.localRow ?? Number.MAX_SAFE_INTEGER
    return bRow - aRow
  })

  // 分离 update 和 delete diffs
  const updateDiffs = nonAddDiffs.filter(
    (d) => d.kind === 'update' && d.localRow !== undefined && d.remote,
  )
  const deleteDiffs = nonAddDiffs.filter((d) => d.kind === 'delete' && d.localRow !== undefined)

  // ---- 阶段 2a: 批量处理 update diffs ----
  let updateProcessed = 0
  const updateTotal = updateDiffs.length
  for (let batchStart = 0; batchStart < updateTotal; batchStart += BATCH_UPDATE_SIZE) {
    const batch = updateDiffs.slice(batchStart, batchStart + BATCH_UPDATE_SIZE)
    const batchUpdates = batch.map((d) => ({
      row: d.localRow!,
      remote: d.remote!,
      sid: d.sid,
      fields: d.changedFields,
    }))

    const batchUpdated = batchUpdateRows(ws, colMap, batchUpdates, forceOverwrite, syncRecords)
    result.updated += batchUpdated
    result.failed += batch.length - batchUpdated

    updateProcessed += batch.length
    const now = Date.now()
    if (now - lastProgressTime > 300 || updateProcessed >= updateTotal) {
      const totalProcessed = addTotal + updateProcessed
      const elapsed = now - syncStartTime
      const speed = totalProcessed > 0 && elapsed > 0 ? (totalProcessed / elapsed) * 1000 : 0
      const remaining = updateTotal - updateProcessed + deleteDiffs.length
      const eta = speed > 0 ? (remaining / speed) * 1000 : 0
      onProgress?.(
        totalProcessed,
        total,
        `更新 ${updateProcessed}/${updateTotal} 条 (${speed > 0 ? speed.toFixed(0) : '?'} 行/秒)`,
        formatEta(eta),
      )
      lastProgressTime = now
    }

    // 每批让出事件循环，确保 UI 流畅
    if (updateProcessed < updateTotal) {
      await yieldToEventLoop()
    }
  }

  // ---- 阶段 2b: 逐行处理 delete diffs（需倒序执行）----
  let deleteProcessed = 0
  const deleteTotal = deleteDiffs.length
  for (const diff of deleteDiffs) {
    try {
      const rowValues: Record<number, string> = {}
      for (const col of colMap.values()) {
        rowValues[col] = getCellValue(ws, diff.localRow!, col)
      }
      recordRowDeleteEntry({ row: diff.localRow!, values: rowValues })
      try {
        ws.Range(`${diff.localRow}:${diff.localRow}`).Delete()
        result.deleted++
        syncRecords.push({
          sid: diff.sid,
          source,
          content: '仓库同步-删除',
          status: '成功',
          message: `删除行 ${diff.localRow}`,
          count: 1,
        })
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e)
        bgmLog(LOG_LEVELS.WARN, `[githubSync] 删除行 ${diff.localRow} 失败: ${errMsg}`)
        result.failed++
        syncRecords.push({
          sid: diff.sid,
          source,
          content: '仓库同步-删除失败',
          status: '失败',
          message: errMsg,
          count: 1,
        })
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      result.failed++
      bgmLog(LOG_LEVELS.ERROR, `[githubSync] 删除处理失败 sid=${diff.sid}: ${errMsg}`)
      syncRecords.push({
        sid: diff.sid,
        source,
        content: '仓库同步-失败',
        status: '失败',
        message: errMsg,
        count: 1,
      })
    }

    deleteProcessed++
    const now = Date.now()
    if (now - lastProgressTime > 300 || deleteProcessed >= deleteTotal) {
      const totalProcessed = addTotal + updateTotal + deleteProcessed
      const elapsed = now - syncStartTime
      const speed = totalProcessed > 0 && elapsed > 0 ? (totalProcessed / elapsed) * 1000 : 0
      const remaining = deleteTotal - deleteProcessed
      const eta = speed > 0 ? (remaining / speed) * 1000 : 0
      onProgress?.(
        totalProcessed,
        total,
        `删除 ${deleteProcessed}/${deleteTotal} 条 (${speed > 0 ? speed.toFixed(0) : '?'} 行/秒)`,
        formatEta(eta),
      )
      lastProgressTime = now
    }

    // 每 10 条让出事件循环（delete 比 update 轻量，但仍需频繁让出）
    if (deleteProcessed % 10 === 0 && deleteProcessed < deleteTotal) {
      await yieldToEventLoop()
    }
  }

  // 统计 skip 数量（nonAddDiffs 中 kind='skip' 的条目）
  result.skipped = nonAddDiffs.length - updateDiffs.length - deleteDiffs.length

  // 结束 undo 会话（空会话不入栈）
  endUndoSession()

  // 计算总耗时
  const totalElapsed = Date.now() - syncStartTime
  const totalProcessed = addTotal + nonAddDiffs.length
  const avgSpeed =
    totalProcessed > 0 && totalElapsed > 0 ? (totalProcessed / totalElapsed) * 1000 : 0

  // 恢复屏幕刷新和自动计算
  try {
    if (app) {
      if (prevScreenUpdating !== undefined) app.ScreenUpdating = prevScreenUpdating
      if (prevCalculation !== undefined) app.Calculation = prevCalculation
      bgmLog(LOG_LEVELS.INFO, '[githubSync] 已恢复屏幕刷新和自动计算')
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[githubSync] 恢复屏幕刷新失败: ${(e as Error).message}`)
  }

  // 写入同步记录与汇总行
  if (syncRecords.length > 0) {
    addSyncRecords(syncRecords)
  }
  addSyncRecordSummary({
    source,
    content: '仓库同步汇总',
    status: result.failed > 0 ? '失败' : '成功',
    message: `远程 ${result.remoteTotal}，新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，无变更 ${result.unchanged}，失败 ${result.failed}，策略: ${strategy}`,
    count: 1,
  })

  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] 应用完成: 新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}，耗时 ${formatDuration(totalElapsed)}，平均 ${avgSpeed > 0 ? avgSpeed.toFixed(0) : '?'} 行/秒`,
  )
  return result
}

/**
 * 根据用户冲突解决决策调整 diff 列表
 *
 * 处理规则：
 * - 仅作用于 kind === 'update' 且 changedFields 不为 ['*'] 的 diff（字段级更新）
 * - 对每个 resolution，找到 sid 与 field 匹配的 update diff：
 *   - chosenValue === 'local'：从 changedFields 中移除该 field（保留本地值）
 *   - chosenValue === 'remote'：保留该 field 在 changedFields 中（采用远程值）
 * - 若 update diff 的 changedFields 被清空，则从 diffs 中移除该 diff（无字段需更新）
 * - add/delete 与 force-overwrite（changedFields 为 ['*']）不受影响
 *
 * 本函数直接修改传入的 diffs 数组（in-place），同时返回该数组便于链式调用。
 *
 * @param diffs 差异列表（会被原地修改）
 * @param resolutions 用户冲突解决决策列表
 * @returns 调整后的差异列表（与输入为同一引用）
 */
export function applyConflictResolutions(
  diffs: GithubSyncDiff[],
  resolutions: ConflictResolution[],
): GithubSyncDiff[] {
  if (!resolutions || resolutions.length === 0) {
    return diffs
  }

  // 按 sid 索引 resolutions，便于 O(1) 查找
  const resolutionByKey = new Map<string, ConflictResolution>()
  for (const r of resolutions) {
    resolutionByKey.set(`${r.sid}\u0000${r.field}`, r)
  }

  // 倒序遍历，便于安全移除元素
  for (let i = diffs.length - 1; i >= 0; i--) {
    const diff = diffs[i]
    if (!diff) continue
    // 仅处理字段级 update（changedFields 不为 ['*']）
    if (diff.kind !== 'update') continue
    if (diff.changedFields.length === 1 && diff.changedFields[0] === '*') continue

    // 过滤掉用户选择「本地」的字段
    diff.changedFields = diff.changedFields.filter((field) => {
      const key = `${diff.sid}\u0000${field}`
      const r = resolutionByKey.get(key)
      // 若存在 resolution 且选择 local，则移除该字段；否则保留
      return !(r && r.chosenValue === 'local')
    })

    // 若所有字段都被移除，则该 diff 无需执行
    if (diff.changedFields.length === 0) {
      diffs.splice(i, 1)
    }
  }

  return diffs
}

/**
 * GitHub 同步入口（GitHub 源专用）
 *
 * 直接使用本模块的 GithubSyncSource 完成同步，不再依赖 syncSourceRegistry，
 * 从而打破 githubSync.ts ↔ syncSourceRegistry.ts 的循环依赖。
 *
 * 如需按 sourceType 动态选择数据源，请使用 syncSourceRegistry.ts 中的 syncFromRemote。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表；提供时将按用户选择过滤 update diff 的字段
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export async function syncFromGithub(
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  conflictResolution?: ConflictResolution[],
  selectedRowsOnly?: boolean,
  timeFilter?: SyncTimeFilter,
): Promise<GithubSyncResult> {
  const source: SyncSource = new GithubSyncSource()

  const validationResult = source.validateConfig()
  if (validationResult.isFail()) {
    const errMsg = validationResult.error?.message ?? 'GitHub 同步源配置校验失败'
    throw new Error(errMsg)
  }

  // 使用 total=1 避免进度条显示"0/0"带来的困惑
  const syncStartTs = Date.now()
  onProgress?.(0, 1, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
  const downloadStartTs = Date.now()
  const remoteEntries = await source.fetchRemoteEntries(signal)
  const downloadElapsed = Date.now() - downloadStartTs
  onProgress?.(
    1,
    3,
    `下载完成：${remoteEntries.length} 条（耗时 ${formatDuration(downloadElapsed)}）`,
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
    // 空文档自动填充表头
    const ws = getDataSheet()
    if (ws) {
      const filled = ensureSheetHeaders(ws)
      if (filled) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 空文档已自动填充标准表头')
        onProgress?.(1, 3, '已自动填充表头，继续同步...')
      }
    }

    // 仅同步选中行：过滤远程条目
    let effectiveRemoteEntries = remoteEntries
    if (selectedRowsOnly) {
      const selectedSids = getSelectedRowSids()
      if (selectedSids.size === 0) {
        throw new Error('未选中任何行，或选中行中未找到 Bangumi URL')
      }
      effectiveRemoteEntries = remoteEntries.filter((e) => selectedSids.has(e.sid))
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromGithub] 仅同步选中行：选中 ${selectedSids.size} 个 SID，匹配远程 ${effectiveRemoteEntries.length} 条`,
      )
      onProgress?.(
        1,
        3,
        `选中 ${selectedSids.size} 行，匹配远程 ${effectiveRemoteEntries.length} 条`,
      )
    }

    // 时间筛选：按年份/季度/月份过滤远程条目
    if (timeFilter?.enabled && timeFilter.range !== 'all') {
      const beforeCount = effectiveRemoteEntries.length
      effectiveRemoteEntries = filterByTime(effectiveRemoteEntries, timeFilter)
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromGithub] 时间筛选（${timeFilter.range}）：${beforeCount} → ${effectiveRemoteEntries.length} 条`,
      )
      onProgress?.(
        1,
        3,
        `时间筛选：${timeFilter.range === 'year' ? `${timeFilter.year}年` : timeFilter.range === 'quarter' ? `${timeFilter.year}年${timeFilter.quarter}月新番` : `${timeFilter.year}年${timeFilter.month}月`}，匹配 ${effectiveRemoteEntries.length} 条`,
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
      bgmLog(LOG_LEVELS.INFO, `[githubSync] 已应用 ${conflictResolution.length} 条冲突解决决策`)
    }

    const addCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deleteCount = diffs.filter((d) => d.kind === 'delete').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[githubSync] diff 完成（${strategy}）：新增 ${addCount}，更新 ${updateCount}，删除 ${deleteCount}，耗时 ${formatDuration(diffElapsed)}`,
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
      `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}（总耗时 ${formatDuration(totalElapsed)}，${overallSpeed > 0 ? overallSpeed : '?'} 行/秒）`,
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[githubSync] 同步完成：下载 ${formatDuration(downloadElapsed)}，diff ${formatDuration(diffElapsed)}，应用耗时已计入，总耗时 ${formatDuration(totalElapsed)}，处理 ${totalProcessed} 条，平均 ${overallSpeed > 0 ? overallSpeed : '?'} 行/秒`,
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

/**
 * 从 WPS 当前选区提取所有行的 SID 集合（用于「仅同步选中行」）
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

    const firstRow = selection.Row
    const lastRow = selection.Row + selection.Rows.Count - 1
    bgmLog(LOG_LEVELS.INFO, `[getSelectedRowSids] 选区行范围: ${firstRow}-${lastRow}`)

    const ws = app.ActiveSheet
    if (!ws) return sids
    const headerRow = findHeaderRow(ws) || 1
    const colMap = getColumnMap(ws, headerRow)
    const urlCol = colMap.get('Bangumi_URL')
    if (!urlCol) {
      bgmLog(LOG_LEVELS.WARN, '[getSelectedRowSids] 未找到 Bangumi_URL 列')
      return sids
    }

    for (let row = firstRow; row <= lastRow; row++) {
      if (row === headerRow) continue
      const url = trim(getCellValue(ws, row, urlCol))
      if (!url) continue
      const sid = extractSubjectId(url)
      if (sid) {
        sids.add(sid)
      }
    }

    bgmLog(LOG_LEVELS.INFO, `[getSelectedRowSids] 提取到 ${sids.size} 个 SID`)
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[getSelectedRowSids] 提取失败: ${(e as Error).message}`)
  }
  return sids
}

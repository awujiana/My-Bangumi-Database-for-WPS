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
 * URL 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：bgmLog 定义在 tools/utility.ts（不在 core/constants.ts），与 BGM/getDataSheet 等同源导入
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
  colNumberToLetter,
  trim,
  ensureSheetHeaders,
  getApp,
} from '../tools/utility.js'
import type { WpsCellValue, WpsRange, WpsWorksheet } from '../tools/wps.js'

import { buildRawUrl, isGithubConfigComplete } from './github-config.js'
import {
  computeDiff,
  tagsToString,
  parseJsonl,
  EXTENDED_FIELD_MAP,
  getExcelAliases,
  filterByTime,
} from './github-sync-diff.js'
import type {
  ConflictResolution,
  GithubRemoteEntry,
  GithubSyncDiff,
  GithubSyncDetailItem,
  LocalRowEntry,
  SyncStrategy,
  SyncTimeFilter,
} from './github-sync-diff.js'
import { extractSubjectId } from './pure-utilities.js'
import { addSyncRecords, addSyncRecordSummary } from './sync-record.js'
import type { UpdateRecordParameters } from './sync-record.js'
import type { SyncSource } from './sync-source.js'
import {
  beginUndoSession,
  endUndoSession,
  recordRowDeleteEntry,
  recordUndoEntry,
} from './undo-stack.js'

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
  type GithubSyncDetailItem,
} from './github-sync-diff.js'

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
  /** 新增/更新/删除/失败明细（用于详情表格展示） */
  details?: GithubSyncDetailItem[]
}

/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000

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
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)))
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
      if (!(abortHandler && signal)) {
        return
      }

      signal.removeEventListener('abort', abortHandler)
      abortHandler = null
    }
    if (signal) {
      abortHandler = () => {
        xhr.abort()
      }
      signal.addEventListener('abort', abortHandler)
    }

    xhr.addEventListener('load', (): void => {
      removeAbortHandler()
      switch (xhr.status) {
        case 200: {
          try {
            const { entries, errors } = parseJsonl(xhr.responseText)
            if (entries.length === 0 && errors.length > 0) {
              reject(
                new Error(
                  `JSONL 解析失败：${String(errors.length)} 行全部非法。` +
                    `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
                ),
              )
              return
            }
            if (errors.length > 0) {
              bgmLog(
                LOG_LEVELS.WARN,
                `[githubSync] JSONL 解析完成：${String(entries.length)} 条合法，${String(errors.length)} 行非法（已跳过）。` +
                  `首行错误（第 ${String(errors[0]?.line ?? '')} 行）：${errors[0]?.reason ?? ''}`,
              )
            } else {
              bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${String(entries.length)} 条记录`)
            }
            resolve(entries)
          } catch (error: unknown) {
            reject(
              new Error(
                `JSONL 解析失败: ${error instanceof Error ? error.message : String(error)}`,
              ),
            )
          }

          break
        }
        case 404: {
          reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`))

          break
        }
        case 403: {
          reject(
            new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`),
          )

          break
        }
        default: {
          reject(new Error(`HTTP 错误 ${String(xhr.status)}: ${xhr.statusText}`))
        }
      }
    })

    xhr.addEventListener('error', (): void => {
      removeAbortHandler()
      // 如果是 abort 导致的 onerror，归类为取消
      if (signal?.aborted) {
        reject(new Error('请求被取消'))
        return
      }
      reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`))
    })

    xhr.ontimeout = (): void => {
      removeAbortHandler()
      reject(new Error(`请求超时（${String(REQUEST_TIMEOUT_MS)}ms）：${url}`))
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
        new BgmError('GitHub 仓库配置不完整，请填写 owner/repo/branch/path', {
          code: 'CONFIG_INCOMPLETE',
        }),
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
  ]
  // 扩展字段：同时读取所有可能的 Excel 列别名（如「制作公司」和「动画制作公司」）
  const excelFieldsToRead = new Set<string>()
  for (const [, excelField] of EXTENDED_FIELD_MAP) {
    excelFieldsToRead.add(excelField)
  }
  // 特殊处理：动画制作公司字段别名
  for (const alias of getExcelAliases('动画制作公司')) {
    excelFieldsToRead.add(alias)
  }
  readColNames.push(...excelFieldsToRead)
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
  // 上方已守卫 readCols 非空，?? 分支仅为类型层兜底
  const minCol = readCols[0]?.col ?? 1
  const maxCol = readCols.at(-1)?.col ?? minCol
  const rowCount = lastRow - startRow + 1

  // 一次性读取整个矩形区域
  let rawData: unknown[][] | null = null
  try {
    const startColLetter = colNumberToLetter(minCol)
    const endColLetter = colNumberToLetter(maxCol)
    const rangeAddr = `${startColLetter}${String(startRow)}:${endColLetter}${String(lastRow)}`
    const range = ws.Range(rangeAddr)
    const raw = range.Value2 as unknown
    if (Array.isArray(raw)) {
      rawData = raw as unknown[][]
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[githubSync] 批量读取失败，回退到逐单元格: ${(error as Error).message}`,
    )
  }

  // 构建 col name → 数组索引 的映射
  const colIndexMap = new Map<string, number>()
  for (const rc of readCols) {
    colIndexMap.set(rc.name, rc.col - minCol)
  }

  /** 从批量数据中读取字段值 */
  const getFieldFromBatch = (rowOffset: number, key: string): string => {
    const index = colIndexMap.get(key)
    if (index === undefined) return ''
    const rowArray = rawData?.[rowOffset]
    if (!rowArray) return ''
    const value = rowArray[index] as string | number | boolean | null | undefined
    if (value === null || value === undefined) return ''
    return trim(String(value))
  }

  /** 逐单元格读取（回退用） */
  const getFieldFromCell = (row: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    return trim(getCellValue(ws, row, col))
  }

  for (let index = 0; index < rowCount; index += 1) {
    const row = startRow + index
    const getField = (key: string): string =>
      rawData ? getFieldFromBatch(index, key) : getFieldFromCell(row, key)
    const url = getField('Bangumi_URL')
    if (url) {
      const sid = extractSubjectId(url)
      if (sid) {
        const extensionFields: Record<string, string> = {}
        for (const [, excelField] of EXTENDED_FIELD_MAP) {
          extensionFields[excelField] = getField(excelField)
        }
        // 同时写入「动画制作公司」的所有别名列到 extFields，便于 computeDiff 比对时使用
        for (const alias of getExcelAliases('动画制作公司')) {
          if (!Object.hasOwn(extensionFields, alias)) {
            extensionFields[alias] = getField(alias)
          }
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
            ...extensionFields,
          },
        })
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] 本地读取完成：${String(result.size)} 条有效记录（批量模式: ${rawData ? '是' : '否'}）`,
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
      `[githubSync] 未找到 Bangumi_URL 列（headerRow=${String(headerRow)}），视为空文档，所有远程条目将作为新增`,
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
 * @param dateString 日期字符串，支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
 * @returns "年月日"格式字符串，如"2015年12月15日"，解析失败返回 null
 */
function formatDateToLocal(dateString: string): string | null {
  if (!dateString) return null
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(dateString)
  if (!match) return null
  const year = match[1] ?? ''
  const month = (match[2] ?? '').padStart(2, '0')
  const day = (match[3] ?? '').padStart(2, '0')
  return `${year}年${month}月${day}日`
}

/**
 * 追加值到现有值后面，使用 ` | ` 分隔符
 *
 * 规则：
 * - 本地为空 → 直接返回新值
 * - 远程为空 → 返回本地值（不追加空值）
 * - 本地已包含新值 → 返回本地值（避免重复）
 * - 否则 → 返回 "本地 | 新值"
 *
 * @param localValue 本地现有值
 * @param remoteValue 远程新值
 * @returns 合并后的字符串
 */
function appendValueWithSeparator(localValue: string, remoteValue: string): string {
  const local = trim(localValue)
  const remote = trim(remoteValue)
  if (!remote) return local
  if (!local) return remote
  if (local.includes(remote)) return local
  return `${local} | ${remote}`
}

// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 *
 * 特殊合并策略：
 * - 标签/分级：远程标签追加到本地后面，使用 ` | ` 分隔
 * - 名称：远程名称追加到「别名」列，使用 ` | ` 分隔（保留本地名称列不变）
 *
 * @param ws 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（含 '*' 表示写入所有字段）
 * @param shouldForceOverwrite 是否强制覆盖（true 时远程空值也清空本地；false 时远程空值跳过）
 */
function writeRemoteEntryToRow(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  row: number,
  remote: GithubRemoteEntry,
  fieldsToWrite: string[],
  shouldForceOverwrite: boolean,
): { attempted: boolean; success: boolean } {
  let isAnyAttempted = false
  let isAnySucceeded = false

  /**
   * 安全写入字符串值：列存在时写入值（forceOverwrite=true 时空值也写入清空本地）
   * 对于日期列（开播日期、完播日），自动转换为数值序列号以保留本地列格式。
   */
  const safeSet = (key: string, value: string): void => {
    const col = colMap.get(key)
    if (!col) return
    if (!shouldForceOverwrite && !value) return
    // 记录 undo 条目（旧值 → 新值），便于撤销时恢复
    const oldValue = getCellValue(ws, row, col)
    // 值无变化时跳过写入，避免空字符串重复写入并污染 undo 栈
    if (oldValue === value) return

    isAnyAttempted = true

    // 日期列：转换为本地"年月日"字符串格式
    if (DATE_COLUMNS.has(key)) {
      const localDate = formatDateToLocal(value)
      if (localDate !== null) {
        recordUndoEntry({ row, col, oldValue, updatedValue: localDate })
        if (setCellValue(ws, row, col, localDate)) {
          isAnySucceeded = true
        }
        return
      }
    }

    // 非日期列或日期解析失败：写入字符串
    recordUndoEntry({ row, col, oldValue, updatedValue: value })
    if (setCellValue(ws, row, col, value)) {
      isAnySucceeded = true
    }
  }

  /**
   * 安全追加值：读取本地值，追加远程值（使用 ` | ` 分隔），写回
   * - 本地为空 → 直接写入远程值
   * - 远程为空 → 不写入
   * - 本地已包含远程值 → 不写入（避免重复）
   */
  const safeAppend = (key: string, appendValue: string): void => {
    const col = colMap.get(key)
    if (!col) return
    if (!appendValue) return

    const oldValue = getCellValue(ws, row, col)
    const updatedValue = appendValueWithSeparator(oldValue, appendValue)
    if (updatedValue === oldValue) return

    isAnyAttempted = true
    recordUndoEntry({ row, col, oldValue, updatedValue })
    if (setCellValue(ws, row, col, updatedValue)) {
      isAnySucceeded = true
    }
  }

  const isWriteAll = fieldsToWrite.includes('*')

  // URL（从 sid 构造）
  if (isWriteAll || fieldsToWrite.includes('Bangumi_URL')) {
    safeSet('Bangumi_URL', `https://bgm.tv/subject/${remote.sid}`)
  }
  // 名称处理：
  // - 新增条目（writeAll）：直接写入「名称」列
  // - 更新条目（仅名称字段）：追加到「别名」列，保留本地名称不变
  if (isWriteAll) {
    safeSet('名称', remote.name ?? '')
  } else if (fieldsToWrite.includes('名称')) {
    const remoteName = remote.name ?? ''
    if (remoteName) {
      safeAppend('别名', remoteName)
    }
  }
  // 标签处理：
  // - 新增条目（writeAll）：直接写入远程标签
  // - 更新条目（仅标签字段）：追加远程标签到本地后面，使用 ` | ` 分隔
  if (isWriteAll || fieldsToWrite.includes('标签/分级')) {
    const remoteTags = tagsToString(remote.meta_tags)
    if (remoteTags) {
      if (isWriteAll) {
        safeSet('标签/分级', remoteTags)
      } else {
        // 更新模式：合并本地和远程标签
        const col = colMap.get('标签/分级')
        const localTags = col ? getCellValue(ws, row, col) : ''
        const mergedTags = appendValueWithSeparator(localTags, remoteTags)
        safeSet('标签/分级', mergedTags)
      }
    }
  }
  // 集数（使用 infobox 的「话数」）
  if (isWriteAll || fieldsToWrite.includes('集数')) {
    safeSet('集数', remote['话数'] ?? '')
  }
  // 扩展字段（EXTENDED_FIELD_MAP 中定义的 19 个字段）
  // 对于有多个 Excel 列名的字段（如「动画制作公司」），所有别名列均写入相同的远程值
  const handledJsonlFields = new Set<string>()
  for (const [jsonlField] of EXTENDED_FIELD_MAP) {
    const isUnhandledJsonlField = !handledJsonlFields.has(jsonlField)
    if (isUnhandledJsonlField) {
      handledJsonlFields.add(jsonlField)
      const excelAliases = getExcelAliases(jsonlField)
      const isAnyAliasMatched = excelAliases.some(
        (alias) => isWriteAll || fieldsToWrite.includes(alias),
      )
      if (isAnyAliasMatched) {
        const value = remote[jsonlField as keyof GithubRemoteEntry]
        if (typeof value === 'string' || typeof value === 'number') {
          const stringValue = typeof value === 'number' ? String(value) : value
          for (const alias of excelAliases) {
            if (isWriteAll || fieldsToWrite.includes(alias)) {
              safeSet(alias, stringValue)
            }
          }
        }
      }
    }
  }

  return { attempted: isAnyAttempted, success: isAnySucceeded }
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
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 10)
  })
}

/**
 * 格式化持续时间（毫秒 → 可读字符串）
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    const seconds = Math.max(0, ms / 1000)
    return `${seconds.toFixed(2)}秒`
  }
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${String(seconds)}秒`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(minutes)}分${secs.toString().padStart(2, '0')}秒`
}

/**
 * 格式化预估剩余时间
 */
function formatEta(ms: number): string {
  if (ms <= 0) return '剩余: 计算中...'
  return `预计剩余: ${formatDuration(ms)}`
}

/**
 * 格式化时间筛选标签（year/quarter/month，future 归入 month 分支，与原有三元逻辑一致）
 */
function formatTimeFilterLabel(timeFilter: SyncTimeFilter): string {
  if (timeFilter.range === 'year') {
    return `${String(timeFilter.year)}年`
  }
  if (timeFilter.range === 'quarter') {
    return `${String(timeFilter.year)}年${String(timeFilter.quarter ?? '')}月新番`
  }
  return `${String(timeFilter.year)}年${String(timeFilter.month ?? '')}月`
}

/**
 * 解析新增行的单个单元格写入值（扩展字段支持别名列映射）
 *
 * 独立辅助函数：避免批量写入循环内的嵌套 switch/loop break
 */
function resolveNewRowCellValue(
  wc: { name: string },
  entry: { remote: GithubRemoteEntry },
): string | number | null {
  switch (wc.name) {
    case 'Bangumi_URL': {
      return `https://bgm.tv/subject/${entry.remote.sid}`
    }
    case '名称': {
      return entry.remote.name ?? null
    }
    case '标签/分级': {
      return tagsToString(entry.remote.meta_tags) || null
    }
    case '集数': {
      return entry.remote['话数'] ?? null
    }
    default: {
      // 扩展字段：遍历 EXTENDED_FIELD_MAP 匹配（支持别名列映射）
      for (const [jsonlField] of EXTENDED_FIELD_MAP) {
        const aliases = getExcelAliases(jsonlField)
        if (aliases.includes(wc.name)) {
          const v = entry.remote[jsonlField as keyof GithubRemoteEntry]
          if (typeof v === 'string') {
            return DATE_COLUMNS.has(wc.name) ? (formatDateToLocal(v) ?? v) : v
          }
          if (typeof v === 'number') {
            return String(v)
          }
          return null
        }
      }
      return null
    }
  }
}

/**
 * 解析更新行的单个单元格新值与写入标记（支持别名列映射与合并策略）
 *
 * 独立辅助函数：避免批量更新循环内的嵌套 switch/loop break
 */
function resolveUpdateCellValue(
  wc: { name: string },
  remote: GithubRemoteEntry,
  fields: string[],
  isWriteAll: boolean,
  shouldForceOverwrite: boolean,
  oldCellValue: string,
): { value: string | number | null; shouldWrite: boolean } {
  switch (wc.name) {
    case 'Bangumi_URL': {
      if (isWriteAll || fields.includes('Bangumi_URL')) {
        return { value: `https://bgm.tv/subject/${remote.sid}`, shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    case '别名': {
      // 名称追加到「别名」列（合并策略）
      // forceOverwrite 或 writeAll 时直接写入名称列（不合并）
      if (!shouldForceOverwrite && !isWriteAll && fields.includes('名称')) {
        const remoteName = remote.name ?? ''
        if (remoteName) {
          const value = appendValueWithSeparator(oldCellValue, remoteName)
          if (value !== oldCellValue) {
            return { value, shouldWrite: true }
          }
        }
      }
      // forceOverwrite 或 writeAll 时不处理别名（由名称列处理）
      return { value: null, shouldWrite: false }
    }
    case '名称': {
      // 名称列仅在 forceOverwrite 或 writeAll 时写入（新增或强制覆盖）
      if (shouldForceOverwrite || isWriteAll || fields.includes('名称')) {
        return { value: remote.name ?? '', shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    case '标签/分级': {
      if (isWriteAll || fields.includes('标签/分级')) {
        const remoteTags = tagsToString(remote.meta_tags)
        if (remoteTags) {
          if (shouldForceOverwrite || isWriteAll) {
            // 强制覆盖或新增：直接写入
            return { value: remoteTags, shouldWrite: true }
          }
          // 普通更新：合并本地和远程标签
          const value = appendValueWithSeparator(oldCellValue, remoteTags)
          if (value !== oldCellValue) {
            return { value, shouldWrite: true }
          }
        }
      }
      return { value: null, shouldWrite: false }
    }
    case '集数': {
      if (isWriteAll || fields.includes('集数')) {
        return { value: remote['话数'] ?? '', shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    default: {
      // 扩展字段：根据列名查找对应的 JSONL 字段（支持别名列映射，如「制作公司」/「动画制作公司」）
      for (const [jsonlField] of EXTENDED_FIELD_MAP) {
        const aliases = getExcelAliases(jsonlField)
        if (aliases.includes(wc.name)) {
          if (isWriteAll || aliases.some((a) => fields.includes(a))) {
            const v = remote[jsonlField as keyof GithubRemoteEntry]
            if (typeof v === 'string') {
              return {
                value: DATE_COLUMNS.has(wc.name) ? (formatDateToLocal(v) ?? v) : v,
                shouldWrite: true,
              }
            }
            if (typeof v === 'number') {
              return { value: String(v), shouldWrite: true }
            }
          }
          return { value: null, shouldWrite: false }
        }
      }
      return { value: null, shouldWrite: false }
    }
  }
}

/**
 * 写入单行更新值并记录 undo（一次 COM 调用写入整行）
 *
 * 独立辅助函数：避免在循环内定义闭包捕获外部可变变量（no-loop-func），
 * 通过返回值累加成功数。
 *
 * @returns 1 表示该行写入成功（计入 successCount），0 表示失败或无需写入
 */
function writeRowValuesWithUndo(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  u: { sid: string },
  row: number,
  remote: GithubRemoteEntry,
  fields: string[],
  minCol: number,
  colCount: number,
  oldArray: (string | number | null)[],
  rowValues: (string | number | null)[],
  range: WpsRange | null,
  shouldForceOverwrite: boolean,
  details: GithubSyncDetailItem[] | undefined,
  records: UpdateRecordParameters[],
): number {
  if (range) {
    // 使用已读取的旧值（oldArr 在循环开始前已读取）
    // 只写入有变化的单元格
    let hasChanges = false
    const finalValues = [...rowValues]
    for (let c = 0; c < colCount; c += 1) {
      const updatedValue = finalValues[c]
      if (updatedValue !== null) {
        const oldValue = oldArray[c] == null ? '' : String(oldArray[c])
        const valueString = String(updatedValue)
        if (oldValue === valueString) {
          // 无变化，跳过
          finalValues[c] = null
        } else {
          hasChanges = true
          // 记录 undo
          recordUndoEntry({
            row,
            col: minCol + c,
            oldValue,
            updatedValue: valueString,
          })
        }
      }
    }

    if (hasChanges) {
      // 只写入有变化的列：构建最小写入范围
      // 简化处理：直接写入整行（一次 COM 调用）
      // 局部别名：避免对函数参数 range 的属性赋值（no-param-reassign）
      const targetRange = range
      targetRange.Value2 = finalValues as unknown as WpsCellValue
    }
    details?.push({
      kind: 'update',
      sid: u.sid,
      name: remote.name,
      row,
      fields: fields.includes('*') ? ['全部字段'] : [...fields],
    })
    records.push({
      sid: u.sid,
      name: remote.name ?? '',
      url: `https://bgm.tv/subject/${u.sid}`,
      type: BGM_SUBJECT_TYPES[2] ?? '',
      source: 'repo',
      content: '仓库同步-更新',
      status: '成功',
      message: fields.join(', '),
      count: 1,
    })
    return 1
  }

  // range 为 null（读取旧值失败），回退到逐字段写入
  const hasValuesToWrite = rowValues.some((v) => v !== null)
  if (!hasValuesToWrite) {
    return 0
  }

  try {
    const result = writeRemoteEntryToRow(ws, colMap, row, remote, fields, shouldForceOverwrite)
    if (result.success || !result.attempted) {
      // 写入成功 或 没有写入需要尝试（如空列映射）→ 视为成功
      details?.push({
        kind: 'update',
        sid: u.sid,
        name: remote.name,
        row,
        fields: fields.includes('*') ? ['全部字段'] : [...fields],
      })
      records.push({
        sid: u.sid,
        name: remote.name ?? '',
        url: `https://bgm.tv/subject/${u.sid}`,
        type: BGM_SUBJECT_TYPES[2] ?? '',
        source: 'repo',
        content: '仓库同步-更新',
        status: '成功',
        message: `${fields.join(', ')} (回退逐字段写入)`,
        count: 1,
      })
      return 1
    }

    // 尝试了写入但全部失败
    bgmLog(LOG_LEVELS.ERROR, `[batchUpdateRows] 行 ${String(row)} 回退逐字段写入全部失败`)
    details?.push({
      kind: 'fail',
      sid: u.sid,
      name: remote.name,
      row,
      message: '逐字段写入失败',
    })
    records.push({
      sid: u.sid,
      source: 'repo',
      content: '仓库同步-更新失败',
      status: '失败',
      message: '逐字段写入失败',
      count: 1,
    })
    return 0
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(
      LOG_LEVELS.ERROR,
      `[batchUpdateRows] 行 ${String(row)} 回退逐字段写入异常: ${errorMessage}`,
    )
    details?.push({
      kind: 'fail',
      sid: u.sid,
      name: remote.name,
      row,
      message: errorMessage,
    })
    records.push({
      sid: u.sid,
      source: 'repo',
      content: '仓库同步-更新失败',
      status: '失败',
      message: errorMessage,
      count: 1,
    })
    return 0
  }
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
  records: UpdateRecordParameters[],
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
  // 上方已守卫 writeCols 非空，?? 分支仅为类型层兜底
  const minCol = writeCols[0]?.col ?? 1
  const maxCol = writeCols.at(-1)?.col ?? minCol
  const colCount = maxCol - minCol + 1

  // 2. 构建二维值数组（列对齐到 minCol 偏移）
  // 日期列（开播日期、完播日）写入数值序列号以保留本地列格式
  const values: (string | number | null)[][] = []
  for (const entry of rows) {
    const row = Array.from<unknown, string | number | null>({ length: colCount }, () => null)
    for (const wc of writeCols) {
      const index = wc.col - minCol
      row[index] = resolveNewRowCellValue(wc, entry)
    }
    values.push(row)
  }

  // 3. 批量写入 Range.Value2
  const startColLetter = colNumberToLetter(minCol)
  const endColLetter = colNumberToLetter(maxCol)
  const endRow = startRow + rows.length - 1
  try {
    const rangeAddr = `${startColLetter}${String(startRow)}:${endColLetter}${String(endRow)}`
    const range = ws.Range(rangeAddr)
    range.Value2 = values
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[batchWriteNewRows] 批量写入失败，回退到逐行写入: ${(error as Error).message}`,
    )
    return 0
  }

  // 4. 记录 undo 条目（一次性记录所有变更）
  // 注意：日期列的值可能是数值序列号，需转换为字符串存储 undo 记录
  for (const [index, rowRecord] of rows.entries()) {
    for (const wc of writeCols) {
      const row = startRow + index
      const raw = values[index]?.[wc.col - minCol]
      const value = raw == null ? '' : String(raw)
      recordUndoEntry({ row, col: wc.col, oldValue: '', updatedValue: value })
    }
    records.push({
      sid: rowRecord.sid,
      name: rowRecord.remote.name ?? '',
      url: `https://bgm.tv/subject/${rowRecord.sid}`,
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
 * 特殊合并策略（与 writeRemoteEntryToRow 一致）：
 * - 标签/分级：远程标签追加到本地后面，使用 ` | ` 分隔
 * - 名称：远程名称追加到「别名」列，使用 ` | ` 分隔（保留本地名称列不变）
 *
 * @param ws 工作表
 * @param colMap 列映射
 * @param updates 要更新的行列表（row=行号, remote=远程数据, fields=要更新的字段）
 * @param shouldForceOverwrite 是否强制覆盖
 * @param records 同步记录收集器
 * @param details 同步明细收集器（用于详情表格展示）
 * @returns 成功更新的行数
 */
function batchUpdateRows(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  updates: { row: number; remote: GithubRemoteEntry; sid: string; fields: string[] }[],
  shouldForceOverwrite: boolean,
  records: UpdateRecordParameters[],
  details?: GithubSyncDetailItem[],
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
  // 注意：名称字段在不同场景下有不同处理：
  // - forceOverwrite 或 writeAll：写入「名称」列
  // - 普通更新：追加到「别名」列
  for (const u of updates) {
    const isWriteAll = u.fields.includes('*')
    if (isWriteAll || u.fields.includes('Bangumi_URL')) tryAddCol('Bangumi_URL')
    if (isWriteAll || u.fields.includes('名称')) {
      // 强制覆盖/新增时写入名称列
      tryAddCol('名称')
      // 普通更新时写入别名列
      tryAddCol('别名')
    }
    if (isWriteAll || u.fields.includes('标签/分级')) tryAddCol('标签/分级')
    if (isWriteAll || u.fields.includes('集数')) tryAddCol('集数')
    // 扩展字段：同时检查主映射和所有别名（如「动画制作公司」→「制作公司」/「动画制作公司」）
    const handled = new Set<string>()
    for (const [jsonlField] of EXTENDED_FIELD_MAP) {
      const isUnhandledJsonlField = !handled.has(jsonlField)
      if (isUnhandledJsonlField) {
        handled.add(jsonlField)
        const aliases = getExcelAliases(jsonlField)
        if (isWriteAll || aliases.some((a) => u.fields.includes(a))) {
          for (const a of aliases) tryAddCol(a)
        }
      }
    }
  }

  if (writeCols.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[batchUpdateRows] 未找到任何可写入的列')
    return 0
  }

  writeCols.sort((a, b) => a.col - b.col)
  // 上方已守卫 writeCols 非空，?? 分支仅为类型层兜底
  const minCol = writeCols[0]?.col ?? 1
  const maxCol = writeCols.at(-1)?.col ?? minCol
  const colCount = maxCol - minCol + 1

  // 2. 逐行计算新值，并记录 undo 条目
  // 注意：更新行的行号不连续，不能一次 Range.Value2 写入，需按行逐个写入
  // 但仍然比逐字段 setCellValue 快，因为每行只 1 次 COM 调用而非 ~23 次
  let successCount = 0
  for (const u of updates) {
    const { row, remote, fields } = u
    const isWriteAll = fields.includes('*')

    // 先读取当前行的值（用于合并逻辑和 undo 记录）
    let oldArray: (string | number | null)[] = []
    let range: WpsRange | null = null
    try {
      const startColLetter = colNumberToLetter(minCol)
      const endColLetter = colNumberToLetter(maxCol)
      const rangeAddr = `${startColLetter}${String(row)}:${endColLetter}${String(row)}`
      range = ws.Range(rangeAddr)

      // 读取旧值
      const oldValues = range.Value2 as unknown as (string | number | null)[] | null
      oldArray = Array.isArray(oldValues)
        ? ((oldValues[0] as (string | number | null)[] | undefined) ?? [])
        : []
    } catch {
      // Range 访问失败时，oldArr 保持为空数组，将使用空字符串进行合并
      bgmLog(LOG_LEVELS.WARN, `[batchUpdateRows] 行 ${String(row)} 读取旧值失败，使用空值`)
    }

    // 构建该行的值数组
    const rowValues = Array.from<unknown, string | number | null>({ length: colCount }, () => null)

    for (const wc of writeCols) {
      const index = wc.col - minCol
      // 获取当前单元格的旧值（用于合并）
      const oldCellValue = oldArray[index] == null ? '' : String(oldArray[index])
      const { value: initialValue, shouldWrite } = resolveUpdateCellValue(
        wc,
        remote,
        fields,
        isWriteAll,
        shouldForceOverwrite,
        oldCellValue,
      )
      let value = initialValue

      // 空值且非强制覆盖时跳过
      if (shouldWrite && (shouldForceOverwrite || value)) {
        // 日期列特殊处理
        if (typeof value === 'string' && value && DATE_COLUMNS.has(wc.name)) {
          const localDate = formatDateToLocal(value)
          if (localDate !== null) value = localDate
        }
        rowValues[index] = value
      }
    }

    // 3. 写入该行（一次 COM 调用写入整行）
    try {
      successCount += writeRowValuesWithUndo(
        ws,
        colMap,
        u,
        row,
        remote,
        fields,
        minCol,
        colCount,
        oldArray,
        rowValues,
        range,
        shouldForceOverwrite,
        details,
        records,
      )
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[batchUpdateRows] 行 ${String(row)} 写入失败，回退到逐字段写入: ${(error as Error).message}`,
      )
      // 回退到逐字段写入
      try {
        const result = writeRemoteEntryToRow(ws, colMap, row, remote, fields, shouldForceOverwrite)
        if (result.success || !result.attempted) {
          // 写入成功 或 没有写入需要尝试（如空列映射）→ 视为成功
          successCount += 1
          details?.push({
            kind: 'update',
            sid: u.sid,
            name: remote.name,
            row,
            fields: fields.includes('*') ? ['全部字段'] : [...fields],
          })
          records.push({
            sid: u.sid,
            name: remote.name ?? '',
            url: `https://bgm.tv/subject/${u.sid}`,
            type: BGM_SUBJECT_TYPES[2] ?? '',
            source: 'repo',
            content: '仓库同步-更新',
            status: '成功',
            message: fields.join(', '),
            count: 1,
          })
        } else {
          // 尝试了写入但全部失败
          details?.push({
            kind: 'fail',
            sid: u.sid,
            name: remote.name,
            row,
            message: '逐字段写入失败',
          })
          records.push({
            sid: u.sid,
            source: 'repo',
            content: '仓库同步-更新失败',
            status: '失败',
            message: '逐字段写入失败',
            count: 1,
          })
        }
      } catch (error_: unknown) {
        const errorMessage = error_ instanceof Error ? error_.message : String(error_)
        bgmLog(
          LOG_LEVELS.ERROR,
          `[batchUpdateRows] 行 ${String(row)} 逐字段写入也失败: ${errorMessage}`,
        )
        details?.push({
          kind: 'fail',
          sid: u.sid,
          name: remote.name,
          row,
          message: errorMessage,
        })
        records.push({
          sid: u.sid,
          source: 'repo',
          content: '仓库同步-更新失败',
          status: '失败',
          message: errorMessage,
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
  // 明细收集器：result.details 与本地 details 引用同一数组，push 直接走局部变量
  const details: GithubSyncDetailItem[] = []
  const result: GithubSyncResult = {
    remoteTotal: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    details,
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
  const isForceOverwrite = strategy === 'force-overwrite'

  // delete 操作需倒序执行（从大行号到小行号），避免行号错位
  const sortedDiffs = [...diffs]

  // 在开始前先发送初始进度：显示总条目数，避免进度条停留在"0/0"
  const total = diffs.length
  const addedDiffs = sortedDiffs.filter(
    (d): d is typeof d & { remote: NonNullable<typeof d.remote> } =>
      d.kind === 'add' && d.remote !== undefined,
  )
  const totalAdds = addedDiffs.length
  onProgress?.(0, total, `准备写入：新增 ${String(totalAdds)} 条，共 ${String(total)} 条差异`)

  // 让出事件循环，允许 DOM 渲染初始进度
  await yieldToEventLoop()

  // 性能优化：关闭屏幕刷新和自动计算，大幅减少 COM 调用开销
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
      bgmLog(LOG_LEVELS.INFO, '[githubSync] 已关闭屏幕刷新和自动计算')
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[githubSync] 关闭屏幕刷新失败: ${(error as Error).message}`)
  }

  // 性能追踪：记录开始时间
  const syncStartTime = Date.now()
  let lastProgressTime = syncStartTime

  // 开启 undo 会话：记录本次同步的所有单元格变更，便于用户撤销
  beginUndoSession(`${source ?? 'GitHub'} 同步 - 策略: ${strategy}`)

  // 收集本次同步记录
  const syncRecords: UpdateRecordParameters[] = []

  const nonAddDiffs = sortedDiffs.filter((d) => d.kind !== 'add')

  // 将 add diffs 分批写入（每批 BATCH_WRITE_SIZE 行）
  let processedAdds = 0
  for (let batchStart = 0; batchStart < totalAdds; batchStart += BATCH_WRITE_SIZE) {
    const batch = addedDiffs.slice(batchStart, batchStart + BATCH_WRITE_SIZE)
    const batchEntries = batch.map((d) => ({ remote: d.remote, sid: d.sid }))

    // 尝试批量写入
    const batchWritten = batchWriteNewRows(ws, colMap, nextAppendRow, batchEntries, syncRecords)

    if (batchWritten > 0) {
      result.added += batchWritten
      for (let index = 0; index < batchWritten; index += 1) {
        const entry = batch[index]
        if (entry?.remote) {
          details.push({
            kind: 'add',
            sid: entry.sid,
            name: entry.remote.name,
            row: nextAppendRow + index,
            fields: ['全部字段'],
          })
        }
      }
      nextAppendRow += batchWritten
    } else {
      // 批量写入失败，回退到逐行写入
      for (const diff of batch) {
        try {
          const writeResult = writeRemoteEntryToRow(
            ws,
            colMap,
            nextAppendRow,
            diff.remote,
            ['*'],
            isForceOverwrite,
          )
          if (writeResult.success || !writeResult.attempted) {
            // 写入成功 或 没有写入需要尝试（如空列映射）→ 视为成功
            const writtenRow = nextAppendRow
            nextAppendRow += 1
            result.added += 1
            details.push({
              kind: 'add',
              sid: diff.sid,
              name: diff.remote.name,
              row: writtenRow,
              fields: ['全部字段'],
            })
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
          } else {
            // 尝试了写入但全部失败
            result.failed += 1
            bgmLog(LOG_LEVELS.ERROR, `[githubSync] 逐行写入失败 sid=${diff.sid}: 写入全部失败`)
            details.push({
              kind: 'fail',
              sid: diff.sid,
              name: diff.remote.name,
              message: '逐字段写入失败',
            })
            syncRecords.push({
              sid: diff.sid,
              source,
              content: '仓库同步-新增失败',
              status: '失败',
              message: '逐字段写入失败',
              count: 1,
            })
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          result.failed += 1
          bgmLog(LOG_LEVELS.ERROR, `[githubSync] 逐行写入失败 sid=${diff.sid}: ${errorMessage}`)
          details.push({
            kind: 'fail',
            sid: diff.sid,
            name: diff.remote.name,
            message: errorMessage,
          })
          syncRecords.push({
            sid: diff.sid,
            source,
            content: '仓库同步-新增失败',
            status: '失败',
            message: errorMessage,
            count: 1,
          })
        }
      }
    }

    processedAdds += batch.length
    const now = Date.now()
    const elapsed = now - syncStartTime
    const speed = processedAdds > 0 && elapsed > 0 ? (processedAdds / elapsed) * 1000 : 0
    const remaining = totalAdds - processedAdds
    const eta = speed > 0 ? (remaining / speed) * 1000 : 0

    // 每批或每 500ms 更新一次进度（避免高频回调）
    if (now - lastProgressTime > 500 || processedAdds >= totalAdds) {
      onProgress?.(
        processedAdds,
        totalAdds,
        `新增 ${String(processedAdds)}/${String(totalAdds)} 条 (${speed > 0 ? speed.toFixed(0) : '?'} 行/秒)`,
        formatEta(eta),
      )
      lastProgressTime = now
    }

    // 让出事件循环，允许 DOM 渲染进度更新，避免 UI 卡顿
    if (processedAdds < totalAdds) {
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
    (d): d is typeof d & { localRow: number; remote: NonNullable<typeof d.remote> } =>
      d.kind === 'update' && d.localRow !== undefined && d.remote !== undefined,
  )
  const deletedDiffs = nonAddDiffs.filter(
    (d): d is typeof d & { localRow: number } => d.kind === 'delete' && d.localRow !== undefined,
  )

  // ---- 阶段 2a: 批量处理 update diffs ----
  let updateProcessed = 0
  const updateTotal = updateDiffs.length
  for (let batchStart = 0; batchStart < updateTotal; batchStart += BATCH_UPDATE_SIZE) {
    const batch = updateDiffs.slice(batchStart, batchStart + BATCH_UPDATE_SIZE)
    const batchUpdates = batch.map((d) => ({
      row: d.localRow,
      remote: d.remote,
      sid: d.sid,
      fields: d.changedFields,
    }))

    const batchUpdated = batchUpdateRows(
      ws,
      colMap,
      batchUpdates,
      isForceOverwrite,
      syncRecords,
      result.details,
    )
    result.updated += batchUpdated
    result.failed += batch.length - batchUpdated

    updateProcessed += batch.length
    const now = Date.now()
    if (now - lastProgressTime > 300 || updateProcessed >= updateTotal) {
      const totalProcessed = totalAdds + updateProcessed
      const elapsed = now - syncStartTime
      const speed = totalProcessed > 0 && elapsed > 0 ? (totalProcessed / elapsed) * 1000 : 0
      const remaining = updateTotal - updateProcessed + deletedDiffs.length
      const eta = speed > 0 ? (remaining / speed) * 1000 : 0
      onProgress?.(
        totalProcessed,
        total,
        `更新 ${String(updateProcessed)}/${String(updateTotal)} 条 (${speed > 0 ? speed.toFixed(0) : '?'} 行/秒)`,
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
  let processedDeletes = 0
  const totalDeletes = deletedDiffs.length
  // 记录删除阶段开始时间，用于计算删除阶段专用速度（更准确地估算剩余时间）
  const removalStartTime = Date.now()
  for (const diff of deletedDiffs) {
    try {
      const rowValues: Record<number, string> = {}
      for (const col of colMap.values()) {
        rowValues[col] = getCellValue(ws, diff.localRow, col)
      }
      recordRowDeleteEntry({ row: diff.localRow, values: rowValues })
      try {
        ws.Range(`${String(diff.localRow)}:${String(diff.localRow)}`).Delete()
        result.deleted += 1
        details.push({
          kind: 'delete',
          sid: diff.sid,
          row: diff.localRow,
          message: `删除行 ${String(diff.localRow)}`,
        })
        syncRecords.push({
          sid: diff.sid,
          source,
          content: '仓库同步-删除',
          status: '成功',
          message: `删除行 ${String(diff.localRow)}`,
          count: 1,
        })
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        bgmLog(
          LOG_LEVELS.WARN,
          `[githubSync] 删除行 ${String(diff.localRow)} 失败: ${errorMessage}`,
        )
        result.failed += 1
        details.push({
          kind: 'fail',
          sid: diff.sid,
          row: diff.localRow,
          message: errorMessage,
        })
        syncRecords.push({
          sid: diff.sid,
          source,
          content: '仓库同步-删除失败',
          status: '失败',
          message: errorMessage,
          count: 1,
        })
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      result.failed += 1
      bgmLog(LOG_LEVELS.ERROR, `[githubSync] 删除处理失败 sid=${diff.sid}: ${errorMessage}`)
      details.push({
        kind: 'fail',
        sid: diff.sid,
        row: diff.localRow,
        message: errorMessage,
      })
      syncRecords.push({
        sid: diff.sid,
        source,
        content: '仓库同步-失败',
        status: '失败',
        message: errorMessage,
        count: 1,
      })
    }

    processedDeletes += 1
    const now = Date.now()
    if (now - lastProgressTime > 300 || processedDeletes >= totalDeletes) {
      const totalProcessed = totalAdds + updateTotal + processedDeletes
      // 使用删除阶段专用速度（基于 removalStartTime），避免被前面快速的 add/update 拉高平均速度
      const removalElapsed = now - removalStartTime
      const removalSpeed =
        processedDeletes > 0 && removalElapsed > 0 ? (processedDeletes / removalElapsed) * 1000 : 0
      const remaining = totalDeletes - processedDeletes
      const eta = removalSpeed > 0 ? (remaining / removalSpeed) * 1000 : 0
      onProgress?.(
        totalProcessed,
        total,
        `删除 ${String(processedDeletes)}/${String(totalDeletes)} 条 (${removalSpeed > 0 ? removalSpeed.toFixed(0) : '?'} 行/秒)`,
        formatEta(eta),
      )
      lastProgressTime = now
    }

    // 每 10 条让出事件循环（delete 比 update 轻量，但仍需频繁让出）
    if (processedDeletes % 10 === 0 && processedDeletes < totalDeletes) {
      await yieldToEventLoop()
    }
  }

  // 统计 skip 数量（nonAddDiffs 中 kind='skip' 的条目）
  result.skipped = nonAddDiffs.length - updateDiffs.length - deletedDiffs.length

  // 结束 undo 会话（空会话不入栈）
  endUndoSession()

  // 计算总耗时
  const totalElapsed = Date.now() - syncStartTime
  const totalProcessed = totalAdds + nonAddDiffs.length
  const avgSpeed =
    totalProcessed > 0 && totalElapsed > 0 ? (totalProcessed / totalElapsed) * 1000 : 0

  // 恢复屏幕刷新和自动计算
  try {
    if (app) {
      if (previousScreenUpdating !== undefined) app.ScreenUpdating = previousScreenUpdating
      if (previousCalculation !== undefined) app.Calculation = previousCalculation
      bgmLog(LOG_LEVELS.INFO, '[githubSync] 已恢复屏幕刷新和自动计算')
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[githubSync] 恢复屏幕刷新失败: ${(error as Error).message}`)
  }

  // 写入同步记录与汇总行
  if (syncRecords.length > 0) {
    addSyncRecords(syncRecords)
  }
  addSyncRecordSummary({
    source,
    content: '仓库同步汇总',
    status: result.failed > 0 ? '失败' : '成功',
    message: `远程 ${String(result.remoteTotal)}，新增 ${String(result.added)}，更新 ${String(result.updated)}，删除 ${String(result.deleted)}，无变更 ${String(result.unchanged)}，失败 ${String(result.failed)}，策略: ${strategy}`,
    count: 1,
  })

  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] 应用完成: 新增 ${String(result.added)}，更新 ${String(result.updated)}，删除 ${String(result.deleted)}，失败 ${String(result.failed)}，耗时 ${formatDuration(totalElapsed)}，平均 ${avgSpeed > 0 ? avgSpeed.toFixed(0) : '?'} 行/秒`,
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
  if (resolutions.length === 0) {
    return diffs
  }

  // 按 sid 索引 resolutions，便于 O(1) 查找
  const resolutionByKey = new Map<string, ConflictResolution>()
  for (const r of resolutions) {
    resolutionByKey.set(`${r.sid}\u{0}${r.field}`, r)
  }

  // 倒序遍历，便于安全移除元素
  for (let index = diffs.length - 1; index >= 0; index -= 1) {
    const diff = diffs[index]
    if (
      diff?.kind === 'update' &&
      !(diff.changedFields.length === 1 && diff.changedFields[0] === '*')
    ) {
      diff.changedFields = diff.changedFields.filter((field) => {
        const key = `${diff.sid}\u{0}${field}`
        const r = resolutionByKey.get(key)
        // 若存在 resolution 且选择 local，则移除该字段；否则保留
        return r?.chosenValue !== 'local'
      })

      // 若所有字段都被移除，则该 diff 无需执行
      if (diff.changedFields.length === 0) {
        diffs.splice(index, 1)
      }
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
  shouldUseSelectedRowsOnly?: boolean,
  timeFilter?: SyncTimeFilter,
): Promise<GithubSyncResult> {
  const source: SyncSource = new GithubSyncSource()

  const validationResult = source.validateConfig()
  if (validationResult.isFail()) {
    const errorMessage = validationResult.error?.message ?? 'GitHub 同步源配置校验失败'
    throw new Error(errorMessage)
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
    `下载完成：${String(remoteEntries.length)} 条（耗时 ${formatDuration(downloadElapsed)}）`,
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

  const applyGithubEntries = async (): Promise<GithubSyncResult> => {
    // 空文档自动填充表头
    const ws = getDataSheet()
    if (ws) {
      const isFilled = ensureSheetHeaders(ws)
      if (isFilled) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 空文档已自动填充标准表头')
        onProgress?.(1, 3, '已自动填充表头，继续同步...')
      }
    }

    // 仅同步选中行：过滤远程条目
    let effectiveRemoteEntries = remoteEntries
    if (shouldUseSelectedRowsOnly) {
      const selectedSids = getSelectedRowSids()
      if (selectedSids.size === 0) {
        throw new Error('未选中任何行，或选中行中未找到 Bangumi URL')
      }
      effectiveRemoteEntries = remoteEntries.filter((entry) => selectedSids.has(entry.sid))
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromGithub] 仅同步选中行：选中 ${String(selectedSids.size)} 个 SID，匹配远程 ${String(effectiveRemoteEntries.length)} 条`,
      )
      onProgress?.(
        1,
        3,
        `选中 ${String(selectedSids.size)} 行，匹配远程 ${String(effectiveRemoteEntries.length)} 条`,
      )
    }

    // 时间筛选：按年份/季度/月份过滤远程条目
    if (timeFilter?.enabled && timeFilter.range !== 'all') {
      const beforeCount = effectiveRemoteEntries.length
      effectiveRemoteEntries = filterByTime(effectiveRemoteEntries, timeFilter)
      bgmLog(
        LOG_LEVELS.INFO,
        `[syncFromGithub] 时间筛选（${timeFilter.range}）：${String(beforeCount)} → ${String(effectiveRemoteEntries.length)} 条`,
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
        `[githubSync] 已应用 ${String(conflictResolution.length)} 条冲突解决决策`,
      )
    }

    const addedCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deletedCount = diffs.filter((d) => d.kind === 'delete').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[githubSync] diff 完成（${strategy}）：新增 ${String(addedCount)}，更新 ${String(updateCount)}，删除 ${String(deletedCount)}，耗时 ${formatDuration(diffElapsed)}`,
    )

    const result = await applyDiffToSheet(diffs, strategy, onProgress, source.getDisplayName())
    result.remoteTotal = effectiveRemoteEntries.length
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, effectiveRemoteEntries.length - addedCount - updateCount)

    const totalElapsed = Date.now() - syncStartTs
    const totalProcessed = addedCount + updateCount + deletedCount
    const overallSpeed =
      totalProcessed > 0 && totalElapsed > 0
        ? Math.round((totalProcessed / totalElapsed) * 1000)
        : 0
    onProgress?.(
      3,
      3,
      `完成：新增 ${String(result.added)}，更新 ${String(result.updated)}，删除 ${String(result.deleted)}（总耗时 ${formatDuration(totalElapsed)}，${String(overallSpeed > 0 ? overallSpeed : '?')} 行/秒）`,
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[githubSync] 同步完成：下载 ${formatDuration(downloadElapsed)}，diff ${formatDuration(diffElapsed)}，应用耗时已计入，总耗时 ${formatDuration(totalElapsed)}，处理 ${String(totalProcessed)} 条，平均 ${String(overallSpeed > 0 ? overallSpeed : '?')} 行/秒`,
    )
    return result
  }
  try {
    return await applyGithubEntries()
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
    bgmLog(
      LOG_LEVELS.INFO,
      `[getSelectedRowSids] 选区行范围: ${String(firstRow)}-${String(lastRow)}`,
    )

    const ws = app.ActiveSheet
    if (!ws) return sids
    const headerRow = findHeaderRow(ws) || 1
    const colMap = getColumnMap(ws, headerRow)
    const urlCol = colMap.get('Bangumi_URL')
    if (!urlCol) {
      bgmLog(LOG_LEVELS.WARN, '[getSelectedRowSids] 未找到 Bangumi_URL 列')
      return sids
    }

    for (let row = firstRow; row <= lastRow; row += 1) {
      const isNotHeaderRow = row !== headerRow
      if (isNotHeaderRow) {
        const url = trim(getCellValue(ws, row, urlCol))
        if (url) {
          const sid = extractSubjectId(url)
          if (sid) {
            sids.add(sid)
          }
        }
      }
    }

    bgmLog(LOG_LEVELS.INFO, `[getSelectedRowSids] 提取到 ${String(sids.size)} 个 SID`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[getSelectedRowSids] 提取失败: ${(error as Error).message}`)
  }
  return sids
}

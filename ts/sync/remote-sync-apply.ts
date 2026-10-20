/**
 * @fileoverview 同步 apply 阶段：读取本地条目，把差异写入 Excel 工作表
 * @module sync/remoteSyncApply
 * @description 2026-10-17 结构合并：本模块自 `github-sync.ts` 整体迁入（逐字保留
 *              注释、边界处理与日志），收录「比对完成后落盘」的全部逻辑：
 *                · readLocalEntriesForSync    本地条目读取（批量矩形读 + 逐格回退）
 *                · applyConflictResolutions   按用户冲突决策裁剪 update diff
 *                · applyDiffToSheet           新增/更新/删除写入 + undo + 同步记录
 *              及上述函数的私有辅助（批量写、逐字段回退、删除快照等）。
 *
 *              与 `remote-sync-core.ts`（runRemoteSync 统一编排）**必须分成两个模块**：
 *              `vi.mock` 截不住模块内调用，apply 与编排若同模块，sync-source-registry
 *              测试既有的「mock apply 三函数」接缝会整体失效（详见该测试的 mock 注释）。
 *
 *              入口为 remote-sync-core.ts；`github-sync.ts` 保留本模块导出的兼容
 *              re-export。日志 tag 保持 `[githubSync]` 逐字不变（检索连续性），
 *              编排层的 tag 另行参数化。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：bgmLog 定义在 tools/utility.ts（不在 core/constants.ts），与 BGM/getDataSheet 等同源导入
import { BGM_SUBJECT_TYPES, LOG_LEVELS } from '../core/constants.js'
import { getNotifyApi } from '../core/ui-bridge.js'
import {
  bgmLog,
  getDataSheet,
  findHeaderRow,
  getLastRow,
  getColumnMap,
  getCellValue,
  readRangeValues,
  readRangeCellValues,
  readRowsCache,
  setCellValue,
  colNumberToLetter,
  trim,
  getApp,
} from '../tools/util/index.js'
import type { WpsCellValue, WpsRange, WpsWorksheet } from '../tools/wps.js'

import { EXTENDED_FIELD_MAP, getExcelAliases, tagsToString } from './github-sync-diff.js'
import type {
  ConflictResolution,
  GithubRemoteEntry,
  GithubSyncDiff,
  GithubSyncDetailItem,
  LocalRowEntry,
  RemoteEmptyFieldStat,
  SyncStrategy,
} from './github-sync-diff.js'
import { resolveNewRowCellValue, resolveUpdateCellValue } from './github-cell-value.js'
import { remapColumnIndices, withoutColumns } from './sync-mapping.js'
import {
  DATE_COLUMNS,
  appendValueWithSeparator,
  formatDateToLocal,
  formatDuration,
  formatEta,
} from './github-time-format.js'
import { extractSubjectId } from './pure-utilities.js'
import { addSyncRecords, addSyncRecordSummary } from './sync-record.js'
import type { UpdateRecordParameters } from './sync-record.js'
import {
  beginUndoSession,
  endUndoSession,
  recordRowDeleteEntry,
  recordUndoEntry,
} from './undo-stack.js'

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
  /**
   * 「远程有数据、本地却缺少对应表头」的字段名清单
   *
   * 写入时 safeSet 遇缺失列会静默 return，远程数据被无声丢弃；
   * 这里把这类字段挑出来，由结果弹窗提示用户自行添加对应列。
   */
  missingColumns?: string[] /**
   * 分片拼接后因**缺少合法 sid** 被跳过的记录条数（>0 才出现）
   *
   * 与 `missingColumns` 同口径：链路内部原本只进 WARN 日志，用户看到的是
   * 「下载了 N 条、只同步了一部分」却说不出原因。缺合法 sid 的记录
   * （如数据文件混入表头行以外的坏行）会被静默跳过，这里显式计数
   * 由结果弹窗提示，数字大于 0 即说明数据源本身有脏数据。
   */
  skippedInvalidLines?: number
  /**
   * 「本地该列为空、远程对应字段也为空」的统计（按本地列名聚合，降序）
   *
   * 与 `missingColumns` 同口径的第三种体检：`computeDiff` 对扩展字段讲究
   * 「远程没值就不视为差异」（不能用远程空值抹掉本地数据），这是对的，
   * 但完全静默——用户看到「同步成功」却无从区分「远程本来就没数据」和
   * 「同步没生效」。数据仓库里这类字段很常见（如 `播放结束` 仅约 25% 非空），
   * 因此只进完成弹窗、不弹 toast。
   */
  remoteEmptyFields?: RemoteEmptyFieldStat[]
}

/**
 * applyDiffToSheet 的列映射选项（同步前列映射确认的下游落地）
 *
 * 由 `remote-sync-core.ts` 从 `SyncMappingConfig` 构建：
 * - `excludedColumns`：用户取消同步的列（含别名闭包）→ 从 colMap 摘除
 * - `columnRemap`：默认列名 → 目标列号（改映射）→ 替换默认列的列号
 */
export interface ApplyMappingOptions {
  /** 取消同步的列名集合（含别名闭包） */
  excludedColumns?: ReadonlySet<string> | undefined
  /** 默认列名 → 用户选定的目标列号 */
  columnRemap?: ReadonlyMap<string, number> | undefined
}

// ========== 本地数据读取 ==========

/**
 * 读取本地 Excel 工作表的所有条目（按 SID 索引）
 * @param worksheet 工作表
 * @param colMap 列映射
 * @param headerRow 表头行
 * @param lastRow 最后数据行
 * @returns SID → 本地行条目 的映射
 */
function readLocalEntries(
  worksheet: WpsWorksheet,
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

  // ===== 批量读取优化：一次矩形读替代逐单元格 getCellValue =====
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

  // 一次性读取整个矩形区域（统一走 `readRangeValues`，内部 readRect 含形状守卫）：
  //  · 单行范围宿主返回**一维**数组时由 normalizeValue2Shape 按请求形状升维 ——
  //    旧内联实现直接把 `Array.isArray(raw)` 的结果当二维数组用，本地只有 1 条
  //    数据时 rawData[0] 会退化成「第 1 个单元格的值」，整行字段读成空串 → SID
  //    提取失败 → 该行被跳过 → 远程同一 SID 被判为新增，**重复写一行**；
  //  · 读失败 / 形状不可信一律按读取失败处理，绝不猜形状。
  // `readRangeValues` 无法区分「真空区域」与「读失败」（两者都返回 []），因此以
  // **读回行数 === 请求行数** 作为可用判据：不符即回退逐单元格读（空表逐格读
  // 同样得到空串，最终结果与旧行为一致）。
  const rect = readRangeValues(worksheet, startRow, lastRow, minCol, maxCol)
  const rawData: string[][] | null = rect.length === rowCount ? rect : null
  if (!rawData) {
    // readRangeValues 读失败（COM 异常/形状不可信）时返回 []，与「真空区域」
    // 不可区分；行数判据触发回退时补一条 WARN —— 与旧内联 catch 分支等价，
    // 同步失败时能看出是「区域读挂了回退逐格」而非静默降级。
    bgmLog(LOG_LEVELS.WARN, '[githubSync] 批量读取失败，回退到逐单元格')
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
    // readRangeValues 已把单元格值一律 String() 化（null → 空串）；
    // `?? ''` 兜住索引越界——宿主返回的行宽小于目标列号时下标为 undefined。
    return trim(rowArray[index] ?? '')
  }

  /** 逐单元格读取（回退用） */
  const getFieldFromCell = (row: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    return trim(getCellValue(worksheet, row, col))
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
 * - 工作表无效（worksheet 为 null）：返回 null，调用方应抛出错误
 * - 无 Bangumi_URL 列（空文档或表头未识别）：返回空 entries + lastRow=0
 *   调用方 computeDiff 会将所有远程条目视为新增
 */
export function readLocalEntriesForSync(): {
  entries: Map<string, LocalRowEntry>
  lastRow: number
} | null {
  const worksheet = getDataSheet()
  if (!worksheet) return null
  const headerRow = findHeaderRow(worksheet) || 1
  const lastRow = getLastRow(worksheet)
  const colMap = getColumnMap(worksheet, headerRow)
  if (!colMap.has('Bangumi_URL')) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[githubSync] 未找到 Bangumi_URL 列（headerRow=${String(headerRow)}），视为空文档，所有远程条目将作为新增`,
    )
    // 返回空 entries，让 computeDiff 将所有远程条目视为新增
    return { entries: new Map(), lastRow: headerRow }
  }
  const entries = readLocalEntries(worksheet, colMap, headerRow, lastRow)
  return { entries, lastRow }
}

// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 *
 * 特殊合并策略：
 * - 标签/分级：远程标签追加到本地后面，使用 ` | ` 分隔
 * - 名称：远程名称追加到「别名」列，使用 ` | ` 分隔（保留本地名称列不变）
 *
 * @param worksheet 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（含 '*' 表示写入所有字段）
 * @param shouldForceOverwrite 是否强制覆盖（true 时远程空值也清空本地；false 时远程空值跳过）
 */
function writeRemoteEntryToRow(
  worksheet: WpsWorksheet,
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
    const oldValue = getCellValue(worksheet, row, col)
    // 值无变化时跳过写入，避免空字符串重复写入并污染 undo 栈
    if (oldValue === value) return

    isAnyAttempted = true

    // 日期列：转换为本地"年月日"字符串格式
    if (DATE_COLUMNS.has(key)) {
      const localDate = formatDateToLocal(value)
      if (localDate !== null) {
        recordUndoEntry({ row, col, oldValue, updatedValue: localDate })
        if (setCellValue(worksheet, row, col, localDate)) {
          isAnySucceeded = true
        }
        return
      }
    }

    // 非日期列或日期解析失败：写入字符串
    recordUndoEntry({ row, col, oldValue, updatedValue: value })
    if (setCellValue(worksheet, row, col, value)) {
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

    const oldValue = getCellValue(worksheet, row, col)
    const updatedValue = appendValueWithSeparator(oldValue, appendValue)
    if (updatedValue === oldValue) return

    isAnyAttempted = true
    recordUndoEntry({ row, col, oldValue, updatedValue })
    if (setCellValue(worksheet, row, col, updatedValue)) {
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
        const localTags = col ? getCellValue(worksheet, row, col) : ''
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
 * 写入单行更新值并记录 undo（一次 COM 调用写入整行）
 *
 * 独立辅助函数：避免在循环内定义闭包捕获外部可变变量（no-loop-func），
 * 通过返回值累加成功数。
 *
 * @returns 1 表示该行写入成功（计入 successCount），0 表示失败或无需写入
 */
function writeRowValuesWithUndo(
  worksheet: WpsWorksheet,
  colMap: Map<string, number>,
  u: { sid: string },
  row: number,
  remote: GithubRemoteEntry,
  fields: string[],
  minCol: number,
  colCount: number,
  oldArray: WpsCellValue[],
  rowValues: (string | number | null)[],
  range: WpsRange | null,
  shouldForceOverwrite: boolean,
  details: GithubSyncDetailItem[] | undefined,
  records: UpdateRecordParameters[],
): number {
  if (range) {
    // 使用已读取的旧值（oldArray 由 readRangeCellValues 在循环开始前读取）
    // **以旧值为基底**铺满整行：本次不写的列原值写回，而不是铺 null。
    // 原因：null 在 Range.Value2 二维数组里的语义是「清空该单元格」，而
    // minCol..maxCol 之间可能夹着**不属于本次 writeCols** 的列 ——
    // writeCols 是整批 updates 的 fields 并集，列号并不连续（例如一批里
    // 有人只改「名称」(列2)、有人只改「评分」(列30)，区间 3..29 全是用户数据）。
    // 原实现把这些位置铺成 null，等于把用户在中段列的数据清掉。
    let hasChanges = false
    const finalValues: WpsCellValue[] = Array.from(
      { length: colCount },
      (_, c) => oldArray[c] ?? null,
    )
    for (let c = 0; c < colCount; c += 1) {
      const updatedValue = rowValues[c] ?? null
      if (updatedValue !== null) {
        const oldValue = oldArray[c] == null ? '' : String(oldArray[c])
        const valueString = String(updatedValue)
        if (oldValue === valueString) {
          // 无变化：finalValues[c] 已是旧值，无需处理
        } else {
          hasChanges = true
          finalValues[c] = updatedValue
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

  const outcome = fallbackWriteRemoteEntry({
    worksheet,
    colMap,
    row,
    remote,
    fields,
    forceOverwrite: shouldForceOverwrite,
    sid: u.sid,
    kind: 'update',
    content: '仓库同步-更新',
    failContent: '仓库同步-更新失败',
    source: 'repo',
    okMessage: `${fields.join(', ')} (回退逐字段写入)`,
    failRow: row,
    details,
    records,
  })
  if (outcome.ok) return 1

  if (outcome.errorMessage === undefined) {
    bgmLog(LOG_LEVELS.ERROR, `[batchUpdateRows] 行 ${String(row)} 回退逐字段写入全部失败`)
  } else {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[batchUpdateRows] 行 ${String(row)} 回退逐字段写入异常: ${outcome.errorMessage}`,
    )
  }
  return 0
}

/**
 * 批量写不可用时回退到逐字段写入，并统一记录同步明细与同步记录。
 *
 * 三处调用点此前各有一份逐字重复的 ~35 行样板 ——「调 `writeRemoteEntryToRow`
 * → 判 `success || !attempted` → push 明细 + 同步记录」：
 *
 *   · `writeRowValuesWithUndo`：整行 `Range` 读旧值失败（`range === null`）
 *   · `batchUpdateRows`：整行写入抛异常
 *   · `applyDiffToSheet`：新增行的批量写失败
 *
 * 三者的**业务差异**（记 add 还是 update、成功/失败文案、失败明细带不带行号）由参数传入；
 * ⚠️ **日志不在这里打** —— 三处的日志文案、级别与触发条件各不相同，且测试按文案断言
 * （`回退逐字段写入全部失败` / `逐字段写入也失败` / `逐行写入失败`），
 * 一律留给调用方按返回的 `errorMessage` 自行记录。
 *
 * @returns `ok` 为 true 表示写入成功（含「没有需要写入的字段」）；
 *          抛异常时 `ok` 为 false 并带上 `errorMessage`
 */
function fallbackWriteRemoteEntry(parameters: {
  worksheet: WpsWorksheet
  colMap: Map<string, number>
  row: number
  remote: GithubRemoteEntry
  fields: string[]
  forceOverwrite: boolean
  sid: string
  /** 明细类型：更新写 'update'，新增写 'add' */
  kind: 'update' | 'add'
  /** 成功时同步记录的 content */
  content: string
  /** 失败时同步记录的 content */
  failContent: string
  source: string | undefined
  /** 成功时同步记录的 message；不传则不带该字段（新增路径原本就不带） */
  okMessage?: string | undefined
  /** 失败明细里附的行号；新增失败时行号未定，不传（与原实现一致） */
  failRow?: number | undefined
  details: GithubSyncDetailItem[] | undefined
  records: UpdateRecordParameters[]
}): { ok: boolean; errorMessage?: string | undefined } {
  const {
    worksheet,
    colMap,
    row,
    remote,
    fields,
    forceOverwrite,
    sid,
    kind,
    content,
    failContent,
    source,
    okMessage,
    failRow,
    details,
    records,
  } = parameters

  try {
    const result = writeRemoteEntryToRow(worksheet, colMap, row, remote, fields, forceOverwrite)
    if (result.success || !result.attempted) {
      // 写入成功 或 没有写入需要尝试（如空列映射）→ 视为成功
      details?.push({
        kind,
        sid,
        name: remote.name,
        row,
        fields: fields.includes('*') ? ['全部字段'] : [...fields],
      })
      records.push({
        sid,
        name: remote.name ?? '',
        url: `https://bgm.tv/subject/${sid}`,
        type: BGM_SUBJECT_TYPES[2] ?? '',
        source,
        content,
        status: '成功',
        ...(okMessage !== undefined && { message: okMessage }),
        count: 1,
      })
      return { ok: true }
    }

    // 尝试了写入但全部失败
    details?.push({
      kind: 'fail',
      sid,
      name: remote.name,
      ...(failRow !== undefined && { row: failRow }),
      message: '逐字段写入失败',
    })
    records.push({
      sid,
      source,
      content: failContent,
      status: '失败',
      message: '逐字段写入失败',
      count: 1,
    })
    return { ok: false }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    details?.push({
      kind: 'fail',
      sid,
      name: remote.name,
      ...(failRow !== undefined && { row: failRow }),
      message: errorMessage,
    })
    records.push({
      sid,
      source,
      content: failContent,
      status: '失败',
      message: errorMessage,
      count: 1,
    })
    return { ok: false, errorMessage }
  }
}
interface WriteCol {
  name: string
  col: number
}

/**
 * 按列名清单收集「待写列」，去重后按列号升序返回。
 *
 * `batchWriteNewRows` 与 `batchUpdateRows` 此前各有一份逐字重复的
 * 「seen 去重 + colMap 查列号 + 排序」逻辑，收敛为一份，避免后续各自漂移。
 *
 * @param colMap 列映射（列名 → 列号）
 * @param names 候选列名（可重复、可无序；colMap 里没有的列会被跳过）
 * @returns 去重且按列号升序的待写列
 */
function collectWriteCols(colMap: Map<string, number>, names: Iterable<string>): WriteCol[] {
  const writeCols: WriteCol[] = []
  const uniqueNames = new Set(names)
  for (const name of uniqueNames) {
    const col = colMap.get(name)
    if (col) writeCols.push({ name, col })
  }
  writeCols.sort((a, b) => a.col - b.col)
  return writeCols
}

/**
 * 批量写入新增行（使用 Range.Value2 二维数组，比逐行写入快 100-1000x）
 *
 * 原理：WPS COM 的跨进程调用是主要瓶颈。逐行写入时每个 setCellValue 都是
 * 一次独立 COM 调用。Range.Value2 接受二维数组后，WPS 内部批量处理，
 * 一次 COM 调用即可完成整个矩形区域的写入。
 *
 * @param worksheet 工作表
 * @param colMap 列映射（列名 → 列号）
 * @param startRow 起始行号
 * @param rows 要写入的行数据（GithubRemoteEntry 格式）
 * @param records 同步记录收集器（传入后函数会 push 记录）
 * @returns 成功写入的行数
 */
function batchWriteNewRows(
  worksheet: WpsWorksheet,
  colMap: Map<string, number>,
  startRow: number,
  rows: { remote: GithubRemoteEntry; sid: string }[],
  records: UpdateRecordParameters[],
): number {
  if (rows.length === 0) return 0

  // 1. 收集需要写入的列（按列号升序排列）
  const pendingFieldNames = ['Bangumi_URL', '名称', '标签/分级', '集数']
  for (const [, excelField] of EXTENDED_FIELD_MAP) {
    pendingFieldNames.push(excelField)
  }
  const writeCols = collectWriteCols(colMap, pendingFieldNames)
  // 空列映射（表头完全认不出）时必须早退：否则 minCol/maxCol 退化成 1，
  // 会把一整列 null 写进 A 列覆盖用户数据，且不触发下方的逐行回退。
  if (writeCols.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[batchWriteNewRows] 未找到任何可写入的列')
    return 0
  }
  // 上方已守卫 writeCols 非空，?? 分支仅为类型层兜底
  const minCol = writeCols[0]?.col ?? 1
  const maxCol = writeCols.at(-1)?.col ?? minCol
  const colCount = maxCol - minCol + 1

  // 2. 构建二维值数组（列对齐到 minCol 偏移）
  // 日期列（开播日期、完播日）写入数值序列号以保留本地列格式
  //
  // **以目标区域旧值为基底**：minCol..maxCol 之间可能夹着不属于 writeCols 的用户列
  // （writeCols 只收录 colMap 里认得的字段）。若直接铺 null，会把用户在这些列的数据清掉。
  // 且 nextAppendRow 由锚定列的 End(xlUp) 定位，锚定列比别的列短时，目标行本来就有用户数据。
  // 读不到旧值（空表/读失败）时旧值全为 null，与原行为一致。
  const startColLetter = colNumberToLetter(minCol)
  const endColLetter = colNumberToLetter(maxCol)
  const endRow = startRow + rows.length - 1
  // 读旧值基底：统一走 `readRangeCellValues`（内部 readRect 含形状守卫）。
  //  · 单行范围（endRow === startRow）宿主返回**一维**数组，由 normalizeValue2Shape
  //    按请求形状升维——旧手工归一只处理了 `raw[0]` 是否为数组，多行范围返回
  //    一维时（宿主异常）仍会被当成二维，基底错位会把旧值写进错误的列；
  //  · 读失败 / 形状不可信返回 []，按「无旧值基底」处理——新增行的目标区域
  //    通常为空，读失败的影响面与原手工 catch 分支一致（oldRows = []）。
  // 必须保留单元格原始类型（preserveCellValue）：基底列可能是数字/日期，
  // String() 化后整行写回会把用户的数据列变成文本列。
  const oldRows = readRangeCellValues(worksheet, startRow, endRow, minCol, maxCol)

  const values: WpsCellValue[][] = []
  for (const [rowIndex, entry] of rows.entries()) {
    const row: WpsCellValue[] = Array.from(
      { length: colCount },
      (_, c) => oldRows[rowIndex]?.[c] ?? null,
    )
    for (const wc of writeCols) {
      const index = wc.col - minCol
      row[index] = resolveNewRowCellValue(wc, entry)
    }
    values.push(row)
  }

  // 3. 批量写入 Range.Value2
  try {
    const rangeAddr = `${startColLetter}${String(startRow)}:${endColLetter}${String(endRow)}`
    const range = worksheet.Range(rangeAddr)
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
 * @param worksheet 工作表
 * @param colMap 列映射
 * @param updates 要更新的行列表（row=行号, remote=远程数据, fields=要更新的字段）
 * @param shouldForceOverwrite 是否强制覆盖
 * @param records 同步记录收集器
 * @param details 同步明细收集器（用于详情表格展示）
 * @returns 成功更新的行数
 */
function batchUpdateRows(
  worksheet: WpsWorksheet,
  colMap: Map<string, number>,
  updates: { row: number; remote: GithubRemoteEntry; sid: string; fields: string[] }[],
  shouldForceOverwrite: boolean,
  records: UpdateRecordParameters[],
  details?: GithubSyncDetailItem[],
): number {
  if (updates.length === 0) return 0

  // 1. 收集需要写入的列
  const updateFieldNames: string[] = []
  const addName = (name: string): void => {
    updateFieldNames.push(name)
  }

  // 根据 updates 中所有 fields 的并集确定需要写入的列
  // 注意：名称字段在不同场景下有不同处理：
  // - forceOverwrite 或 writeAll：写入「名称」列
  // - 普通更新：追加到「别名」列
  for (const u of updates) {
    const isWriteAll = u.fields.includes('*')
    if (isWriteAll || u.fields.includes('Bangumi_URL')) addName('Bangumi_URL')
    if (isWriteAll || u.fields.includes('名称')) {
      // 强制覆盖/新增时写入名称列
      addName('名称')
      // 普通更新时写入别名列
      addName('别名')
    }
    if (isWriteAll || u.fields.includes('标签/分级')) addName('标签/分级')
    if (isWriteAll || u.fields.includes('集数')) addName('集数')
    // 扩展字段：同时检查主映射和所有别名（如「动画制作公司」→「制作公司」/「动画制作公司」）
    const handled = new Set<string>()
    for (const [jsonlField] of EXTENDED_FIELD_MAP) {
      const isUnhandledJsonlField = !handled.has(jsonlField)
      if (isUnhandledJsonlField) {
        handled.add(jsonlField)
        const aliases = getExcelAliases(jsonlField)
        if (isWriteAll || aliases.some((a) => u.fields.includes(a))) {
          for (const a of aliases) addName(a)
        }
      }
    }
  }

  const writeCols = collectWriteCols(colMap, updateFieldNames)
  if (writeCols.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[batchUpdateRows] 未找到任何可写入的列')
    return 0
  }
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
    // 统一走 `readRangeCellValues`（内部 readRect 含形状守卫）：单行范围宿主
    // 返回**一维**数组时由 normalizeValue2Shape 按请求形状升维，读失败返回 []
    // （旧值全空）——旧内联实现遇到 `Value2` 为 null 时 oldArray 为空数组，
    // 由下方宽度守卫回退逐字段写入，语义一致。
    const oldArray: WpsCellValue[] =
      readRangeCellValues(worksheet, row, row, minCol, maxCol)[0] ?? []

    // 旧值读不全（读失败返回 []、或列数不足 colCount）时放弃批量路径：
    // 批量路径用 oldArray 做「本地 | 远程」合并，空旧值会使用户已有的标签/别名
    // 被远程值**整体替换**（静默丢失本地数据，违反「读失败＝放弃写入」铁律）。
    // update diff 的行必然带 Bangumi URL（匹配依据），不可能整行为空，
    // 因此旧值读不全一律按「读失败」处理，交给逐字段回退。
    // 读-改-写还需要 Range 对象：宽度够用时才取；取不到（COM 异常）同样回退。
    // （读走 readRect、写单独取 Range，比旧实现「读+写复用同一个 Range」多一次
    //  Range 获取；换来形状守卫只有一份实现，不做第二份会漂移。）
    let range: WpsRange | null = null
    if (oldArray.length < colCount) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[batchUpdateRows] 行 ${String(row)} 旧值读取失败或形状异常，回退逐字段写入（避免空值合并覆盖本地数据）`,
      )
    } else {
      try {
        const rangeAddr = `${colNumberToLetter(minCol)}${String(row)}:${colNumberToLetter(maxCol)}${String(row)}`
        range = worksheet.Range(rangeAddr)
      } catch {
        bgmLog(
          LOG_LEVELS.WARN,
          `[batchUpdateRows] 行 ${String(row)} 获取写入范围失败，回退逐字段写入`,
        )
        range = null
      }
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
        worksheet,
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
      // 回退到逐字段写入（失败时不额外打日志，与原实现一致）
      const outcome = fallbackWriteRemoteEntry({
        worksheet,
        colMap,
        row,
        remote,
        fields,
        forceOverwrite: shouldForceOverwrite,
        sid: u.sid,
        kind: 'update',
        content: '仓库同步-更新',
        failContent: '仓库同步-更新失败',
        source: 'repo',
        okMessage: fields.join(', '),
        failRow: row,
        details,
        records,
      })
      if (outcome.ok) {
        successCount += 1
      } else if (outcome.errorMessage !== undefined) {
        bgmLog(
          LOG_LEVELS.ERROR,
          `[batchUpdateRows] 行 ${String(row)} 逐字段写入也失败: ${outcome.errorMessage}`,
        )
      }
    }
  }

  return successCount
}

/**
 * 删除阶段 undo 快照：一次矩形读替代「N 行 × M 列」次逐格读。
 *
 * 删除是倒序逐行执行的，但**在任何删除发生之前**所有待删行都还在原始行号上，
 * 因此可以在循环外一次读回整段（见 `readRowsCache`），再按需要的列抽成快照。
 *
 * @param worksheet 工作表
 * @param rows 待删行号（原始行号，尚未发生任何删除）
 * @param cols 需要快照的列号
 * @returns 行号 → (列号 → 单元格文本)；`null` 表示批量读不可用，调用方须回退逐格读
 */
function buildRemovalSnapshot(
  worksheet: WpsWorksheet | null | undefined,
  rows: readonly number[],
  cols: readonly number[],
): Map<number, ReadonlyMap<number, string>> | null {
  if (rows.length === 0 || cols.length === 0) return new Map()
  let maxCol = cols[0] ?? 0
  for (const col of cols) {
    if (col > maxCol) maxCol = col
  }
  const cache = readRowsCache(worksheet, rows, maxCol)
  if (!cache) return null
  const snapshot = new Map<number, ReadonlyMap<number, string>>()
  for (const row of rows) {
    const line = cache.get(row)
    if (!line) return null
    const cells = new Map<number, string>()
    for (const col of cols) cells.set(col, line[col - 1] ?? '')
    snapshot.set(row, cells)
  }
  return snapshot
}

/**
 * 应用 diff 到 Excel 工作表
 *
 * 取消（P2-7）：`signal` 在**写入阶段同样生效**。每批写入前检查一次，已写入的部分
 * 保持既定状态（同步记录 / undo 栈 / 颜色都按实际写入量收敛，不回滚），未处理的
 * 条目计入 `result.skipped`。原先 signal 只作用于下载阶段，用户点「停止」后写入
 * 仍会跑完，进度状态与实际不一致。
 *
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message, eta）
 * @param source 同步来源显示名称（如 GitHub/GitLab/Gitee），用于写入同步记录
 * @param signal 可选 AbortSignal，用于取消写入
 * @returns 同步结果统计
 */
export async function applyDiffToSheet(
  diffs: GithubSyncDiff[],
  strategy: SyncStrategy,
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  source?: string,
  signal?: AbortSignal,
  options?: ApplyMappingOptions,
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

  const worksheet = getDataSheet()
  if (!worksheet) {
    bgmLog(LOG_LEVELS.ERROR, '[githubSync] applyDiffToSheet: 未找到数据工作表')
    result.failed = diffs.length
    return result
  }

  const headerRow = findHeaderRow(worksheet) || 1
  const lastRow = getLastRow(worksheet)
  let colMap = getColumnMap(worksheet, headerRow)
  // 同步前列映射（2026-10-17）：用户取消同步的列从 colMap 摘除、改映射的列把默认
  // 列号换成目标列号。下游所有写入点（批量写 / writeRowValuesWithUndo /
  // writeRemoteEntryToRow / fallback）都经 colMap 寻址，在此一层变换即全覆盖，
  // 无需给每个写入函数加参。默认 undefined 时行为与从前逐字一致。
  if (options?.columnRemap !== undefined) {
    colMap = remapColumnIndices(colMap, options.columnRemap)
  }
  if (options?.excludedColumns !== undefined && options.excludedColumns.size > 0) {
    colMap = withoutColumns(colMap, options.excludedColumns)
  }
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

  // 下载阶段就已被取消：不进入任何写入（此时 undo 会话未开、屏幕刷新未关，可直接返回）
  if (signal?.aborted === true) {
    result.skipped = total
    onProgress?.(0, total, `已停止：未开始写入，${String(total)} 条未处理`)
    return result
  }

  // 写入阶段的取消计数（P2-7）：各阶段的"未处理"条目在循环里累计，末段统一报给用户
  let remainingAdds = 0
  let remainingUpdates = 0
  let remainingDeletes = 0

  /**
   * 写入阶段是否已被请求取消。
   *
   * 写成函数而非裸比较：上面的提前返回已把 `signal.aborted` 收窄为 `false | undefined`，
   * 后续再直接比较会触发 TS2367（两侧类型无重叠）。
   */
  const isWriteCancelled = (): boolean => signal?.aborted === true

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
    // 每批写入前检查取消（P2-7）：已写入的批次保持既定状态，未处理的计入 skipped
    if (isWriteCancelled()) {
      remainingAdds = totalAdds - processedAdds
      break
    }
    const batch = addedDiffs.slice(batchStart, batchStart + BATCH_WRITE_SIZE)
    const batchEntries = batch.map((d) => ({ remote: d.remote, sid: d.sid }))

    // 尝试批量写入
    const batchWritten = batchWriteNewRows(
      worksheet,
      colMap,
      nextAppendRow,
      batchEntries,
      syncRecords,
    )

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
        const outcome = fallbackWriteRemoteEntry({
          worksheet,
          colMap,
          row: nextAppendRow,
          remote: diff.remote,
          fields: ['*'],
          forceOverwrite: isForceOverwrite,
          sid: diff.sid,
          kind: 'add',
          content: '仓库同步-新增',
          failContent: '仓库同步-新增失败',
          source,
          details,
          records: syncRecords,
        })
        if (outcome.ok) {
          nextAppendRow += 1
          result.added += 1
        } else {
          result.failed += 1
          bgmLog(
            LOG_LEVELS.ERROR,
            `[githubSync] 逐行写入失败 sid=${diff.sid}: ${outcome.errorMessage ?? '写入全部失败'}`,
          )
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
    // 每批更新前检查取消（P2-7）
    if (isWriteCancelled()) {
      remainingUpdates = updateTotal - updateProcessed
      break
    }
    const batch = updateDiffs.slice(batchStart, batchStart + BATCH_UPDATE_SIZE)
    const batchUpdates = batch.map((d) => ({
      row: d.localRow,
      remote: d.remote,
      sid: d.sid,
      fields: d.changedFields,
    }))

    const batchUpdated = batchUpdateRows(
      worksheet,
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
  // 快照必须在任何删除发生之前取：此刻所有待删行仍在原始行号上（新增是追加、更新不移动行）
  const removalSnapshot = buildRemovalSnapshot(
    worksheet,
    deletedDiffs.map((d) => d.localRow),
    [...colMap.values()],
  )
  for (const diff of deletedDiffs) {
    // 每条删除前检查取消（P2-7）：删除是倒序逐行的，中断点即已删与未删的边界
    if (isWriteCancelled()) {
      remainingDeletes = totalDeletes - processedDeletes
      break
    }
    try {
      const rowValues: Record<number, string> = {}
      const snapshotCells = removalSnapshot?.get(diff.localRow)
      for (const col of colMap.values()) {
        rowValues[col] = snapshotCells?.get(col) ?? getCellValue(worksheet, diff.localRow, col)
      }
      recordRowDeleteEntry({ row: diff.localRow, values: rowValues })
      try {
        worksheet.Range(`${String(diff.localRow)}:${String(diff.localRow)}`).Delete()
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

  // 写入阶段被取消：未处理条目计入 skipped，并把结束进度如实报给用户（P2-7）。
  // 已写入的部分不回滚 —— 同步记录 / undo 栈 / 行颜色都按实际写入量收敛，
  // 保证"表里有什么"和"记录里写了什么"一致。
  const remainingAfterStop = remainingAdds + remainingUpdates + remainingDeletes
  if (remainingAfterStop > 0) {
    result.skipped += remainingAfterStop
    const processedAfterStop = total - remainingAfterStop
    bgmLog(
      LOG_LEVELS.WARN,
      `[githubSync] 写入阶段被用户取消：已处理 ${String(processedAfterStop)}/${String(total)} 条（新增未处理 ${String(remainingAdds)}，更新未处理 ${String(remainingUpdates)}，删除未处理 ${String(remainingDeletes)}）`,
    )
    onProgress?.(
      processedAfterStop,
      total,
      `已停止：已写入 ${String(processedAfterStop)} 条，剩余 ${String(remainingAfterStop)} 条未处理`,
    )
  }

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
  if (syncRecords.length > 0 && !addSyncRecords(syncRecords)) {
    // 失败必须让用户看见：工作簿已改但同步记录没落盘，等于静默丢数据（P1-E）
    getNotifyApi().toast(
      `同步记录写入失败：${String(syncRecords.length)} 条记录未登记，请检查「同步记录」工作表`,
      'error',
    )
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

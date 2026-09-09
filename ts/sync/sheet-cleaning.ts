/**
 * 锁定数据表的重复行清洗核心（与 UI 解耦，供主面板清洗按钮与富化完成后自动去重共用）。
 * @module sync/sheet-cleaning
 * @description 按「名称」列分组识别重复行：保留含 Bangumi_URL 的行、合并被删除行的
 *              「标签/分级」到保留行、批量删除无 URL 的重复行。
 *              不做任何 UI 交互（toast/弹窗），由调用方根据返回结果自行提示。
 */

import type { WpsWorksheet } from '../tools/wps.js'
import { LOG_LEVELS } from '../core/constants.js'
import {
  bgmLog,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  readRangeValues,
  setCellValue,
} from '../tools/util/index.js'

/** 清洗结果摘要 */
export interface CleanDuplicatesResult {
  /** 是否执行了删除（发生重复清洗） */
  performed: boolean
  /** 删除的重复行数 */
  deletedRows: number
  /** 合并了标签的名称组数 */
  mergedTagGroups: number
  /** 重复名称组数 */
  duplicateNameGroups: number
  /** 未执行清洗的原因（无重复/缺列/无数据等），已执行时为 undefined */
  skippedReason?: string | undefined
}

/** 未执行清洗时的空结果（附原因） */
function emptyResult(skippedReason?: string): CleanDuplicatesResult {
  return {
    performed: false,
    deletedRows: 0,
    mergedTagGroups: 0,
    duplicateNameGroups: 0,
    skippedReason,
  }
}

/** 单个重复名称组的清洗结果 */
interface DuplicateGroupOutcome {
  /** 保留行（组内首个含 URL 的行） */
  keepRow: number
  /** 待删除行（组内无 URL 的行） */
  deleteRows: number[]
  /** 合并进保留行的标签描述（如 "名称: 标签A | 标签B"）；未发生合并时为 undefined */
  mergedEntry: string | undefined
}

/**
 * 解析单个重复名称组：保留组内首个含 Bangumi_URL 的行，把无 URL 行的
 * 「标签/分级」合并进保留行（去重），返回待删除行。
 * 组内全无 URL 时返回 null（跳过不删，避免误删唯一数据）。
 */
function resolveDuplicateGroup(
  ws: WpsWorksheet,
  headerRow: number,
  urlData: string[][],
  tagsData: string[][] | null,
  tagsCol: number | undefined,
  name: string,
  rows: number[],
): DuplicateGroupOutcome | null {
  const withUrl: number[] = []
  const withoutUrl: number[] = []
  for (const row of rows) {
    const index = row - headerRow - 1
    const url = index < urlData.length ? (urlData[index]?.[0] ?? '').trim() : ''
    ;(url ? withUrl : withoutUrl).push(row)
  }

  const keepRow = withUrl[0]
  if (keepRow === undefined) return null

  const nameNewTags: string[] = []
  if (tagsData && withoutUrl.length > 0) {
    const keepIndex = keepRow - headerRow - 1
    const existingSet = new Set(
      (keepIndex < tagsData.length ? (tagsData[keepIndex]?.[0] ?? '') : '')
        .split(/\s*\|\s*/)
        .map((t) => t.trim())
        .filter(Boolean),
    )

    for (const delRow of withoutUrl) {
      const delIndex = delRow - headerRow - 1
      const delTags = delIndex < tagsData.length ? (tagsData[delIndex]?.[0] ?? '').trim() : ''
      if (delTags) {
        for (const t of delTags.split(/\s*\|\s*/)) {
          const trimmed = t.trim()
          if (trimmed && !existingSet.has(trimmed)) {
            nameNewTags.push(trimmed)
            existingSet.add(trimmed)
          }
        }
      }
    }

    if (tagsCol !== undefined && nameNewTags.length > 0) {
      const mergedTags = [...existingSet].join(' | ')
      setCellValue(ws, keepRow, tagsCol, mergedTags)
      return {
        keepRow,
        deleteRows: withoutUrl,
        mergedEntry: `${name}: ${nameNewTags.join(' | ')}`,
      }
    }
  }

  return { keepRow, deleteRows: withoutUrl, mergedEntry: undefined }
}

/**
 * 清洗指定工作表的重复行：
 * 1. 按「名称」列分组，识别重复行；
 * 2. 重复组中保留含 Bangumi_URL 的行，无 URL 的行进入待删除；
 * 3. 把被删除行的「标签/分级」合并到保留行（去重，` | ` 连接）；
 * 4. 合并连续行为范围删除，减少 COM 调用。
 */
export function cleanSheetDuplicates(ws: WpsWorksheet): CleanDuplicatesResult {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[cleanSheetDuplicates] ======== 开始清洗重复行 ========')

  const headerRow = findHeaderRow(ws)
  if (!headerRow) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanSheetDuplicates] 未找到表头行，终止')
    return emptyResult('未找到表头行')
  }

  const colMap = getColumnMap(ws, headerRow)
  const nameCol = colMap.get('名称')

  if (!nameCol) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanSheetDuplicates] 未找到"名称"列，终止')
    return emptyResult('未找到"名称"列')
  }
  const urlCol = colMap.get('Bangumi_URL')
  if (!urlCol) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanSheetDuplicates] 未找到"Bangumi_URL"列，终止')
    return emptyResult('未找到"Bangumi_URL"列')
  }
  const tagsCol = colMap.get('标签/分级')

  const lastRow = getLastRow(ws)
  if (lastRow <= headerRow) {
    bgmLog(LOG_LEVELS.WARN, '[cleanSheetDuplicates] 无数据行，终止')
    return emptyResult('无数据行')
  }

  // ========== 1. 只读需要的列（小范围读取，安全不卡死） ==========
  const nameData = readRangeValues(ws, headerRow + 1, lastRow, nameCol, nameCol)
  if (nameData.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[cleanSheetDuplicates] 未读取到名称列数据，终止')
    return emptyResult('未读取到名称列数据')
  }
  const urlData = readRangeValues(ws, headerRow + 1, lastRow, urlCol, urlCol)
  const tagsData = tagsCol ? readRangeValues(ws, headerRow + 1, lastRow, tagsCol, tagsCol) : null

  const totalRows = nameData.length

  // ========== 2. 按名称分组（纯内存操作） ==========
  const nameRows = new Map<string, number[]>()
  for (let index = 0; index < totalRows; index += 1) {
    const row = headerRow + 1 + index
    const name = (nameData[index]?.[0] ?? '').trim()
    if (name) {
      const rows = nameRows.get(name) ?? []
      rows.push(row)
      nameRows.set(name, rows)
    }
  }

  // ========== 3. 处理重复行 ==========
  const toDelete: number[] = []
  let mergedTagsCount = 0
  let duplicateNameCount = 0
  const mergedTagEntries: string[] = []

  for (const [name, rows] of nameRows) {
    const isDuplicateGroup = rows.length > 1
    if (isDuplicateGroup) {
      const outcome = resolveDuplicateGroup(ws, headerRow, urlData, tagsData, tagsCol, name, rows)
      if (outcome) {
        duplicateNameCount += 1
        toDelete.push(...outcome.deleteRows)
        if (outcome.mergedEntry !== undefined) {
          mergedTagsCount += 1
          mergedTagEntries.push(outcome.mergedEntry)
        }
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanSheetDuplicates] 统计: 重复名称=${String(duplicateNameCount)}个, 待删除行=${String(toDelete.length)}, 合并标签组=${String(mergedTagsCount)}`,
  )

  if (toDelete.length === 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[cleanSheetDuplicates] 未发现需清洗的重复数据，耗时: ${String(Date.now() - startTime)}ms`,
    )
    return emptyResult('未发现重复数据')
  }

  // ========== 4. 批量删除行（合并连续行为范围删除） ==========
  toDelete.sort((a, b) => b - a)
  let removalCallCount = 0
  let index = 0
  while (index < toDelete.length) {
    let index_ = index
    while (
      index_ + 1 < toDelete.length &&
      (toDelete[index_] ?? 0) - (toDelete[index_ + 1] ?? 0) === 1
    ) {
      index_ += 1
    }
    if (index === index_) {
      ws.Range(`${String(toDelete[index] ?? '')}:${String(toDelete[index] ?? '')}`).Delete()
    } else {
      ws.Range(`${String(toDelete[index_] ?? '')}:${String(toDelete[index] ?? '')}`).Delete()
    }
    removalCallCount += 1
    index = index_ + 1
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanSheetDuplicates] 删除行: ${String(toDelete.length)}行, 实际COM调用: ${String(removalCallCount)}次`,
  )
  const mergedSummary = mergedTagEntries.length > 0 ? `\n  ${mergedTagEntries.join('\n  ')}` : ''
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanSheetDuplicates] ======== 清洗完成: 删除 ${String(toDelete.length)} 行，合并 ${String(mergedTagsCount)} 个名称组的标签，耗时: ${String(Date.now() - startTime)}ms ========`,
  )
  if (mergedSummary) {
    bgmLog(LOG_LEVELS.INFO, `[cleanSheetDuplicates] 实际合并的标签:\n${mergedSummary}`)
  }

  return {
    performed: true,
    deletedRows: toDelete.length,
    mergedTagGroups: mergedTagsCount,
    duplicateNameGroups: duplicateNameCount,
  }
}

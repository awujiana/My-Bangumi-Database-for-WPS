/**
 * @fileoverview 数据中心读表适配器（工作表二维数组 → 统计记录）
 * @module panel/dataCenterLoader
 * @description `rowsToRecords` 是纯函数，接收表头行 + 数据行 + 可选列名映射，便于单测；
 *              `loadRecordsFromActiveSheet` 才是碰 COM 的薄封装，由页面在 COM 闸门内调用。
 */

import type { StatisticsRecord } from '../services/data-center-stats.js'
import { normalizeWatchStatus } from '../services/data-center-stats.js'

/** 列名映射的默认值（与 FIELD_NAME_MAP 对齐的关键列） */
const DEFAULT_COLUMN_ALIASES: Record<string, readonly string[]> = {
  sid: ['sid', '条目id', 'id', '序列号'],
  name: ['名称', '作品名', 'name', '条目名称'],
  type: ['观看状态', '收藏类型', '状态', 'type', '是否看完'],
  date: ['完播日', '完播日期', '更新日期', 'date', '开播日期'],
  tags: ['标签', 'tags', '标签/分级'],
}

/** 在表头行里定位各字段列号（0 基）。返回 null 表示找不到名称列。 */
function resolveColumns(
  header: readonly string[],
  aliases: Record<string, readonly string[]>,
): { sid: number; name: number; type: number; date: number; tags: number } | null {
  const findIndex = (candidates: readonly string[]): number =>
    header.findIndex((cell) => candidates.includes(cell.trim().toLowerCase()))
  const lowerAliases = Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      values.map((value) => value.toLowerCase()),
    ]),
  )
  const name = findIndex(lowerAliases.name ?? [])
  if (name < 0) return null
  return {
    sid: findIndex(lowerAliases.sid ?? []),
    name,
    type: findIndex(lowerAliases.type ?? []),
    date: findIndex(lowerAliases.date ?? []),
    tags: findIndex(lowerAliases.tags ?? []),
  }
}

/**
 * 把表格行转成统计记录（纯函数）。
 * @param rows 二维数组，第 0 行为表头
 * @param aliases 可选列名映射覆盖
 */
export function rowsToRecords(
  rows: readonly (readonly string[])[],
  aliases: Record<string, readonly string[]> = DEFAULT_COLUMN_ALIASES,
): StatisticsRecord[] {
  if (rows.length < 2) return []
  const header = rows[0]
  if (header === undefined) return []
  const columns = resolveColumns(header, aliases)
  if (columns === null) return []

  const records: StatisticsRecord[] = []
  for (const row of rows.slice(1)) {
    const cell = (column: number): string => (column < 0 ? '' : (row[column] ?? '').trim())
    const name = cell(columns.name)
    if (name !== '') {
      const rawStatus = cell(columns.type)
      records.push({
        sid: cell(columns.sid) || name,
        name,
        watchStatus: normalizeWatchStatus(rawStatus === '' ? 0 : rawStatus),
        date: cell(columns.date),
        tags: cell(columns.tags),
      })
    }
  }
  return records
}

/**
 * 从当前活动工作表读取统计记录（碰 COM 的薄封装）。
 * 用注入的读取函数，便于页面层统一传 readRangeValues / getLastRow，也便于测试替换。
 */
export function loadRecordsWith(
  read: (startRow: number, endRow: number, startColumn: number, endColumn: number) => string[][],
  lastRow: number,
  aliases?: Record<string, readonly string[]>,
): StatisticsRecord[] {
  if (lastRow < 1) return []
  const rows = read(1, lastRow, 1, 50)
  return rowsToRecords(rows, aliases)
}

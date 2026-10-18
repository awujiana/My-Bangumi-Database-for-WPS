/**
 * @fileoverview 从 WPS 当前选区提取行 SID（「仅同步选中行」共用）
 * @module sync/selectedRows
 * @description `github-sync.ts` 与 `sync-source-registry.ts` 此前各有一份
 *              **逐字重复**的实现（连日志文案都一样），收敛为一份，避免后续各自漂移。
 *
 *              依赖只有 `tools/util/index.js` 与 `pure-utilities.js`，是零副作用的叶子模块。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  bgmLog,
  getApp,
  getCellValue,
  findHeaderRow,
  getColumnMap,
  trim,
} from '../tools/util/index.js'
import { extractSubjectId } from './pure-utilities.js'

/**
 * 从 WPS 当前选区提取所有行的 SID 集合（用于「仅同步选中行」）
 *
 * 遍历 Selection 的行范围，读取每行的 Bangumi_URL 列并提取 SID。
 *
 * @returns SID 字符串集合；空集合表示未选中行或未找到 URL
 */
export function getSelectedRowSids(): Set<string> {
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
      // 跳过表头行：提取条件变量使循环体含多条语句，消除 no-continue 与 prefer-continue 冲突
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

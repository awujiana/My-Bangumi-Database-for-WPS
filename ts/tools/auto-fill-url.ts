import {
  getDataSheet,
  getCellValue,
  setCellValue,
  getColumnMap,
  findHeaderRow,
  getLastRow,
  bgmLog,
  LOG_LEVELS,
  BGM,
  trim,
} from '../index.js'
import type { WpsWorksheet } from '../index.js'

export type NameUrlMap = Record<string, string>

export interface AutoFillResult {
  /** 补全的 URL 数量 */
  filled: number
  /** 建立映射的名称数量 */
  mappedNames: number
}

function _splitAliases(aliasValue: string): string[] {
  if (!aliasValue) return []
  return aliasValue
    .split(/[|｜/／]/)
    .map((a) => a.trim())
    .filter(Boolean)
}

function _buildNameUrlMap(
  ws: WpsWorksheet,
  headerRow: number,
  lastRow: number,
  colMap: Map<string, number>,
): NameUrlMap {
  const nameUrlMap: NameUrlMap = {}

  const urlCol = colMap.get('Bangumi_URL')
  const nameCol = colMap.get('名称')
  const aliasCol = colMap.get('别名')
  if (!urlCol || !nameCol) return nameUrlMap

  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    const urlValue = trim(getCellValue(ws, row, urlCol))
    if (urlValue) {
      const nameValue = trim(getCellValue(ws, row, nameCol))
      if (nameValue && !(nameValue in nameUrlMap)) {
        nameUrlMap[nameValue] = urlValue
      }

      if (aliasCol) {
        const aliasValue = trim(getCellValue(ws, row, aliasCol))
        const aliases = _splitAliases(aliasValue)
        for (const a of aliases) {
          if (a && !(a in nameUrlMap)) {
            nameUrlMap[a] = urlValue
          }
        }
      }
    }
  }

  return nameUrlMap
}

export function autoFillUrls(): AutoFillResult {
  const result: AutoFillResult = { filled: 0, mappedNames: 0 }

  try {
    const ws = getDataSheet()
    if (!ws) {
      BGM.Dialog.alert('无法获取工作表', '提示')
      return result
    }

    const headerRow = findHeaderRow(ws)
    if (!headerRow || headerRow < 1) {
      BGM.Dialog.alert('未找到表头行', '提示')
      return result
    }

    const colMap = getColumnMap(ws, headerRow)
    const urlCol = colMap.get('Bangumi_URL')
    const nameCol = colMap.get('名称')
    if (urlCol === undefined || nameCol === undefined) {
      BGM.Dialog.alert('未找到 "Bangumi_URL" 或 "名称" 列', '提示')
      return result
    }

    const lastRow = getLastRow(ws)
    if (lastRow <= headerRow) {
      BGM.Dialog.alert('没有数据行需要补全', '提示')
      return result
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `[autoFillUrls] 表头行: ${String(headerRow)}, 最后数据行: ${String(lastRow)}, URL列: ${String(urlCol)}, 名称列: ${String(nameCol)}`,
    )

    const nameUrlMap = _buildNameUrlMap(ws, headerRow, lastRow, colMap)
    const mappedKeys = Object.keys(nameUrlMap).length
    result.mappedNames = mappedKeys

    if (mappedKeys === 0) {
      BGM.Dialog.alert('没有找到有效的 URL 映射，请先填写一些条目', '提示')
      return result
    }

    bgmLog(LOG_LEVELS.INFO, `[autoFillUrls] 已建立 ${String(mappedKeys)} 个名称/别名 → URL 映射`)

    for (let row = headerRow + 1; row <= lastRow; row += 1) {
      const currentUrl = trim(getCellValue(ws, row, urlCol))
      if (!currentUrl) {
        const nameValue = trim(getCellValue(ws, row, nameCol))
        if (nameValue) {
          const fillUrl = nameUrlMap[nameValue]
          if (fillUrl) {
            setCellValue(ws, row, urlCol, fillUrl)
            result.filled += 1
          }
        }
      }
    }

    bgmLog(LOG_LEVELS.INFO, `[autoFillUrls] 补全完成: ${String(result.filled)} 行`)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'autoFillUrls', showAlert: true })
  }

  return result
}

export function showAutoFillUrlDialog(): void {
  const ws = getDataSheet()
  if (!ws) return

  const headerRow = findHeaderRow(ws)
  if (!headerRow || headerRow < 1) {
    BGM.Dialog.alert('未找到表头行', '提示')
    return
  }

  const colMap = getColumnMap(ws, headerRow)
  const nameCount = colMap.has('名称') ? colMap.get('名称') : '?'
  const urlCount = colMap.has('Bangumi_URL') ? colMap.get('Bangumi_URL') : '未找到'

  if (!colMap.has('Bangumi_URL') || !colMap.has('名称')) {
    BGM.Dialog.alert('未找到 "Bangumi_URL" 或 "名称" 列，无法执行', '提示')
    return
  }

  BGM.Dialog.confirm(
    `名称列: 第 ${String(nameCount ?? '')} 列\nURL列: 第 ${String(urlCount ?? '')} 列\n\n将根据已有 URL 的同名条目补全缺失的 URL（也支持别名匹配）。\n确定要继续吗？`,
    (isConfirmed: boolean) => {
      if (!isConfirmed) return
      const result = autoFillUrls()
      if (result.filled > 0) {
        BGM.Dialog.alert(
          `补全完成！\n已建立 ${String(result.mappedNames)} 个名称/别名映射\n补全了 ${String(result.filled)} 行的缺失 URL`,
          '结果',
        )
      } else {
        BGM.Dialog.alert('没有需要补全的 URL', '提示')
      }
    },
    'URL 自动补全',
  )
}

export { _buildNameUrlMap, _splitAliases }

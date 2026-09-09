/**
 * UI 事件处理模块 - 工作表清洗相关
 * @module ui/handlers/sheet
 * @description 锁定数据表的重复行清洗（按名称合并、保留含 URL 的行、合并标签）。
 *              核心逻辑在 sync/sheet-cleaning.ts（富化完成后自动去重复用同一实现）。
 */

import {
  LOG_LEVELS,
  bgmLog,
  BGM,
  getApp,
  showToast,
} from '../../index.js'
import type { WpsWorksheet } from '../../tools/wps.js'
import { cleanSheetDuplicates } from '../../sync/sheet-cleaning.js'

/**
 * 清洗锁定的数据工作表：
 * 1. 按"名称"列分组，识别重复行
 * 2. 在重复组中保留含 Bangumi_URL 的行，删除无 URL 的行
 * 3. 合并被删除行的"标签/分级"到保留行
 * 4. 批量删除行（合并连续行为范围删除，减少 COM 调用）
 *
 * @param targetWs 可选：直接指定要清洗的工作表（富化页在目标表上自动去重时使用）；
 *                 缺省时按锁定索引从活动工作簿解析。
 */
export function cleanLockedDataSheet(targetWs?: WpsWorksheet): void {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[cleanLockedDataSheet] ======== 开始清洗锁定数据表 ========')

  let ws: WpsWorksheet | null = targetWs ?? null

  if (!ws) {
    const app = getApp()
    if (!app?.ActiveWorkbook) {
      bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 无法获取工作簿，终止')
      showToast('无法获取工作簿', 'error')
      return
    }

    if (!BGM.sheet.isLocked || !BGM.sheet.lockedIndex) {
      bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 未锁定数据表，终止')
      showToast('请先锁定数据表', 'warn')
      return
    }

    const wb = app.ActiveWorkbook
    ws = wb.Sheets.Item(BGM.sheet.lockedIndex)
  }

  const sheetName = ws.Name || '未知'
  const lockedIndex = targetWs ? '' : ` (索引: ${String(BGM.sheet.lockedIndex ?? '')})`
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 清洗工作表: "${sheetName}"${lockedIndex}`,
  )

  const result = cleanSheetDuplicates(ws)

  if (result.skippedReason) {
    showToast(result.skippedReason, result.skippedReason === '未发现重复数据' ? 'info' : 'error')
    return
  }

  showToast(
    `清洗完成：删除 ${String(result.deletedRows)} 行，合并 ${String(result.mergedTagGroups)} 个名称组的标签`,
    'success',
  )
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 完成，耗时: ${String(Date.now() - startTime)}ms`,
  )
}

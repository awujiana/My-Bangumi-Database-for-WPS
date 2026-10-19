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
  buildFailedRowsAddress,
  getLastFailedRows,
} from '../../index.js'
import type { WpsWorksheet } from '../../tools/wps.js'
import { cleanSheetDuplicates } from '../../sync/sheet-cleaning.js'

/**
 * 选中「上次同步失败的行」，供用户接着点「👆 选中行同步」只重发这几行。
 *
 * 只做选中、不直接发请求——用户能在发请求前先看清要重试哪些行；同步路径完全
 * 复用现有的 `app.Selection` 读取逻辑，不新增一条同步实现。
 *
 * 三条拒绝条件（都比「静默选中错行」好）：
 *  1. 没有失败记录；
 *  2. 失败行属于另一张表（行号换表就错位了）；
 *  3. 地址串超长（Excel Range 地址有长度上限）。
 */
export function selectFailedRowsFromLastSync(): void {
  const record = getLastFailedRows()
  if (!record || record.rows.length === 0) {
    showToast('上次同步没有失败行', 'info')
    return
  }

  const app = getApp()
  const ws: WpsWorksheet | null = app?.ActiveWorkbook?.ActiveSheet ?? null
  if (!ws) {
    showToast('无法获取当前工作表', 'error')
    return
  }
  if (record.sheetName && ws.Name !== record.sheetName) {
    showToast(`失败行属于「${record.sheetName}」表，请先切回该表`, 'warn')
    return
  }

  const address = buildFailedRowsAddress(record.rows)
  if (!address) {
    showToast(`失败行过多（${String(record.rows.length)} 行），请分批手动选择重试`, 'warn')
    return
  }

  try {
    ws.Range(address).Select()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    BGM.handleError(error, { context: 'selectFailedRows', showAlert: false })
    showToast(`选中失败行失败：${message}`, 'error')
    return
  }

  const preview = record.rows.slice(0, 8).join(', ')
  const more = record.rows.length > 8 ? '…' : ''
  bgmLog(LOG_LEVELS.INFO, `[selectFailedRows] 已选中 ${String(record.rows.length)} 行: ${address}`)
  showToast(
    `已选中 ${String(record.rows.length)} 个失败行（${preview}${more}），点「👆 选中行同步」重试`,
    'success',
  )
}

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

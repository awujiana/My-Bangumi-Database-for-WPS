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
import { cleanSheetDuplicates, SHEET_CLEANING_SKIP_KEYS } from '../../sync/sheet-cleaning.js'
// tOr 直连 locale-store：i18n/index 桶会经 locale-install 拉进 ts/index（模块顶层写 window），
// node 单测一 import 就 ReferenceError。别改回桶。
import { tOr } from '../../i18n/locale-store.js'

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
    showToast(tOr('handlers.sheet.noFailedRows', '上次同步没有失败行'), 'info')
    return
  }

  const app = getApp()
  const worksheet: WpsWorksheet | null = app?.ActiveWorkbook?.ActiveSheet ?? null
  if (!worksheet) {
    showToast(tOr('handlers.sheet.noWorksheet', '无法获取当前工作表'), 'error')
    return
  }
  if (record.sheetName && worksheet.Name !== record.sheetName) {
    showToast(
      tOr('handlers.sheet.wrongSheet', '失败行属于「{sheet}」表，请先切回该表', {
        sheet: record.sheetName,
      }),
      'warn',
    )
    return
  }

  const address = buildFailedRowsAddress(record.rows)
  if (!address) {
    showToast(
      tOr('handlers.sheet.tooManyRows', '失败行过多（{count} 行），请分批手动选择重试', {
        count: String(record.rows.length),
      }),
      'warn',
    )
    return
  }

  try {
    worksheet.Range(address).Select()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    BGM.handleError(error, { context: 'selectFailedRows', showAlert: false })
    showToast(tOr('handlers.sheet.selectFailed', '选中失败行失败：{message}', { message }), 'error')
    return
  }

  const preview = record.rows.slice(0, 8).join(', ')
  const more = record.rows.length > 8 ? '…' : ''
  bgmLog(LOG_LEVELS.INFO, `[selectFailedRows] 已选中 ${String(record.rows.length)} 行: ${address}`)
  showToast(
    tOr(
      'handlers.sheet.selected',
      '已选中 {count} 个失败行（{preview}），点「👆 选中行同步」重试',
      { count: String(record.rows.length), preview: `${preview}${more}` },
    ),
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
 * @param targetWorksheet 可选：直接指定要清洗的工作表（富化页在目标表上自动去重时使用）；
 *                 缺省时按锁定索引从活动工作簿解析。
 */
export function cleanLockedDataSheet(targetWorksheet?: WpsWorksheet): void {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[cleanLockedDataSheet] ======== 开始清洗锁定数据表 ========')

  let worksheet: WpsWorksheet | null = targetWorksheet ?? null

  if (!worksheet) {
    const app = getApp()
    if (!app?.ActiveWorkbook) {
      bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 无法获取工作簿，终止')
      showToast(tOr('handlers.sheet.noWorkbook', '无法获取工作簿'), 'error')
      return
    }

    if (!BGM.sheet.isLocked || !BGM.sheet.lockedIndex) {
      bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 未锁定数据表，终止')
      showToast(tOr('handlers.sheet.lockFirst', '请先锁定数据表'), 'warn')
      return
    }

    const wb = app.ActiveWorkbook
    worksheet = wb.Sheets.Item(BGM.sheet.lockedIndex)
  }

  const sheetName = worksheet.Name || tOr('handlers.sheet.unknownSheet', '未知')
  const lockedIndex = targetWorksheet ? '' : ` (索引: ${String(BGM.sheet.lockedIndex ?? '')})`
  bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 清洗工作表: "${sheetName}"${lockedIndex}`)

  const result = cleanSheetDuplicates(worksheet)

  if (result.skippedReason) {
    // 分级判据改用 key：原先拿中文原文比字符串，译文一进来就永远落 error 分支
    const message = result.skippedReasonKey
      ? tOr(result.skippedReasonKey, result.skippedReason)
      : result.skippedReason
    const level =
      result.skippedReasonKey === SHEET_CLEANING_SKIP_KEYS.noDuplicates ? 'info' : 'error'
    showToast(message, level)
    return
  }

  showToast(
    tOr('handlers.sheet.cleaned', '清洗完成：删除 {deleted} 行，合并 {merged} 个名称组的标签', {
      deleted: String(result.deletedRows),
      merged: String(result.mergedTagGroups),
    }),
    'success',
  )
  bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 完成，耗时: ${String(Date.now() - startTime)}ms`)
}

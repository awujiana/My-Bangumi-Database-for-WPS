/**
 * @fileoverview 富化结果视图：富化完成后的自动合并去重，以及「富化详细结果」弹窗的显示/隐藏。
 * @module panel/enrich-result-view
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { cleanSheetDuplicates } from '../index.js'
import { showToast } from '../ui/dialog.js'
import { bgmLog, BGM } from '../tools/util/index.js'
import { getEnrichPreviewConfig } from './enrich-page-state.js'
import { renderEnrichDetailHtml } from './enrich-detail-render.js'
import { state, safeGetElement } from './enrich-page-context.js'

// ========== 富化后自动合并去重 ==========

/**
 * 富化完成后按设置自动执行「合并去重」清洗（设置页「富化预览」可关闭）。
 * 只清洗目标 Bangumi 表：按名称分组保留含 URL 的行、合并标签、删除重复行。
 * 失败仅记录日志与提示，不中断主流程。
 */
export function maybeAutoCleanAfterEnrich(): void {
  if (!getEnrichPreviewConfig().autoCleanDuplicates) return
  const target = state.bangumiSheet
  if (!target) return
  try {
    const result = cleanSheetDuplicates(target)
    if (result.performed) {
      showToast(
        `富化后自动去重完成：删除 ${String(result.deletedRows)} 行重复数据，合并 ${String(result.mergedTagGroups)} 组标签`,
        'success',
      )
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.WARN,
      context: 'maybeAutoCleanAfterEnrich',
    })
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrich] 富化后自动去重失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

// ========== 富化详细结果 ==========

export function showEnrichDetailButton(): void {
  const actionElement = safeGetElement('enrichDetailAction')
  if (actionElement) {
    actionElement.style.display = ''
  }
}

export function showEnrichDetail(): void {
  const modalElement = safeGetElement('enrichDetailModal')
  const bodyElement = safeGetElement('enrichDetailBody')
  if (!modalElement || !bodyElement) return

  bodyElement.innerHTML = renderEnrichDetailHtml(state.enrichDetailGroups)
  modalElement.style.display = 'flex'
}

export function hideEnrichDetail(): void {
  const modalElement = safeGetElement('enrichDetailModal')
  if (modalElement) {
    modalElement.style.display = 'none'
  }
}

/**
 * @fileoverview 冲突对话框：收集富化产生的字段冲突，逐个展示并回写用户选择的解决策略。
 * @module panel/enrich-conflict-dialog
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { resolveConflictField } from '../sync/enrich-engine.js'
import type {
  ConflictInfo,
  EnrichedField,
  EnrichResultItem,
} from '../sync/enrich-types.js'
import { bgmLog, BGM } from '../tools/util/index.js'
import { state, safeGetElement } from './enrich-page-context.js'
import { createInlineProgress, progressHosts } from './enrich-progress-hosts.js'

// ========== 冲突对话框 ==========

export function collectAllConflicts(results: EnrichResultItem[]): ConflictInfo[] {
  const all: ConflictInfo[] = []
  for (const r of results) {
    if (r.conflicts && r.conflicts.length > 0) {
      all.push(...r.conflicts)
    }
  }
  return all
}

/** 静态对话框按钮只需绑定一次（不再随每次展示重建 DOM） */
export function bindConflictDialogButtons(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (!dialogElement) return
  dialogElement.querySelectorAll('[data-resolution]').forEach((button) => {
    button.addEventListener('click', () => {
      const resolution = (button as HTMLElement).dataset.resolution as ConflictInfo['resolution']
      handleConflictResolution(resolution)
    })
  })
}

export function showConflictDialog(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (!dialogElement) return

  const conflict = state.pendingConflicts[state.currentConflictIndex]
  if (!conflict) {
    hideConflictDialog()
    return
  }

  const total = state.pendingConflicts.length
  const current = state.currentConflictIndex + 1

  // 静态模板只更新文本值，避免运行时拼接 HTML
  const titleElement = safeGetElement('conflictTitle')
  if (titleElement)
    titleElement.textContent = `⚡️ 字段冲突确认 (${String(current)}/${String(total)})`

  // 冲突进度：本函数每个冲突都会调用一次，故实例首次创建后复用
  progressHosts.conflict ??= createInlineProgress('conflictProgressHost', '冲突进度', '⚡️')
  progressHosts.conflict?.update(current, total)

  const nameElement = safeGetElement('conflictName')
  if (nameElement) nameElement.textContent = conflict.matchedAnimeName

  const fieldElement = safeGetElement('conflictField')
  if (fieldElement) fieldElement.textContent = conflict.fieldName

  const oldElement = safeGetElement('conflictOld')
  if (oldElement) oldElement.textContent = conflict.oldValue

  const updatedElement = safeGetElement('conflictNew')
  if (updatedElement) updatedElement.textContent = conflict.updatedValue

  dialogElement.style.display = 'block'
}

function hideConflictDialog(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (dialogElement) {
    dialogElement.style.display = 'none'
  }
  progressHosts.conflict?.hide()
  progressHosts.conflict = null
}

function handleConflictResolution(resolution: ConflictInfo['resolution']): void {
  const conflict = state.pendingConflicts[state.currentConflictIndex]
  if (!conflict) return

  conflict.resolution = resolution

  try {
    const enriched: EnrichedField[] = []
    if (state.bangumiSheet) {
      resolveConflictField(state.bangumiSheet, conflict, enriched)
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `[conflict] 字段 "${conflict.fieldName}" (${conflict.matchedAnimeName}): ${resolution}`,
    )
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[conflict] 解析冲突失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  state.currentConflictIndex += 1

  if (state.currentConflictIndex < state.pendingConflicts.length) {
    showConflictDialog()
  } else {
    hideConflictDialog()
    bgmLog(LOG_LEVELS.INFO, '[conflict] 所有冲突已解决')
    BGM.Dialog.alert('冲突解决完成', `共处理 ${String(state.currentConflictIndex)} 个字段冲突`)
  }
}

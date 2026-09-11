/**
 * @fileoverview 富化页源工作簿的打开/回收生命周期
 * @module panel/enrich-source-workbook
 * @description
 *   新番表源工作簿的开关被「表头自动识别 / 工作簿变化监听 / 多新番表切换 /
 *   匹配预览 / 富化执行」多处共用，且必须**只回收本插件自己打开的那一个**
 *   （用户已打开的工作簿不能关）。抽成叶子模块，让各流程块单向依赖。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { getOpenWorkbooks } from '../tools/locked-sheet.js'
import { bgmLog, getApp } from '../tools/util/index.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'
import { extractFileName } from './enrich-file-name.js'
import { state } from './enrich-page-context.js'
import { resetMatchResults } from './enrich-preview-tab.js'

/** 打开新番表文件；已在 WPS 中打开时直接复用，返回是否由本函数打开 */
export function openSourceWorkbook(
  filePath: string,
): { wb: WpsWorkbook; isOpenedByUs: boolean } | null {
  const app = getApp()
  if (!app?.Workbooks) return null

  const fileName = extractFileName(filePath)

  // 已打开则复用：统一检查 Workbooks、Windows 和 ActiveWorkbook 可见的工作簿。
  for (const existing of getOpenWorkbooks()) {
    if (existing.FullName === filePath || existing.Name === fileName) {
      bgmLog(LOG_LEVELS.INFO, `[enrich] 复用已打开的工作簿: ${existing.Name}`)
      return { wb: existing, isOpenedByUs: false }
    }
  }

  // WPS Workbooks.Open 是运行时扩展，不在类型定义中
  const workbooks = app.Workbooks as unknown as { Open?: (path: string) => WpsWorkbook | null }
  if (typeof workbooks.Open !== 'function') return null

  const wb = workbooks.Open(filePath)
  if (!wb) return null

  bgmLog(LOG_LEVELS.INFO, `[enrich] 已打开新番表文件: ${fileName}`)
  return { wb, isOpenedByUs: true }
}

/** 关闭工作簿且不保存修改 */
export function closeWorkbook(wb: WpsWorkbook): void {
  try {
    const wbWithClose = wb as unknown as { Close?: (shouldSaveChanges?: boolean) => unknown }
    if (typeof wbWithClose.Close === 'function') {
      wbWithClose.Close(false)
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrich] 关闭工作簿警告: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** 回收单文件自动识别时接管的源工作簿（仅关闭本插件打开的，用户已打开的保持不动） */
export function closeOpenedSourceWorkbook(): void {
  const wb = state.sourceWorkbook
  if (!wb) return

  if (state.isSourceWorkbookOpenedByUs) {
    closeWorkbook(wb)
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已关闭自动打开的源工作簿: ${wb.Name}`)
    // 工作簿已关闭：清空源表相关状态，避免「开始富化」引用失效的工作表
    state.animeSourceSheet = null
    state.columnMapping = null
    state.headerRow = 0
    state.dataStartRow = 0
    state.hasSourcePreview = false
    resetMatchResults()
  }

  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
  state.introContext = null
}

/** 仅关闭源工作簿并断开引用，保留已识别的表头行/列映射（closeSourceAfterDetect 模式用） */
export function closeSourceWorkbookOnly(): void {
  const wb = state.sourceWorkbook
  if (!wb) return

  if (state.isSourceWorkbookOpenedByUs) {
    closeWorkbook(wb)
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已关闭源工作簿: ${wb.Name}`)
  }

  // 仅断开引用；保留 headerRow / dataStartRow / columnMapping / matches，供重开时复用
  state.animeSourceSheet = null
  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
}

/**
 * 确保开始富化/预览时的源表可用。
 * closeSourceAfterDetect 模式下识别后工作簿已关闭，此处按需重开并恢复源表引用。
 * @returns 可用的源工作表；不可用返回 null
 */
export function ensureSourceSheet(): WpsWorksheet | null {
  if (state.animeSourceSheet) return state.animeSourceSheet

  // 未持有活动源表引用：若已识别过（有 filePath + 表头），则重开文件恢复
  if (!state.filePath || state.headerRow === 0 || !state.columnMapping) return null

  const opened = openSourceWorkbook(state.filePath)
  if (!opened) {
    bgmLog(LOG_LEVELS.ERROR, `[enrich] 重开源工作簿失败: ${extractFileName(state.filePath)}`)
    return null
  }

  const ws = opened.wb.Worksheets.Item(1) as WpsWorksheet | null
  if (!ws) {
    if (opened.isOpenedByUs) closeWorkbook(opened.wb)
    bgmLog(
      LOG_LEVELS.ERROR,
      `[enrich] 重开源工作簿失败: ${extractFileName(state.filePath)} 中没有工作表`,
    )
    return null
  }

  state.animeSourceSheet = ws
  state.sourceWorkbook = opened.wb
  state.isSourceWorkbookOpenedByUs = opened.isOpenedByUs
  bgmLog(LOG_LEVELS.INFO, `[enrich] 已重开源工作簿: ${opened.wb.Name}`)
  return ws
}

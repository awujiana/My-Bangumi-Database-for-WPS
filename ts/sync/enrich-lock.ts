/**
 * 富化功能 - 目标工作表锁定 UI 适配层
 * @module sync/enrichLock
 * @description 富化页面的目标工作表选择与锁定 UI 控制器。
 *              与主面板共用 BGM.sheet 锁定状态，持久化键 `bgm_locked_sheet`，
 *              底层读写/扫描逻辑统一委托给 tools/locked-sheet.js（方案一）。
 */

import type { WpsWorksheet } from '../index.js'
import { getApp, bgmLog, BGM, LOG_LEVELS, showToast } from '../index.js'
import type { LockedSheetInfo } from '../tools/locked-sheet.js'
import {
  saveLockedSheet,
  clearLockedSheet,
  restoreLockedSheet,
  findWorkbookByName,
  findBangumiTargetSheets,
  getOpenWorkbooks,
} from '../tools/locked-sheet.js'

/** 富化页面的锁定工作表引用解析（委托共享实现，保持向后兼容） */
export { findBangumiTargetSheets, findWorkbookByName } from '../tools/locked-sheet.js'
export { getLockedSheet as getLockedEnrichSheet } from '../tools/locked-sheet.js'

// ========== 刷新工作簿列表 ==========

/**
 * 刷新所有打开的 Excel 工作簿列表到 UI 下拉框
 * @param selectId - 工作簿选择下拉框的 DOM ID
 */
export function refreshEnrichWorkbooks(selectId = 'enrichWorkbookSelect'): void {
  const select = document.getElementById(selectId) as HTMLSelectElement | null
  if (!select) return

  const app = getApp()
  if (!app?.Workbooks) {
    bgmLog(LOG_LEVELS.WARN, 'refreshEnrichWorkbooks: 无法获取 Workbooks')
    return
  }

  const workbooks = getOpenWorkbooks()
  const currentValue = select.value

  select.textContent = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = '-- 请选择 Bangumi 追踪表工作簿 --'
  select.appendChild(defaultOption)

  const activeWbName = app.ActiveWorkbook?.Name ?? ''
  let hasSelection = false

  for (const wb of workbooks) {
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    if (name) {
      const option = document.createElement('option')
      option.value = name
      option.text = name

      if (
        name === BGM.sheet.lockedWorkbookName ||
        (currentValue !== '' && currentValue === name) ||
        (currentValue === '' && name === activeWbName && !BGM.sheet.isLocked)
      ) {
        option.selected = true
        hasSelection = true
      }

      select.appendChild(option)
    }
  }

  if (!hasSelection) {
    select.value = ''
  }

  bgmLog(LOG_LEVELS.INFO, `[enrichLock] 刷新工作簿列表: ${String(workbooks.length)} 个`)
}

// ========== 刷新工作表列表 ==========

/**
 * 刷新指定工作簿的工作表列表到 UI 下拉框
 * @param workbookName - 目标工作簿名称，为空则使用下拉框当前值
 * @param selectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 */
export function refreshEnrichSheets(
  workbookName?: string,
  selectId = 'enrichSheetSelect',
  wbSelectId = 'enrichWorkbookSelect',
): void {
  const select = document.getElementById(selectId) as HTMLSelectElement | null
  if (!select) return

  const app = getApp()
  if (!app?.Workbooks) {
    bgmLog(LOG_LEVELS.WARN, 'refreshEnrichSheets: 无法获取 Workbooks')
    return
  }

  const wbName =
    workbookName ?? (document.getElementById(wbSelectId) as HTMLSelectElement | null)?.value ?? ''

  if (!wbName) {
    select.textContent = ''
    const defaultOpt = document.createElement('option')
    defaultOpt.value = ''
    defaultOpt.textContent = '-- 请先选择工作簿 --'
    select.appendChild(defaultOpt)
    return
  }

  const workbook = findWorkbookByName(wbName)
  if (!workbook) {
    bgmLog(LOG_LEVELS.WARN, `refreshEnrichSheets: 工作簿 "${wbName}" 不存在`)
    return
  }

  const sheets = workbook.Worksheets
  const currentLockedSheet = BGM.sheet.isLocked ? BGM.sheet.lockedName : null

  select.textContent = ''
  const defaultOpt = document.createElement('option')
  defaultOpt.value = ''
  defaultOpt.textContent = '-- 请选择工作表 --'
  select.appendChild(defaultOpt)

  for (let index = 1; index <= sheets.Count; index += 1) {
    const option = document.createElement('option')
    const sheet = sheets.Item(index)
    option.value = String(index)
    option.text = sheet.Name

    if (currentLockedSheet === sheet.Name && BGM.sheet.isLocked) {
      option.selected = true
    }

    select.appendChild(option)
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichLock] 刷新工作表列表: ${wbName} 共 ${String(sheets.Count)} 个工作表`,
  )
}

// ========== 切换锁定状态 ==========

/**
 * 锁定/解锁富化目标 Bangumi 追踪表工作表（写入共享 BGM.sheet 锁定状态）
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function toggleEnrichWorkbookLock(
  sheetSelectId = 'enrichSheetSelect',
  wbSelectId = 'enrichWorkbookSelect',
  lockButtonId = 'enrichLockBtn',
  statusId = 'enrichLockStatus',
): void {
  const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
  if (!sheetSelect) return

  const sheetIndex = Number(sheetSelect.value)
  if (Number.isNaN(sheetIndex) || sheetIndex <= 0) {
    showToast('请先选择一个有效的 Bangumi 追踪表工作表', 'warn')
    return
  }

  const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
  const wbName = wbSelect?.value ?? ''
  if (!wbName) {
    showToast('请先选择一个有效的工作簿', 'warn')
    return
  }

  if (
    BGM.sheet.isLocked &&
    BGM.sheet.lockedIndex === sheetIndex &&
    BGM.sheet.lockedWorkbookName === wbName
  ) {
    clearLockedSheet()
    showToast('已解锁目标工作表', 'info')
  } else {
    const sheetName = sheetSelect.options[sheetSelect.selectedIndex]?.text ?? ''
    BGM.sheet.lockedWorkbookName = wbName
    BGM.sheet.lockedName = sheetName
    BGM.sheet.lockedIndex = sheetIndex
    BGM.sheet.isLocked = true
    const info: LockedSheetInfo = { index: sheetIndex, name: sheetName, workbookName: wbName }
    saveLockedSheet(info)
    showToast(`已锁定: ${wbName} → ${sheetName}`, 'info')
  }

  updateEnrichLockButton(lockButtonId, statusId)
}

// ========== 更新锁定按钮 UI ==========

/**
 * 更新锁定按钮的文字和状态显示
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function updateEnrichLockButton(
  lockButtonId = 'enrichLockBtn',
  statusId = 'enrichLockStatus',
): void {
  const button = document.getElementById(lockButtonId) as HTMLButtonElement | null
  const status = document.getElementById(statusId)

  if (button) {
    if (BGM.sheet.isLocked) {
      button.textContent = '🔓 解锁'
      button.classList.add('locked')
    } else {
      button.textContent = '🔒 锁定'
      button.classList.remove('locked')
    }
  }

  if (status) {
    if (BGM.sheet.isLocked) {
      status.classList.add('show')
      status.textContent = `已锁定: ${BGM.sheet.lockedWorkbookName ?? ''} → ${BGM.sheet.lockedName ?? ''}`
    } else {
      status.classList.remove('show')
      status.textContent = ''
    }
  }
}

// ========== 按工作簿+索引锁定 ==========

/**
 * 按工作簿名称 + 工作表索引执行锁定（不依赖 UI 下拉框）
 * @param workbookName - 目标工作簿名称
 * @param sheetIndex - 目标工作表索引（1-based）
 * @returns 是否锁定成功
 */
export function lockEnrichWorkbookByName(workbookName: string, sheetIndex: number): boolean {
  const wb = findWorkbookByName(workbookName)
  if (!wb) {
    bgmLog(LOG_LEVELS.WARN, `lockEnrichWorkbookByName: 工作簿 "${workbookName}" 不存在`)
    return false
  }

  let ws: WpsWorksheet
  try {
    ws = wb.Worksheets.Item(sheetIndex)
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `lockEnrichWorkbookByName: 读取工作表 ${String(sheetIndex)} 失败: ${String(error)}`,
    )
    return false
  }

  const sheetName = ws.Name
  BGM.sheet.lockedWorkbookName = workbookName
  BGM.sheet.lockedName = sheetName
  BGM.sheet.lockedIndex = sheetIndex
  BGM.sheet.isLocked = true
  saveLockedSheet({ index: sheetIndex, name: sheetName, workbookName })
  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichLock] 自动锁定: ${workbookName} → ${sheetName} (索引 ${String(sheetIndex)})`,
  )
  return true
}

// ========== 初始化 ==========

/**
 * 初始化富化锁定模块（启动时调用）
 *
 * 流程：先尝试恢复共享持久化锁定；未恢复时自动扫描候选 Bangumi 追踪表，
 * 唯一候选直接自动锁定，多候选则预选首个并提示用户确认。
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function initEnrichLock(
  wbSelectId = 'enrichWorkbookSelect',
  sheetSelectId = 'enrichSheetSelect',
  lockButtonId = 'enrichLockBtn',
  statusId = 'enrichLockStatus',
): void {
  refreshEnrichWorkbooks(wbSelectId)

  const isRestored = restoreLockedSheet()
  if (isRestored && BGM.sheet.isLocked) {
    const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
    if (wbSelect && BGM.sheet.lockedWorkbookName) {
      wbSelect.value = BGM.sheet.lockedWorkbookName
    }
    refreshEnrichSheets(BGM.sheet.lockedWorkbookName ?? undefined, sheetSelectId, wbSelectId)
    const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
    if (sheetSelect && BGM.sheet.lockedIndex) {
      sheetSelect.value = String(BGM.sheet.lockedIndex)
    }
    bgmLog(LOG_LEVELS.INFO, '[enrichLock] 锁定状态已恢复')
  } else {
    const autoResult = autoSelectEnrichTarget(wbSelectId, sheetSelectId, lockButtonId, statusId)
    if (autoResult === 'none') {
      refreshEnrichSheets(undefined, sheetSelectId, wbSelectId)
    }
  }

  updateEnrichLockButton(lockButtonId, statusId)
}

// ========== 自动选择目标工作表 ==========

/**
 * 自动选择目标工作表：唯一候选直接锁定，多候选预选首个并提示确认。
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 * @returns 'locked' 已自动锁定 | 'preselected' 已预选待确认 | 'none' 未找到候选
 */
export function autoSelectEnrichTarget(
  wbSelectId = 'enrichWorkbookSelect',
  sheetSelectId = 'enrichSheetSelect',
  lockButtonId = 'enrichLockBtn',
  statusId = 'enrichLockStatus',
): 'locked' | 'preselected' | 'none' {
  if (BGM.sheet.isLocked) return 'locked'

  const candidates = findBangumiTargetSheets()
  if (candidates.length === 0) {
    bgmLog(LOG_LEVELS.INFO, '[enrichLock] 未找到可自动选择的追踪表候选')
    return 'none'
  }

  const best = candidates[0]
  if (!best) return 'none'

  const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
  if (wbSelect) wbSelect.value = best.workbookName
  refreshEnrichSheets(best.workbookName, sheetSelectId, wbSelectId)
  const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
  if (sheetSelect) sheetSelect.value = String(best.sheetIndex)

  if (candidates.length === 1) {
    const isLocked = lockEnrichWorkbookByName(best.workbookName, best.sheetIndex)
    if (isLocked) {
      showToast(`已自动锁定: ${best.workbookName} → ${best.sheetName}`, 'success')
      updateEnrichLockButton(lockButtonId, statusId)
      return 'locked'
    }
    return 'preselected'
  }

  showToast(
    `检测到 ${String(candidates.length)} 个候选追踪表，已预选 ${best.sheetName}，请确认后锁定`,
    'warn',
  )
  return 'preselected'
}

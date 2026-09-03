/**
 * 富化功能 - 工作簿锁定模块
 * @module sync/enrichLock
 * @description 管理富化功能的 Bangumi 追踪表工作簿选择与锁定。
 *              与 Panel 的 BGM.sheet 锁定独立，使用 BGM.enrich 命名空间，
 *              通过 PluginStorage 键 `bgm_enrich_locked_workbook` 持久化。
 */

import type { WpsWorkbook, WpsWorksheet } from '../index.js'
import { getApp, bgmLog, BGM, LOG_LEVELS, CONFIG_KEYS, showToast } from '../index.js'

// ========== 类型定义 ==========

interface LockedWorkbookInfo {
  workbookName: string
  sheetName: string
  sheetIndex: number
}

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

  const wbs = app.Workbooks
  const currentValue = select.value

  select.textContent = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = '-- 请选择 Bangumi 追踪表工作簿 --'
  select.appendChild(defaultOption)

  const activeWbName = app.ActiveWorkbook?.Name ?? ''
  let hasSelection = false

  for (let index = 1; index <= wbs.Count; index += 1) {
    const option = document.createElement('option')
    const wb = wbs.Item(index)
    option.value = wb.Name
    option.text = wb.Name

    if (BGM.enrich.isLocked && BGM.enrich.lockedWorkbookName === wb.Name) {
      option.selected = true
      hasSelection = true
    } else if (currentValue && currentValue === wb.Name) {
      option.selected = true
      hasSelection = true
    } else if (!currentValue && !BGM.enrich.isLocked && wb.Name === activeWbName) {
      option.selected = true
      hasSelection = true
    }

    select.appendChild(option)
  }

  if (!hasSelection) {
    select.value = ''
  }

  bgmLog(LOG_LEVELS.INFO, `[enrichLock] 刷新工作簿列表: ${String(wbs.Count)} 个`)
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

  let workbook: WpsWorkbook | null = null
  for (let index = 1; index <= app.Workbooks.Count; index += 1) {
    const wb = app.Workbooks.Item(index)
    if (wb.Name === wbName) {
      workbook = wb
      break
    }
  }

  if (!workbook) {
    bgmLog(LOG_LEVELS.WARN, `refreshEnrichSheets: 工作簿 "${wbName}" 不存在`)
    return
  }

  const sheets = workbook.Worksheets
  const currentLockedSheet = BGM.enrich.isLocked ? BGM.enrich.lockedSheetName : null

  select.textContent = ''
  const defaultOpt = document.createElement('option')
  defaultOpt.value = ''
  defaultOpt.textContent = '-- 请选择工作表 --'
  select.appendChild(defaultOpt)

  let isLockedFound = false
  for (let index = 1; index <= sheets.Count; index += 1) {
    const option = document.createElement('option')
    const sheet = sheets.Item(index)
    option.value = String(index)
    option.text = sheet.Name

    if (currentLockedSheet === sheet.Name && BGM.enrich.isLocked) {
      option.selected = true
      isLockedFound = true
    }

    select.appendChild(option)
  }

  if (isLockedFound) {
    BGM.enrich.lockedSheetIndex = parseInt(select.value, 10) || null
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichLock] 刷新工作表列表: ${wbName} 共 ${String(sheets.Count)} 个工作表`,
  )
}

// ========== 切换锁定状态 ==========

/**
 * 锁定/解锁富化目标 Bangumi 追踪表工作表
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

  const sheetIndex = parseInt(sheetSelect.value, 10)
  if (isNaN(sheetIndex) || sheetIndex <= 0) {
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
    BGM.enrich.isLocked &&
    BGM.enrich.lockedSheetIndex === sheetIndex &&
    BGM.enrich.lockedWorkbookName === wbName
  ) {
    // 解锁
    BGM.enrich.lockedWorkbookName = null
    BGM.enrich.lockedSheetName = null
    BGM.enrich.lockedSheetIndex = null
    BGM.enrich.isLocked = false
    saveEnrichLockedWorkbook(null)
    showToast('已解锁目标工作表', 'info')
  } else {
    // 锁定
    const sheetName = sheetSelect.options[sheetSelect.selectedIndex]?.text ?? ''
    BGM.enrich.lockedWorkbookName = wbName
    BGM.enrich.lockedSheetName = sheetName
    BGM.enrich.lockedSheetIndex = sheetIndex
    BGM.enrich.isLocked = true

    const info: LockedWorkbookInfo = {
      workbookName: wbName,
      sheetName,
      sheetIndex,
    }
    saveEnrichLockedWorkbook(info)
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
    if (BGM.enrich.isLocked) {
      button.textContent = '🔓 解锁'
      button.classList.add('locked')
    } else {
      button.textContent = '🔒 锁定'
      button.classList.remove('locked')
    }
  }

  if (status) {
    if (BGM.enrich.isLocked) {
      status.style.display = 'inline'
      status.textContent = `已锁定: ${BGM.enrich.lockedWorkbookName ?? ''} → ${BGM.enrich.lockedSheetName ?? ''}`
    } else {
      status.style.display = 'none'
    }
  }
}

// ========== 持久化锁定状态 ==========

/**
 * 保存锁定信息到 PluginStorage
 * @param info - 锁定信息（null 表示清除）
 */
export function saveEnrichLockedWorkbook(info: LockedWorkbookInfo | null): void {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, 'saveEnrichLockedWorkbook: PluginStorage 不可用')
    return
  }

  if (info) {
    app.PluginStorage.setItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK, JSON.stringify(info))
    bgmLog(LOG_LEVELS.INFO, `[enrichLock] 保存锁定: ${info.workbookName} → ${info.sheetName}`)
  } else {
    app.PluginStorage.setItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK, '')
    bgmLog(LOG_LEVELS.INFO, '[enrichLock] 清除锁定持久化数据')
  }
}

// ========== 启动时恢复与校验 ==========

/**
 * 从 PluginStorage 恢复锁定状态，并校验工作簿/工作表是否仍存在
 * @returns 是否成功恢复
 */
export function restoreEnrichLockedWorkbook(): boolean {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, 'restoreEnrichLockedWorkbook: PluginStorage 不可用')
    return false
  }

  const raw = app.PluginStorage.getItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK)
  if (!raw) return false

  try {
    const info = JSON.parse(raw) as LockedWorkbookInfo

    // 校验工作簿是否仍存在
    if (!app.Workbooks) {
      bgmLog(LOG_LEVELS.WARN, 'restoreEnrichLockedWorkbook: Workbooks 不可用')
      clearEnrichLock()
      return false
    }

    const wb = findWorkbookByName(info.workbookName)
    if (!wb) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[restoreEnrichLockedWorkbook] 锁定的工作簿 "${info.workbookName}" 已不存在`,
      )
      clearEnrichLock()
      return false
    }

    // 校验工作表是否仍存在于工作簿中
    let isSheetFound = false
    for (let index = 1; index <= wb.Worksheets.Count; index += 1) {
      const ws = wb.Worksheets.Item(index)
      if (ws.Name === info.sheetName) {
        isSheetFound = true
        break
      }
    }
    if (!isSheetFound) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[restoreEnrichLockedWorkbook] 锁定的工作表 "${info.sheetName}" 在工作簿 "${info.workbookName}" 中已不存在`,
      )
      clearEnrichLock()
      return false
    }

    // 恢复锁定状态
    BGM.enrich.lockedWorkbookName = info.workbookName
    BGM.enrich.lockedSheetName = info.sheetName
    BGM.enrich.lockedSheetIndex = info.sheetIndex
    BGM.enrich.isLocked = true

    bgmLog(
      LOG_LEVELS.INFO,
      `[restoreEnrichLockedWorkbook] 成功恢复锁定: ${info.workbookName} → ${info.sheetName}`,
    )
    return true
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `restoreEnrichLockedWorkbook: 解析锁定数据失败: ${String(error)}`)
    clearEnrichLock()
    return false
  }
}

// ========== 获取锁定的工作表引用 ==========

/**
 * 获取当前锁定的 Bangumi 追踪表工作簿和工作表引用
 * @returns [WpsWorkbook, WpsWorksheet] 元组，未锁定或引用失效返回 null
 */
export function getLockedEnrichSheet(): [WpsWorkbook, WpsWorksheet] | null {
  if (!BGM.enrich.isLocked) return null

  const app = getApp()
  if (!app?.Workbooks) return null

  const wb = findWorkbookByName(BGM.enrich.lockedWorkbookName)
  if (!wb) {
    bgmLog(
      LOG_LEVELS.WARN,
      `getLockedEnrichSheet: 锁定的工作簿 "${BGM.enrich.lockedWorkbookName ?? ''}" 已不存在`,
    )
    clearEnrichLock()
    return null
  }

  let ws: WpsWorksheet | null = null
  for (let index = 1; index <= wb.Worksheets.Count; index += 1) {
    const sheet = wb.Worksheets.Item(index)
    if (sheet.Name === BGM.enrich.lockedSheetName) {
      ws = sheet
      break
    }
  }

  if (!ws) {
    bgmLog(
      LOG_LEVELS.WARN,
      `getLockedEnrichSheet: 锁定的工作表 "${BGM.enrich.lockedSheetName ?? ''}" 已不存在`,
    )
    clearEnrichLock()
    return null
  }

  return [wb, ws]
}

// ========== 辅助函数 ==========

/**
 * 根据工作簿名称查找 WpsWorkbook 对象
 * @param name - 工作簿名称
 * @returns WpsWorkbook 对象或 null
 */
export function findWorkbookByName(name: string | null): WpsWorkbook | null {
  if (!name) return null
  const app = getApp()
  if (!app?.Workbooks) return null

  for (let index = 1; index <= app.Workbooks.Count; index += 1) {
    const wb = app.Workbooks.Item(index)
    if (wb.Name === name) return wb
  }
  return null
}

/**
 * 在指定工作簿中查找工作表
 * @param wbName - 工作簿名称
 * @param sheetName - 工作表名称
 * @returns WpsWorksheet 对象或 null
 */
export function findSheetInWorkbook(wbName: string, sheetName: string): WpsWorksheet | null {
  const wb = findWorkbookByName(wbName)
  if (!wb) return null

  for (let index = 1; index <= wb.Worksheets.Count; index += 1) {
    const ws = wb.Worksheets.Item(index)
    if (ws.Name === sheetName) return ws
  }
  return null
}

/**
 * 清除富化锁定状态（内存 + 持久化）
 */
function clearEnrichLock(): void {
  BGM.enrich.lockedWorkbookName = null
  BGM.enrich.lockedSheetName = null
  BGM.enrich.lockedSheetIndex = null
  BGM.enrich.isLocked = false
  saveEnrichLockedWorkbook(null)
}

/**
 * 初始化富化锁定模块（启动时调用）
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

  const isRestored = restoreEnrichLockedWorkbook()
  if (isRestored) {
    // 恢复成功：设置下拉框选中值
    const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
    if (wbSelect && BGM.enrich.lockedWorkbookName) {
      wbSelect.value = BGM.enrich.lockedWorkbookName
    }
    refreshEnrichSheets(BGM.enrich.lockedWorkbookName || undefined, sheetSelectId, wbSelectId)
    const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
    if (sheetSelect && BGM.enrich.lockedSheetIndex) {
      sheetSelect.value = String(BGM.enrich.lockedSheetIndex)
    }
    bgmLog(LOG_LEVELS.INFO, '[enrichLock] 锁定状态已恢复')
  } else {
    // 未恢复：刷新当前活动工作簿的工作表列表
    refreshEnrichSheets(undefined, sheetSelectId, wbSelectId)
  }

  updateEnrichLockButton(lockButtonId, statusId)
}

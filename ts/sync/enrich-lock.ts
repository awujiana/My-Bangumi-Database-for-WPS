/**
 * 富化功能 - 目标工作表锁定 UI 适配层
 * @module sync/enrichLock
 * @description 富化页面的目标工作表选择与锁定 UI 控制器。
 *              与主面板共用 BGM.sheet 锁定状态，持久化键 `bgm_locked_sheet_<page>`，
 *              底层读写/扫描逻辑统一委托给 tools/locked-sheet.js（方案一）。
 */

import type { WpsWorksheet } from '../index.js'
import { getApp, bgmLog, BGM, LOG_LEVELS, showToast } from '../index.js'
import type { LockedSheetInfo } from '../tools/locked-sheet.js'
import {
  applyLockedSheet,
  isLockedAt,
  renderSheetLockUi,
  resolveCachedTarget,
  saveLockedSheet,
  clearLockedSheet,
  restoreLockedSheet,
  findWorkbookByName,
  findBangumiTargetSheets,
  getOpenWorkbooks,
} from '../tools/locked-sheet.js'
import {
  loadTargetCache,
  readWorkbookSignature,
  saveTargetCache,
} from '../tools/target-detect-cache.js'

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
    const defaultOption = document.createElement('option')
    defaultOption.value = ''
    defaultOption.textContent = '-- 请先选择工作簿 --'
    select.appendChild(defaultOption)
    return
  }

  const workbook = findWorkbookByName(wbName)
  if (!workbook) {
    bgmLog(LOG_LEVELS.WARN, `refreshEnrichSheets: 工作簿 "${wbName}" 不存在`)
    return
  }

  const sheets = workbook.Worksheets
  const currentLockedSheet = BGM.sheet.isLocked ? BGM.sheet.lockedName : null
  // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返（末尾日志复用同一值）
  const sheetCount = sheets.Count

  select.textContent = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = '-- 请选择工作表 --'
  select.appendChild(defaultOption)

  for (let index = 1; index <= sheetCount; index += 1) {
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
    `[enrichLock] 刷新工作表列表: ${wbName} 共 ${String(sheetCount)} 个工作表`,
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

  if (isLockedAt(sheetIndex, wbName)) {
    // §5.6 C4：解锁走共享清位实现（applyLockedSheet(null) + 持久化）
    clearLockedSheet('enrich')
    showToast('已解锁目标工作表', 'info')
  } else {
    const sheetName = sheetSelect.options[sheetSelect.selectedIndex]?.text ?? ''
    const info: LockedSheetInfo = { index: sheetIndex, name: sheetName, workbookName: wbName }
    applyLockedSheet(info)
    saveLockedSheet(info, 'enrich')
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
  // §5.6 C4：与主面板共用渲染实现（badge 模式 = 富化页的状态区显隐方式）
  renderSheetLockUi(lockButtonId, statusId, 'badge')
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

  let worksheet: WpsWorksheet
  try {
    worksheet = wb.Worksheets.Item(sheetIndex)
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `lockEnrichWorkbookByName: 读取工作表 ${String(sheetIndex)} 失败: ${String(error)}`,
    )
    return false
  }

  const sheetName = worksheet.Name
  applyLockedSheet({ index: sheetIndex, name: sheetName, workbookName })
  saveLockedSheet({ index: sheetIndex, name: sheetName, workbookName }, 'enrich')
  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichLock] 自动锁定: ${workbookName} → ${sheetName} (索引 ${String(sheetIndex)})`,
  )
  return true
}

/**
 * 按**工作簿名 + 工作表名**定位并锁定（索引由名字反查）。
 *
 * 供「一键套用」使用：跨页数据上下文快照里存的是名字而非索引
 * （索引跨会话会因用户增删表而漂移，名字不会）。簿或表不存在时返回 false，
 * 由调用方把按钮置为「套用失败」——不静默锁定到别的表上。
 */
export function lockEnrichSheetByName(workbookName: string, sheetName: string): boolean {
  const wb = findWorkbookByName(workbookName)
  if (!wb) {
    bgmLog(LOG_LEVELS.WARN, `lockEnrichSheetByName: 工作簿 "${workbookName}" 不存在`)
    return false
  }
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    let name: string
    try {
      name = wb.Worksheets.Item(index).Name
    } catch {
      // 宿主正在切换工作表：这一项读不到就跳过（不是 finally 语义，只是容错）
      name = ''
    }
    if (name === sheetName) {
      applyLockedSheet({ index, name: sheetName, workbookName })
      saveLockedSheet({ index, name: sheetName, workbookName }, 'enrich')
      bgmLog(
        LOG_LEVELS.INFO,
        `[enrichLock] 按名锁定: ${workbookName} → ${sheetName} (索引 ${String(index)})`,
      )
      return true
    }
  }
  bgmLog(LOG_LEVELS.WARN, `lockEnrichSheetByName: 工作表 "${sheetName}" 不在 "${workbookName}" 中`)
  return false
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
export function initializeEnrichLock(
  wbSelectId = 'enrichWorkbookSelect',
  sheetSelectId = 'enrichSheetSelect',
  lockButtonId = 'enrichLockBtn',
  statusId = 'enrichLockStatus',
): void {
  refreshEnrichWorkbooks(wbSelectId)

  const isRestored = restoreLockedSheet('enrich')
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
  options: { force?: boolean } = {},
): 'locked' | 'preselected' | 'none' {
  if (BGM.sheet.isLocked) return 'locked'

  const signature = readWorkbookSignature(getApp())

  // 识别结果缓存（§ 性能）：签名未变时只复核「簿/表存在性 + 表头」，不扫全簿全表。
  // 命中即按「唯一候选」处理（上一次识别时它已是排序后的最佳候选）。
  if (options.force !== true) {
    const cached = loadTargetCache('enrich', signature)
    const resolved = cached ? resolveCachedTarget(cached) : null
    if (resolved) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[enrichLock] 命中识别缓存: ${resolved.workbookName} → ${resolved.sheetName}（表头行 ${String(
          resolved.headerRow,
        )}）`,
      )
      return applyAutoSelectedTarget(resolved, wbSelectId, sheetSelectId, lockButtonId, statusId)
    }
  }

  const candidates = findBangumiTargetSheets()
  if (candidates.length === 0) {
    bgmLog(LOG_LEVELS.INFO, '[enrichLock] 未找到可自动选择的追踪表候选')
    return 'none'
  }

  const best = candidates[0]
  if (!best) return 'none'

  saveTargetCache('enrich', signature, {
    workbookName: best.workbookName,
    sheetIndex: best.sheetIndex,
    sheetName: best.sheetName,
    headerRow: best.headerRow,
    matchCount: best.headerMatchCount,
    columnCount: best.headerMatchCount,
  })

  if (candidates.length === 1) {
    return applyAutoSelectedTarget(best, wbSelectId, sheetSelectId, lockButtonId, statusId)
  }

  const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
  if (wbSelect) wbSelect.value = best.workbookName
  refreshEnrichSheets(best.workbookName, sheetSelectId, wbSelectId)
  const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
  if (sheetSelect) sheetSelect.value = String(best.sheetIndex)

  showToast(
    `检测到 ${String(candidates.length)} 个候选追踪表，已预选 ${best.sheetName}，请确认后锁定`,
    'warn',
  )
  return 'preselected'
}

/**
 * 把自动选中的目标同步到下拉框并尝试锁定（唯一候选 / 缓存命中共用）。
 * @returns 'locked' 已锁定 | 'preselected' 仅预选（锁定失败）
 */
function applyAutoSelectedTarget(
  target: { workbookName: string; sheetIndex: number; sheetName: string },
  wbSelectId: string,
  sheetSelectId: string,
  lockButtonId: string,
  statusId: string,
): 'locked' | 'preselected' {
  const wbSelect = document.getElementById(wbSelectId) as HTMLSelectElement | null
  if (wbSelect) wbSelect.value = target.workbookName
  refreshEnrichSheets(target.workbookName, sheetSelectId, wbSelectId)
  const sheetSelect = document.getElementById(sheetSelectId) as HTMLSelectElement | null
  if (sheetSelect) sheetSelect.value = String(target.sheetIndex)

  const isLocked = lockEnrichWorkbookByName(target.workbookName, target.sheetIndex)
  if (isLocked) {
    showToast(`已自动锁定: ${target.workbookName} → ${target.sheetName}`, 'success')
    updateEnrichLockButton(lockButtonId, statusId)
    return 'locked'
  }
  return 'preselected'
}

/**
 * 共享工作表锁定模块
 * @module tools/lockedSheet
 * @description 主面板与富化页面共用的目标工作表锁定与跨所有已打开工作簿的自动扫描。
 *              统一读写 BGM.sheet 状态，持久化到 `bgm_locked_sheet`，
 *              删除独立于 BGM.sheet 的富化锁定状态（方案一）。
 */

import { getApp, bgmLog, BGM, getCellValue, findHeaderRow } from './util/index.js'
import { PANEL_CONFIG, LOG_LEVELS, HEADER_KEYWORDS } from '../core/constants.js'
import type { WpsWorkbook, WpsWorksheet, WpsWindow } from './wps.js'

/** 锁定持久化键（主面板与富化页面共用） */
export const LOCKED_SHEET_KEY = 'bgm_locked_sheet'

export interface LockedSheetInfo {
  index: number
  name: string
  workbookName?: string
}

// ========== 持久化与状态重置 ==========

export function saveLockedSheet(info: LockedSheetInfo | null): void {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[lockedSheet] saveLockedSheet: PluginStorage 不可用')
    return
  }
  app.PluginStorage.setItem(LOCKED_SHEET_KEY, info ? JSON.stringify(info) : '')
}

/** 清除 BGM.sheet 锁定状态（内存 + 持久化） */
export function clearLockedSheet(): void {
  BGM.sheet.lockedIndex = null
  BGM.sheet.lockedName = null
  BGM.sheet.lockedWorkbookName = null
  BGM.sheet.isLocked = false
  saveLockedSheet(null)
}

/**
 * 从 PluginStorage 恢复锁定状态到 BGM.sheet，并校验工作簿是否仍存在
 * @returns 是否成功恢复
 */
export function restoreLockedSheet(): boolean {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[lockedSheet] restoreLockedSheet: PluginStorage 不可用')
    return false
  }
  const raw = app.PluginStorage.getItem(LOCKED_SHEET_KEY)
  if (!raw) return false

  try {
    const info = JSON.parse(raw) as Partial<LockedSheetInfo>
    BGM.sheet.lockedIndex = info.index ?? null
    BGM.sheet.lockedName = info.name ?? null
    BGM.sheet.lockedWorkbookName = info.workbookName ?? null
    BGM.sheet.isLocked = !!(info.index != null && info.name)

    if (BGM.sheet.isLocked && info.workbookName) {
      const isWorkbookFound = findWorkbookByName(info.workbookName) !== null
      if (!isWorkbookFound) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[restoreLockedSheet] 锁定的工作簿 "${info.workbookName}" 已不存在，清除锁信息`,
        )
        clearLockedSheet()
        return false
      }
    }
    return true
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[restoreLockedSheet] 解析锁定数据失败: ${String(error)}`)
    clearLockedSheet()
    return false
  }
}

// ========== 工作簿/工作表查找 ==========

/**
 * 获取当前 Application 实例中已打开的工作簿。
 *
 * WPS 边界：部分版本/窗口切换时 `Application.Workbooks` 的 Count/Item 枚举
 * 暂时不包含活动工作簿；但 `Application.ActiveWorkbook` 仍可直接访问。因此所有
 * 页面和扫描器都必须通过这个统一入口取工作簿，不能各自只遍历 Workbooks。
 *
 * 注意：这里的 Application 只代表当前 WPS 实例。若用户把文件分别打开在两个
 * 独立的 WPS 进程中，当前加载项无法跨进程枚举另一个进程的工作簿，这是 WPS
 * JS API 的边界，不应把「当前实例不可见」误报成「文件未打开」。
 */
export function getOpenWorkbooks(): WpsWorkbook[] {
  const app = getApp()
  if (!app) return []

  const result: WpsWorkbook[] = []
  const seen = new Set<string>()
  const add = (wb: WpsWorkbook | null): void => {
    if (!wb) return
    const key = (() => {
      try {
        return wb.FullName || wb.Name
      } catch {
        return ''
      }
    })()
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    const identity = `${key}\u{0000}${name}`
    if (!key || seen.has(identity)) return
    seen.add(identity)
    result.push(wb)
  }

  const workbooks = app.Workbooks
  if (workbooks) {
    const count = (() => {
      try {
        return Math.max(0, workbooks.Count || 0)
      } catch {
        return 0
      }
    })()
    for (let index = 1; index <= count; index += 1) {
      try {
        add(workbooks.Item(index))
      } catch {
        // 集合在窗口切换期间可能瞬时失效，跳过本项，继续保留其他工作簿
      }
    }
  }

  // 某些 WPS 版本的 Workbooks 集合只返回当前窗口；再从 Windows.ActiveSheet.Parent
  // 反查每个可见窗口的工作簿，补齐同一 Application 实例中的其他窗口。
  const windows = app.Windows
  if (windows) {
    const windowCount = (() => {
      try {
        return Math.max(0, windows.Count ?? 0)
      } catch {
        return 0
      }
    })()
    for (let index = 1; index <= windowCount; index += 1) {
      try {
        const windowObject: WpsWindow = windows.Item(index)
        const activeSheetParent = windowObject.ActiveSheet?.Parent
        const workbookFromWindow = windowObject.Workbook ?? activeSheetParent ?? windowObject.Parent
        if (workbookFromWindow && typeof workbookFromWindow === 'object') {
          const candidate = workbookFromWindow as WpsWorkbook
          add(candidate)
        }
      } catch {
        // 窗口正在切换或为非工作簿窗口时跳过
      }
    }
  }

  // 关键兜底：活动工作簿不在 Workbooks 枚举结果中时仍纳入列表.
  try {
    add(app.ActiveWorkbook ?? null)
  } catch {
    // 活动窗口正在切换时读取可能失败，下次刷新/轮询再尝试
  }

  return result
}

export function findWorkbookByName(name: string | null): WpsWorkbook | null {
  if (!name) return null
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName) return null
  for (const wb of getOpenWorkbooks()) {
    try {
      if (wb.Name.trim().toLowerCase() === normalizedName) return wb
    } catch {
      // 工作簿正在切换/关闭，跳过当前项
    }
  }
  return null
}

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
 * 解析当前锁定的工作簿 + 工作表引用（跨所有已打开工作簿）
 * @returns [工作簿, 工作表] 元组；未锁定或引用失效时清除锁并返回 null
 */
export function getLockedSheet(): [WpsWorkbook, WpsWorksheet] | null {
  if (!BGM.sheet.isLocked) return null
  const app = getApp()
  const wb = BGM.sheet.lockedWorkbookName
    ? findWorkbookByName(BGM.sheet.lockedWorkbookName)
    : (app?.ActiveWorkbook ?? null)
  if (!wb) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[getLockedSheet] 锁定的工作簿 "${BGM.sheet.lockedWorkbookName ?? ''}" 已不存在`,
    )
    clearLockedSheet()
    return null
  }
  let ws: WpsWorksheet | null = null
  for (let index = 1; index <= wb.Worksheets.Count; index += 1) {
    const sheet = wb.Worksheets.Item(index)
    if (sheet.Name === BGM.sheet.lockedName) {
      ws = sheet
      break
    }
  }
  if (!ws) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[getLockedSheet] 锁定的工作表 "${BGM.sheet.lockedName ?? ''}" 已不存在`,
    )
    clearLockedSheet()
    return null
  }
  return [wb, ws]
}

// ========== 跨工作簿自动扫描 ==========

/** 工作表名称初筛关键词（低成本预筛，命中后再用表头+数据行校验） */
export const TARGET_SHEET_NAME_KEYWORDS = [
  'bangumi',
  'bgm',
  '追踪',
  '剧集',
  '动画',
  '番剧',
  '动漫',
] as const

/** 自动扫描命中的候选目标工作表 */
export interface TargetSheetCandidate {
  workbookName: string
  sheetIndex: number
  sheetName: string
  headerRow: number
  headerMatchCount: number
  dataRowCount: number
  /** 名称是否命中关键词（true 表示强候选） */
  isNameHit: boolean
}

/** 需要跳过的系统工作表（同步记录 / 模糊搜索等） */
const SYSTEM_SHEET_PATTERN = /^(同步记录|SyncRecord|模糊|搜索|SEARCH)/i

function isSystemSheet(name: string): boolean {
  return SYSTEM_SHEET_PATTERN.test(name)
}

function countHeaderKeywordsInRow(ws: WpsWorksheet, row: number): number {
  let count = 0
  for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col += 1) {
    const v = getCellValue(ws, row, col).toLowerCase()
    if (v && HEADER_KEYWORDS.some((header) => v.includes(header.toLowerCase()))) count += 1
  }
  return count
}

/** 判断某行「前 MAX_SCAN_COLUMNS 列中是否有任一列有值」 */
function isRowPopulated(ws: WpsWorksheet, row: number): boolean {
  for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col += 1) {
    if (getCellValue(ws, row, col).trim()) return true
  }
  return false
}

/** 统计表头行后前 10 行中「任意列有值」的数据行数 */
function countDataRowsAfter(ws: WpsWorksheet, headerRow: number): number {
  let count = 0
  for (let row = headerRow + 1; row <= headerRow + 10; row += 1) {
    if (isRowPopulated(ws, row)) count += 1
  }
  return count
}

/** 构建单个工作表的候选；不满足判定规则时返回 null */
function buildCandidate(wb: WpsWorkbook, wsIndex: number, isNameHitOnly: boolean) {
  let ws: WpsWorksheet
  try {
    ws = wb.Worksheets.Item(wsIndex)
  } catch {
    return null
  }
  const sheetName = ws.Name
  if (isSystemSheet(sheetName)) return null

  const lowerName = sheetName.toLowerCase()
  const isNameHit = TARGET_SHEET_NAME_KEYWORDS.some((keyword) => lowerName.includes(keyword))
  if (isNameHitOnly && !isNameHit) return null

  const headerRow = findHeaderRow(ws)
  if (headerRow <= 0) return null
  const headerMatchCount = countHeaderKeywordsInRow(ws, headerRow)
  if (headerMatchCount < 3) return null
  const dataRowCount = countDataRowsAfter(ws, headerRow)
  if (dataRowCount < 2) return null

  return {
    workbookName: wb.Name,
    sheetIndex: wsIndex,
    sheetName,
    headerRow,
    headerMatchCount,
    dataRowCount,
    isNameHit,
  }
}

/**
 * 扫描所有已打开工作簿，寻找 Bangumi 追踪表目标工作表。
 *
 * 判定规则（表头 + 数据行数 + 名称关键词）：
 *  1. 表头校验：findHeaderRow 命中 ≥3 个 Bangumi 表头关键词；
 *  2. 数据行数：表头行后前 10 行中 ≥2 行有数据；
 *  3. 名称关键词：工作表名命中 bangumi/追踪/剧集/动画/番剧/动漫 等；
 *     名称命中的强候选优先；无名称命中时回退扫描全部通过表头+数据行校验的工作表。
 *
 * 排序偏好：当前活动工作簿 + 当前活动工作表 > 当前活动工作簿 > 名称关键词命中 > 扫描顺序。
 * @returns 按偏好排序的候选列表（可能为空）
 */
export function findBangumiTargetSheets(): TargetSheetCandidate[] {
  const app = getApp()
  if (!app) {
    bgmLog(LOG_LEVELS.WARN, 'findBangumiTargetSheets: 无法获取 Application')
    return []
  }

  const workbooks = getOpenWorkbooks()
  let activeWbName = ''
  let activeSheetName = ''
  try {
    activeWbName = app.ActiveWorkbook?.Name ?? ''
    activeSheetName = app.ActiveWorkbook?.ActiveSheet.Name ?? ''
  } catch {
    // 读取活动工作簿/工作表失败时忽略，仅不启用活动对象偏好
  }

  const collect = (isNameHitOnly: boolean): TargetSheetCandidate[] => {
    const collected: TargetSheetCandidate[] = []
    for (const wb of workbooks) {
      const sheetCount = (() => {
        try {
          return Math.max(0, wb.Worksheets.Count || 0)
        } catch {
          return 0
        }
      })()
      for (let wsIndex = 1; wsIndex <= sheetCount; wsIndex += 1) {
        try {
          const candidate = buildCandidate(wb, wsIndex, isNameHitOnly)
          if (candidate) collected.push(candidate)
        } catch {
          // 工作表在刷新期间失效时跳过当前项
        }
      }
    }
    return collected
  }

  const candidates = collect(true)
  const effective =
    candidates.length > 0 ? candidates : collect(false).map((c) => ({ ...c, isNameHit: false }))

  const activeRanking = (c: TargetSheetCandidate): number => {
    const isActiveWb = c.workbookName === activeWbName
    if (isActiveWb && activeSheetName && c.sheetName === activeSheetName) return 0
    if (isActiveWb) return 1
    if (c.isNameHit) return 2
    return 3
  }
  effective.sort((a, b) => activeRanking(a) - activeRanking(b))

  bgmLog(
    LOG_LEVELS.INFO,
    `[lockedSheet] 自动扫描候选目标: ${String(effective.length)} 个 (${effective
      .map((c) => `${c.workbookName} → ${c.sheetName}`)
      .join(' | ')})`,
  )
  return effective
}

/**
 * 在指定工作簿内查找最优 Bangumi 追踪表候选。
 * 判定规则与 findBangumiTargetSheets 一致（表头 ≥3 关键词 + 数据行 ≥2），
 * 排序偏好：工作表名命中关键词的强候选优先，否则取扫描顺序首个通过校验的工作表。
 * 供自动识别模块对单个工作簿（事件时机）做实时校验。
 */
export function findBangumiTargetSheetInWorkbook(wb: WpsWorkbook): WpsWorksheet | null {
  const sheetCount = wb.Worksheets.Count

  for (let wsIndex = 1; wsIndex <= sheetCount; wsIndex += 1) {
    const candidate = buildCandidate(wb, wsIndex, false)
    if (candidate?.isNameHit) return wb.Worksheets.Item(candidate.sheetIndex)
  }

  for (let wsIndex = 1; wsIndex <= sheetCount; wsIndex += 1) {
    const candidate = buildCandidate(wb, wsIndex, false)
    if (candidate) return wb.Worksheets.Item(candidate.sheetIndex)
  }

  return null
}

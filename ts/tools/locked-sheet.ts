/**
 * 共享工作表锁定模块
 * @module tools/lockedSheet
 * @description 主面板与富化页面共用的目标工作表锁定与跨所有已打开工作簿的自动扫描。
 *              统一读写 BGM.sheet 状态，持久化到 `bgm_locked_sheet`，
 *              删除独立于 BGM.sheet 的富化锁定状态（方案一）。
 */

import { getApp, bgmLog, BGM, getCellValue, findHeaderRow } from './util/index.js'
import { PANEL_CONFIG, LOG_LEVELS, HEADER_KEYWORDS } from '../core/constants.js'
import type { WpsWorkbook, WpsWorksheet } from './wps.js'

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

    if (BGM.sheet.isLocked && info.workbookName && app.Workbooks) {
      let isWorkbookFound = false
      for (let index = 1; index <= app.Workbooks.Count; index += 1) {
        if (app.Workbooks.Item(index).Name === info.workbookName) {
          isWorkbookFound = true
          break
        }
      }
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
  const dataRowCount = countDataRowsAfter(ws, headerRow)
  if (dataRowCount < 2) return null

  return {
    workbookName: wb.Name,
    sheetIndex: wsIndex,
    sheetName,
    headerRow,
    headerMatchCount: countHeaderKeywordsInRow(ws, headerRow),
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
  if (!app?.Workbooks) {
    bgmLog(LOG_LEVELS.WARN, 'findBangumiTargetSheets: 无法获取 Workbooks')
    return []
  }

  const workbookCount = app.Workbooks.Count
  const workbooks = app.Workbooks
  const activeWbName = app.ActiveWorkbook?.Name ?? ''
  let activeSheetName = ''
  try {
    activeSheetName = app.ActiveWorkbook?.ActiveSheet.Name ?? ''
  } catch {
    // 读取活动工作表失败时忽略，仅不启用活动工作表偏好
  }

  const collect = (isNameHitOnly: boolean): TargetSheetCandidate[] => {
    const collected: TargetSheetCandidate[] = []
    for (let wbIndex = 1; wbIndex <= workbookCount; wbIndex += 1) {
      const wb = workbooks.Item(wbIndex)
      for (let wsIndex = 1; wsIndex <= wb.Worksheets.Count; wsIndex += 1) {
        const candidate = buildCandidate(wb, wsIndex, isNameHitOnly)
        if (candidate) collected.push(candidate)
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

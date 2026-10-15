/**
 * 共享工作表锁定模块
 * @module tools/lockedSheet
 * @description 主面板与富化页面共用的目标工作表锁定与跨所有已打开工作簿的自动扫描。
 *              统一读写 BGM.sheet 状态，持久化到 `bgm_locked_sheet`，
 *              删除独立于 BGM.sheet 的富化锁定状态（方案一）。
 */

import { getApp, bgmLog, BGM, getCellValue, findHeaderRow } from './util/index.js'
// 直接依赖 util/sheet.js 的矩形读：它自带 try/catch，宿主/桩不支持区域读时返回 []，
// 调用方据此回退逐格读（见 buildCandidate）。
import { readRangeValues } from './util/sheet.js'
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
  return resolveSheetInWorkbook(wb, sheetName, null)
}

/**
 * 安全读取工作簿中指定索引的工作表（索引越界 / 宿主正在切换时返回 null）。
 *
 * 提示性探测必须容错：`lockedIndex` 可能过期（跨会话期间用户重排/删除过工作表），
 * 越界时 WPS 的 `Worksheets.Item` 会抛错，这里吞掉并交给全表扫描兜底。
 */
function readSheetAtIndex(wb: WpsWorkbook, index: number): WpsWorksheet | null {
  try {
    return wb.Worksheets.Item(index)
  } catch {
    return null
  }
}

/**
 * 按名称在指定工作簿中解析工作表。
 *
 * **性能优化（O-2）**：优先用 `hintIndex`（即锁状态里已维护的 `BGM.sheet.lockedIndex`）
 * 做**单次**探测 —— 命中时只花 1 次 COM 往返，避免逐表 `Item(i)` + `Name` 的线性扫描
 * （N 张表 → 1 次）。
 *
 * 索引只是**提示**、不是真相：缓存/持久化的索引可能过期（跨会话期间用户重排 / 删除过
 * 工作表），因此每次都用工作表名**复核**，复核不过就回落全表扫描。这样既不需要在四处
 * 锁写入点挂失效钩子，也不会因外部重命名 / 换序 / 删表而解析到错表。
 *
 * @param wb 目标工作簿
 * @param sheetName 目标工作表名
 * @param hintIndex 索引提示；为 null 时直接全表扫描
 * @returns 命中的工作表；未命中返回 null
 */
function resolveSheetInWorkbook(
  wb: WpsWorkbook,
  sheetName: string | null,
  hintIndex: number | null,
): WpsWorksheet | null {
  if (hintIndex != null) {
    const hinted = readSheetAtIndex(wb, hintIndex)
    if (hinted?.Name === sheetName) return hinted
  }
  // 扫描边界先取值：`Count` 是 COM 属性，写在循环条件里会每轮多一次往返
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    const sheet = wb.Worksheets.Item(index)
    if (sheet.Name === sheetName) return sheet
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
  const ws = resolveSheetInWorkbook(wb, BGM.sheet.lockedName, BGM.sheet.lockedIndex)
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

/** 表头行后向下扫描的数据行数（判定「有数据的工作表」用） */
const DATA_SCAN_ROWS = 10

/** 统计一行单元格里命中的表头关键字数（行内容已由调用方批量读出） */
function countHeaderKeywordsInCells(cells: string[]): number {
  let count = 0
  for (const raw of cells) {
    const v = raw.toLowerCase()
    if (v && HEADER_KEYWORDS.some((header) => v.includes(header.toLowerCase()))) count += 1
  }
  return count
}

/** 判断一行单元格中是否「任意列有值」（行内容已由调用方批量读出） */
function isRowPopulatedCells(cells: string[]): boolean {
  return cells.some((v) => v.trim() !== '')
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
  for (let row = headerRow + 1; row <= headerRow + DATA_SCAN_ROWS; row += 1) {
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
  // 快路径：一次矩形读「表头行 + 其后 DATA_SCAN_ROWS 行」× MAX_SCAN_COLUMNS 列
  // （原先是 60 + 10×60 = 660 次逐格 COM 往返 / 每张表）。
  // 读回行数不足时回退逐格读，保证行为与改造前完全一致。
  const block = readRangeValues(
    ws,
    headerRow,
    headerRow + DATA_SCAN_ROWS,
    1,
    PANEL_CONFIG.MAX_SCAN_COLUMNS,
  )
  // 两个分支都会赋值，无需初值（消除 no-useless-assignment）
  let headerMatchCount: number
  let dataRowCount: number
  if (block.length === DATA_SCAN_ROWS + 1) {
    headerMatchCount = countHeaderKeywordsInCells(block[0] ?? [])
    dataRowCount = block.slice(1).filter((cells) => isRowPopulatedCells(cells)).length
  } else {
    headerMatchCount = countHeaderKeywordsInRow(ws, headerRow)
    dataRowCount = countDataRowsAfter(ws, headerRow)
  }
  if (headerMatchCount < 3) return null
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

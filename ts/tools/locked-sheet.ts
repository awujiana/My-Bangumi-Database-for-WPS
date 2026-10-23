/**
 * 共享工作表锁定模块
 * @module tools/lockedSheet
 * @description 主面板与富化页面共用的目标工作表锁定与跨所有已打开工作簿的自动扫描。
 *              统一读写 BGM.sheet 状态，持久化到 `bgm_locked_sheet_<page>`，
 *              删除独立于 BGM.sheet 的富化锁定状态（方案一）。
 */

import { getApp, bgmLog, BGM, getCellValue, findHeaderRow, clearSheetCache } from './util/index.js'
// 直接依赖 util/sheet.js 的矩形读：它自带 try/catch，宿主/桩不支持区域读时返回 []，
// 调用方据此回退逐格读（见 buildCandidate）。
import { readRangeValues } from './util/sheet.js'
import { PANEL_CONFIG, LOG_LEVELS, HEADER_KEYWORDS } from '../core/constants.js'
import type { WpsWorkbook, WpsWorksheet, WpsWindow } from './wps.js'
import type { CachedTarget } from './target-detect-cache.js'

/** 锁定持久化键前缀（各页独立键：`bgm_locked_sheet_<page>`） */
export const LOCKED_SHEET_KEY = 'bgm_locked_sheet'

/**
 * 各页独立的锁定键：panel 与 enrich 曾共用一把锁互相覆盖 ——
 * 在面板锁了表，切到富化页锁另一张，回来面板的锁没了。现在各页各存各的。
 * @param page 页面标识（'panel' / 'enrich' …）
 */
export function lockedSheetKey(page: string): string {
  return `${LOCKED_SHEET_KEY}_${page}`
}

export interface LockedSheetInfo {
  index: number
  name: string
  workbookName?: string
}

// ========== 持久化与状态重置 ==========

export function saveLockedSheet(info: LockedSheetInfo | null, page = 'panel'): void {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[lockedSheet] saveLockedSheet: PluginStorage 不可用')
    return
  }
  app.PluginStorage.setItem(lockedSheetKey(page), info ? JSON.stringify(info) : '')
}

/**
 * 应用锁定状态到 `BGM.sheet`（内存状态的**唯一置位 / 清位点**）。
 *
 * §5.6 C4：主面板 `toggleSheetLock` 与富化页 `toggleEnrichWorkbookLock` 原先
 * 各写一份四字段赋值（还有 `lockEnrichWorkbookByName` 的自动锁定路径），
 * 收敛到本函数后，页面层只负责校验 / 提示 / 持久化 / 页面后处理。
 * @param info 锁定的工作表信息；`null` 表示解锁（四个字段全部清空）
 */
export function applyLockedSheet(info: LockedSheetInfo | null): void {
  BGM.sheet.lockedIndex = info?.index ?? null
  BGM.sheet.lockedName = info?.name ?? null
  BGM.sheet.lockedWorkbookName = info?.workbookName ?? null
  BGM.sheet.isLocked = info !== null
}

/**
 * 当前锁定是否指向该工作表。
 * @param sheetIndex 工作表索引（1-based）
 * @param workbookName 传入时还要求工作簿名一致（富化页语义）；
 *                     不传时只比较索引（主面板语义）
 */
export function isLockedAt(sheetIndex: number, workbookName?: string): boolean {
  if (!BGM.sheet.isLocked || BGM.sheet.lockedIndex !== sheetIndex) return false
  return workbookName === undefined || BGM.sheet.lockedWorkbookName === workbookName
}

/**
 * 渲染锁定按钮与状态文字（主面板 / 富化页共用，§5.6 C4）。
 *
 * 两处页面的**按钮**渲染完全一致；**状态区**的显隐方式不同：
 * - `inline`（主面板）：`style.display` 显隐，锁定文案只带工作表名；
 * - `badge`（富化页）：`classList.show` 显隐，锁定文案带「工作簿 → 工作表」。
 * 逐字保留两套既有行为，不强行统一视觉。
 */
export function renderSheetLockUi(
  buttonId: string,
  statusId: string,
  statusMode: 'inline' | 'badge' = 'inline',
): void {
  const button = document.getElementById(buttonId) as HTMLButtonElement | null
  if (button) {
    button.textContent = BGM.sheet.isLocked ? '🔓 解锁' : '🔒 锁定'
    button.classList.toggle('locked', BGM.sheet.isLocked)
  }

  const status = document.getElementById(statusId)
  if (!status) return

  if (statusMode === 'badge') {
    status.classList.toggle('show', BGM.sheet.isLocked)
    status.textContent = BGM.sheet.isLocked
      ? `已锁定: ${BGM.sheet.lockedWorkbookName ?? ''} → ${BGM.sheet.lockedName ?? ''}`
      : ''
    return
  }

  status.style.display = BGM.sheet.isLocked ? 'inline' : 'none'
  if (BGM.sheet.isLocked) {
    status.textContent = `已锁定: ${String(BGM.sheet.lockedName)}`
  }
}

/** 清除 BGM.sheet 锁定状态（内存 + 持久化） */
export function clearLockedSheet(page = 'panel'): void {
  applyLockedSheet(null)
  saveLockedSheet(null, page)
}

/**
 * 从 PluginStorage 恢复锁定状态到 BGM.sheet，并校验工作簿是否仍存在
 * @param page 页面标识（读该页自己的锁定键）
 * @returns 是否成功恢复
 */
export function restoreLockedSheet(page = 'panel'): boolean {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[lockedSheet] restoreLockedSheet: PluginStorage 不可用')
    return false
  }
  const raw = app.PluginStorage.getItem(lockedSheetKey(page))
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
        clearLockedSheet(page)
        return false
      }
    }
    return true
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[restoreLockedSheet] 解析锁定数据失败: ${String(error)}`)
    clearLockedSheet(page)
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
  return resolveSheetWithIndex(wb, sheetName, hintIndex)?.sheet ?? null
}

/**
 * 按名称解析工作表并同时返回其索引（1-based）。
 *
 * 与 {@link resolveSheetInWorkbook} 同一套「索引提示 + 名称复核」策略，
 * 区别是**把命中的索引也带出来**——识别结果缓存需要回写最新的索引
 * （用户重排工作表后，索引会变而名称不变）。
 */
function resolveSheetWithIndex(
  wb: WpsWorkbook,
  sheetName: string | null,
  hintIndex: number | null,
): { sheet: WpsWorksheet; index: number } | null {
  if (hintIndex != null) {
    const hinted = readSheetAtIndex(wb, hintIndex)
    if (hinted?.Name === sheetName) return { sheet: hinted, index: hintIndex }
  }
  // 扫描边界先取值：`Count` 是 COM 属性，写在循环条件里会每轮多一次往返
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    const sheet = wb.Worksheets.Item(index)
    if (sheet.Name === sheetName) return { sheet, index }
  }
  return null
}

/**
 * 校验识别结果缓存里的目标表是否仍然可用。
 *
 * 命中缓存后只花「找簿 + 找表 + 1 次表头矩形读」，不扫其它工作簿/工作表：
 *  1. 工作簿仍打开（按名称）；
 *  2. 工作表仍存在（索引提示 + 名称复核，重排/改名都不会解析到错表）；
 *  3. 表头仍能识别（表头行可能因插行而上移/下移，故用**新读到的行号**覆盖缓存值）。
 *
 * @returns 复核通过的识别结果（索引/表头以本次复核为准）；任一环节失败返回 `null`
 */
export function resolveCachedTarget(target: CachedTarget): CachedTarget | null {
  const wb = findWorkbookByName(target.workbookName)
  if (!wb) return null

  const resolved = resolveSheetWithIndex(wb, target.sheetName, target.sheetIndex)
  if (!resolved) return null
  const { sheet, index } = resolved

  // 表头复核前清一次该表缓存：保证读到的是当前工作表内容（1 次 10×60 矩形读）
  clearSheetCache(sheet)
  const headerRow = findHeaderRow(sheet)
  if (!headerRow) return null

  return { ...target, sheetIndex: index, sheetName: sheet.Name, headerRow }
}

/**
 * 解析当前锁定的工作簿 + 工作表引用（跨所有已打开工作簿）
 * @returns [工作簿, 工作表] 元组；未锁定或引用失效时清除锁并返回 null
 */
export function getLockedSheet(page = 'panel'): [WpsWorkbook, WpsWorksheet] | null {
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
    clearLockedSheet(page)
    return null
  }
  const worksheet = resolveSheetInWorkbook(wb, BGM.sheet.lockedName, BGM.sheet.lockedIndex)
  if (!worksheet) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[getLockedSheet] 锁定的工作表 "${BGM.sheet.lockedName ?? ''}" 已不存在`,
    )
    clearLockedSheet(page)
    return null
  }
  return [wb, worksheet]
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

function countHeaderKeywordsInRow(worksheet: WpsWorksheet, row: number): number {
  let count = 0
  for (let column = 1; column <= PANEL_CONFIG.MAX_SCAN_COLUMNS; column += 1) {
    const v = getCellValue(worksheet, row, column).toLowerCase()
    if (v && HEADER_KEYWORDS.some((header) => v.includes(header.toLowerCase()))) count += 1
  }
  return count
}

/** 判断某行「前 MAX_SCAN_COLUMNS 列中是否有任一列有值」 */
export function isRowPopulated(worksheet: WpsWorksheet, row: number): boolean {
  for (let column = 1; column <= PANEL_CONFIG.MAX_SCAN_COLUMNS; column += 1) {
    if (getCellValue(worksheet, row, column).trim()) return true
  }
  return false
}

/** 统计表头行后前 10 行中「任意列有值」的数据行数 */
export function countDataRowsAfter(worksheet: WpsWorksheet, headerRow: number): number {
  let count = 0
  for (let row = headerRow + 1; row <= headerRow + DATA_SCAN_ROWS; row += 1) {
    if (isRowPopulated(worksheet, row)) count += 1
  }
  return count
}

/** 构建单个工作表的候选；不满足判定规则时返回 null */
function buildCandidate(wb: WpsWorkbook, worksheetIndex: number, isNameHitOnly: boolean) {
  let worksheet: WpsWorksheet
  try {
    worksheet = wb.Worksheets.Item(worksheetIndex)
  } catch {
    return null
  }
  const sheetName = worksheet.Name
  if (isSystemSheet(sheetName)) return null

  const lowerName = sheetName.toLowerCase()
  const isNameHit = TARGET_SHEET_NAME_KEYWORDS.some((keyword) => lowerName.includes(keyword))
  if (isNameHitOnly && !isNameHit) return null

  const headerRow = findHeaderRow(worksheet)
  if (headerRow <= 0) return null
  // 快路径：一次矩形读「表头行 + 其后 DATA_SCAN_ROWS 行」× MAX_SCAN_COLUMNS 列
  // （原先是 60 + 10×60 = 660 次逐格 COM 往返 / 每张表）。
  // 读回行数不足时回退逐格读，保证行为与改造前完全一致。
  const block = readRangeValues(
    worksheet,
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
    headerMatchCount = countHeaderKeywordsInRow(worksheet, headerRow)
    dataRowCount = countDataRowsAfter(worksheet, headerRow)
  }
  if (headerMatchCount < 3) return null
  if (dataRowCount < 2) return null

  return {
    workbookName: wb.Name,
    sheetIndex: worksheetIndex,
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
      for (let worksheetIndex = 1; worksheetIndex <= sheetCount; worksheetIndex += 1) {
        try {
          const candidate = buildCandidate(wb, worksheetIndex, isNameHitOnly)
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

  for (let worksheetIndex = 1; worksheetIndex <= sheetCount; worksheetIndex += 1) {
    const candidate = buildCandidate(wb, worksheetIndex, false)
    if (candidate?.isNameHit) return wb.Worksheets.Item(candidate.sheetIndex)
  }

  for (let worksheetIndex = 1; worksheetIndex <= sheetCount; worksheetIndex += 1) {
    const candidate = buildCandidate(wb, worksheetIndex, false)
    if (candidate) return wb.Worksheets.Item(candidate.sheetIndex)
  }

  return null
}

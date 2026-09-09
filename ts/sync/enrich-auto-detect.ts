/**
 * @fileoverview 工作簿自动识别通用模块
 * @module sync/enrichAutoDetect
 * @description 自动识别 WPS 中已打开的目标工作簿（新番表 / Bangumi 数据表）。
 *
 * 识别方式参考 Bangumi 同步工具（tools/locked-sheet.ts findBangumiTargetSheets）：
 *   1. 低成本名称预筛：文件名 / 工作表名包含目标关键词；
 *   2. 表头校验：命中 ≥3 个目标表头关键字；
 *   3. 数据行校验：表头行后 ≥2 行有数据。
 *
 * 检查时机（多种，注册后统一生效）：
 *   A. 打开 WPS（加载项加载）时：initWorkbookAutoDetect 全量扫描 + 事件监听，结果持久化到 PluginStorage；
 *   B. 打开富化工具页面时：collectDetectedWorkbookPaths 合并持久化结果与实时扫描，由页面自动添加并识别；
 *   C. 打开新工作簿时：WorkbookOpen 事件实时记录；
 *   D. 切换活动工作簿时：WorkbookActivate 事件实时记录；
 *   E. 切换活动工作表时：SheetActivate 事件实时记录。
 */

import { LOG_LEVELS, PANEL_CONFIG } from '../core/constants.js'
import { detectAnimeSourceLayout } from './enrich-engine.js'
import { bgmLog, getApp, getCellValue } from '../tools/util/index.js'
import {
  findBangumiTargetSheetInWorkbook,
  TARGET_SHEET_NAME_KEYWORDS,
} from '../tools/locked-sheet.js'
import type { WpsWorkbook, WpsWorksheet } from '../tools/wps.js'

// ========== 检测器定义 ==========

/** 工作簿检测器：定义一种「目标工作簿」的识别方式（名称预筛 + 表头/数据行校验） */
export interface WorkbookDetector {
  /** PluginStorage 持久化键（不同检测目标独立存储，避免相互覆盖） */
  key: string
  /** 显示名（日志 / 提示用） */
  label: string
  /** 低成本名称级预筛：命中才做表头/数据行完整校验；未提供则跳过预筛 */
  isNameMatch?: (wb: WpsWorkbook) => boolean
  /** 完整校验：在指定工作簿中查找首个命中目标的工作表；未命中返回 null */
  findDetectedSheet: (wb: WpsWorkbook) => WpsWorksheet | null
}

/** 新番表文件名预筛关键词（低成本，命中后再做表头/数据行校验） */
export const ANIME_FILENAME_KEYWORDS = ['新番', '番组', 'xinfan'] as const

/** 文件名是否命中新番表关键词（纯函数，可单测） */
export function isAnimeFilename(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return ANIME_FILENAME_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

/** 从文件路径提取文件名（纯函数，可单测） */
export function extractFileNameFromPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath
}

/** 判断某行「前 MAX_SCAN_COLUMNS 列中是否有任一列有值」（参考 locked-sheet.ts isRowPopulated） */
function isRowPopulated(ws: WpsWorksheet, row: number): boolean {
  for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col += 1) {
    if (getCellValue(ws, row, col).trim()) return true
  }
  return false
}

/** 统计表头行后前 10 行中「任意列有值」的数据行数（参考 locked-sheet.ts countDataRowsAfter） */
function countDataRowsAfter(ws: WpsWorksheet, headerRow: number): number {
  let count = 0
  for (let row = headerRow + 1; row <= headerRow + 10; row += 1) {
    if (isRowPopulated(ws, row)) count += 1
  }
  return count
}

/** 读取并校验单个工作表是否为新番表布局（表头 ≥3 关键字 + ≥2 数据行）；不满足返回 null */
function inspectWorksheet(wb: WpsWorkbook, index: number): WpsWorksheet | null {
  let ws: WpsWorksheet
  try {
    ws = wb.Worksheets.Item(index)
  } catch {
    return null
  }
  const layout = detectAnimeSourceLayout(ws)
  if (!layout) return null
  if (countDataRowsAfter(ws, layout.headerRow) < 2) return null
  return ws
}

/** 在指定工作簿中查找首个满足「新番表布局 + ≥2 数据行」的工作表；未命中返回 null */
export function findAnimeSourceSheet(wb: WpsWorkbook): WpsWorksheet | null {
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    const ws = inspectWorksheet(wb, index)
    if (ws) return ws
  }
  return null
}

/** 新番表检测器：文件名关键词预筛 + 表头/数据行校验 */
export const ANIME_SOURCE_DETECTOR: WorkbookDetector = {
  key: 'bgm_enrich_auto_detect',
  label: '新番表',
  isNameMatch: (wb: WpsWorkbook) => isAnimeFilename(wb.Name),
  findDetectedSheet: findAnimeSourceSheet,
}

/** 工作簿内是否存在工作表名命中 Bangumi 追踪表关键词（仅读 Name，低成本预筛） */
function hasBangumiSheetName(wb: WpsWorkbook): boolean {
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    try {
      const lower = wb.Worksheets.Item(index).Name.toLowerCase()
      if (TARGET_SHEET_NAME_KEYWORDS.some((keyword) => lower.includes(keyword))) return true
    } catch {
      // 读取失败的工作表跳过
    }
  }
  return false
}

/** Bangumi 数据表检测器：工作表名关键词预筛 + 表头/数据行校验（参考 findBangumiTargetSheets） */
export const BANGUMI_TARGET_DETECTOR: WorkbookDetector = {
  key: 'bgm_enrich_auto_detect_bangumi',
  label: 'Bangumi 数据表',
  isNameMatch: hasBangumiSheetName,
  findDetectedSheet: findBangumiTargetSheetInWorkbook,
}

/** 全部已注册检测器（事件与全量扫描统一遍历） */
export const ALL_DETECTORS: readonly WorkbookDetector[] = [
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
]

// ========== 工作簿判定与扫描 ==========

/** 安全执行目标表校验（校验异常按未命中处理，供扫描循环跳过异常项） */
function findDetectedSheetSafely(detector: WorkbookDetector, wb: WpsWorkbook): WpsWorksheet | null {
  try {
    return detector.findDetectedSheet(wb)
  } catch {
    return null
  }
}

/**
 * 判断工作簿是否命中检测目标：名称预筛 + 表头/数据行双重校验。
 * 仅命中名称不算数，必须同时存在可识别的目标表布局，避免误判普通表格。
 */
export function isDetectedWorkbook(detector: WorkbookDetector, wb: WpsWorkbook): boolean {
  if (detector.isNameMatch && !detector.isNameMatch(wb)) return false
  return findDetectedSheetSafely(detector, wb) !== null
}

/** 安全读取工作簿（读取失败返回 null，供扫描循环跳过异常项） */
function readWorkbookSafely(
  wbs: { Item(index: number): WpsWorkbook },
  index: number,
): WpsWorkbook | null {
  try {
    return wbs.Item(index)
  } catch {
    return null
  }
}

/**
 * 扫描所有已打开工作簿，返回命中指定检测目标的工作簿列表。
 * 排序偏好（参考 findBangumiTargetSheets）：当前活动工作簿优先，其余按扫描顺序。
 */
export function scanDetectedWorkbooks(detector: WorkbookDetector): WpsWorkbook[] {
  const app = getApp()
  if (!app?.Workbooks) {
    bgmLog(LOG_LEVELS.WARN, '[enrichAutoDetect] 无法获取 Workbooks')
    return []
  }

  const activeWbName = app.ActiveWorkbook?.Name ?? ''
  const found: WpsWorkbook[] = []
  const wbs = app.Workbooks
  for (let index = 1; index <= wbs.Count; index += 1) {
    const wb = readWorkbookSafely(wbs, index)
    if (wb && isDetectedWorkbook(detector, wb)) found.push(wb)
  }

  found.sort((a, b) => {
    const aActive = a.Name === activeWbName ? 0 : 1
    const bActive = b.Name === activeWbName ? 0 : 1
    return aActive - bActive
  })
  return found
}

// ========== 持久化（Ribbon ↔ 富化页面跨 WebView 共享） ==========

/** 读取指定检测目标的自动识别记录（可能包含已关闭的工作簿，调用方需二次校验） */
export function loadDetectedWorkbooks(detector: WorkbookDetector): string[] {
  const app = getApp()
  const raw = app?.PluginStorage?.getItem(detector.key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

/** 持久化指定检测目标的自动识别结果（去重） */
export function persistDetectedWorkbooks(
  detector: WorkbookDetector,
  paths: readonly string[],
): void {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[enrichAutoDetect] PluginStorage 不可用，无法持久化')
    return
  }
  app.PluginStorage.setItem(detector.key, JSON.stringify([...new Set(paths)]))
}

/** 判断持久化路径对应的工作簿当前是否仍在 WPS 中打开（仅做名称比对，不读单元格） */
export function isWorkbookOpen(path: string): boolean {
  const app = getApp()
  if (!app?.Workbooks) return false
  const fileName = extractFileNameFromPath(path)
  const wbs = app.Workbooks
  for (let index = 1; index <= wbs.Count; index += 1) {
    const wb = readWorkbookSafely(wbs, index)
    if (wb && (wb.FullName === path || wb.Name === fileName)) return true
  }
  return false
}

/** 将路径加入结果集（已存在则跳过） */
function appendIfNotSeen(result: string[], seen: Set<string>, path: string): void {
  if (seen.has(path)) return
  seen.add(path)
  result.push(path)
}

/**
 * 合并自动识别候选（纯函数，可单测）：
 * 1. 实时扫描结果优先（已验证、活动工作簿靠前）；
 * 2. 持久化记录中「仍打开」且未被实时扫描覆盖的作为兜底（应对实时校验瞬时失败）。
 */
export function mergeDetectCandidates(
  persisted: readonly string[],
  openPaths: readonly string[],
  isStillOpen: (path: string) => boolean,
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const path of openPaths) {
    appendIfNotSeen(result, seen, path)
  }
  for (const path of persisted) {
    if (isStillOpen(path)) appendIfNotSeen(result, seen, path)
  }
  return result
}

/** 汇总指定检测目标当前应自动添加的工作簿路径（持久化结果 ∩ 仍打开 ∪ 实时扫描） */
export function collectDetectedWorkbookPaths(detector: WorkbookDetector): string[] {
  const openPaths = scanDetectedWorkbooks(detector).map((wb) => wb.FullName)
  const persisted = loadDetectedWorkbooks(detector)
  return mergeDetectCandidates(persisted, openPaths, isWorkbookOpen)
}

// ========== WPS 启动检查（检查方式 A + 事件时机 C/D/E） ==========

let isEventsRegistered = false

/** 记录单个工作簿到指定检测目标的持久化列表（已存在则跳过） */
function recordWorkbookIfNew(detector: WorkbookDetector, wb: WpsWorkbook): void {
  const current = loadDetectedWorkbooks(detector)
  if (!current.includes(wb.FullName)) {
    persistDetectedWorkbooks(detector, [...current, wb.FullName])
    bgmLog(LOG_LEVELS.INFO, `[enrichAutoDetect] ${detector.label} 已记录工作簿: ${wb.Name}`)
  }
}

/** 对单个检测器执行名称预筛 + 完整校验，命中则记录；返回是否命中 */
function shouldRecordForDetector(detector: WorkbookDetector, wb: WpsWorkbook): boolean {
  if (detector.isNameMatch && !detector.isNameMatch(wb)) return false
  try {
    if (!detector.findDetectedSheet(wb)) return false
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrichAutoDetect] ${detector.label} 校验失败: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
  recordWorkbookIfNew(detector, wb)
  return true
}

/** 对全部检测器依次尝试记录（事件回调统一入口） */
function recordWorkbookForDetectors(wb: WpsWorkbook): void {
  for (const detector of ALL_DETECTORS) {
    shouldRecordForDetector(detector, wb)
  }
}

/** 重新扫描并覆盖全部检测器的持久化记录（WPS 启动时全量刷新） */
function refreshAllPersistedScans(): void {
  for (const detector of ALL_DETECTORS) {
    const paths = scanDetectedWorkbooks(detector).map((wb) => wb.FullName)
    persistDetectedWorkbooks(detector, paths)
    bgmLog(
      LOG_LEVELS.INFO,
      `[enrichAutoDetect] WPS 启动检查：${detector.label} 识别到 ${String(paths.length)} 个工作簿`,
    )
  }
}

/**
 * 初始化自动识别（打开 WPS 时调用，幂等）：
 * 1. 立即扫描已打开工作簿并持久化；
 * 2. 注册 WorkbookOpen / WorkbookActivate / SheetActivate 事件，实时维护识别记录。
 *    事件注册失败不影响功能：富化页面打开时仍会做实时扫描检查。
 */
export function initWorkbookAutoDetect(): void {
  refreshAllPersistedScans()
  if (isEventsRegistered) return
  isEventsRegistered = true

  const app = getApp() as {
    WorkbookOpen?: (wb: WpsWorkbook) => void
    WorkbookActivate?: (wb: WpsWorkbook) => void
    SheetActivate?: (ws: WpsWorksheet) => void
  } | null
  if (!app) return

  try {
    app.WorkbookOpen = (wb: WpsWorkbook) => {
      try {
        recordWorkbookForDetectors(wb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[enrichAutoDetect] WorkbookOpen 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrichAutoDetect] 注册 WorkbookOpen 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    // 激活/切换事件触发频繁：先做低成本名称预筛，命中才完整校验，避免频繁读单元格
    app.WorkbookActivate = (wb: WpsWorkbook) => {
      try {
        recordWorkbookForDetectors(wb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[enrichAutoDetect] WorkbookActivate 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrichAutoDetect] 注册 WorkbookActivate 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    // 切换活动工作表时以当前活动工作簿为目标做检测
    app.SheetActivate = () => {
      try {
        const activeWb = getApp()?.ActiveWorkbook
        if (activeWb) recordWorkbookForDetectors(activeWb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[enrichAutoDetect] SheetActivate 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrichAutoDetect] 注册 SheetActivate 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * @fileoverview 已打开工作簿的自动识别模块
 * @module sync/workbookAutoDetect
 * @description 在 WPS 当前已打开的工作簿中自动识别「新番表源工作簿」与「Bangumi 目标工作簿」。
 *
 * 识别方式参考 Bangumi 同步工具（tools/locked-sheet.ts findBangumiTargetSheets）：
 *   1. 低成本名称预筛：文件名 / 工作表名包含目标关键词；
 *   2. 表头校验：命中 ≥3 个目标表头关键字；
 *   3. 数据行校验：表头行后 ≥2 行有数据。
 *
 * 检查时机（多种，注册后统一生效）：
 *   A. 打开 WPS（加载项加载）时：initWorkbookAutoDetection 全量扫描 + 事件监听，结果持久化到 PluginStorage；
 *   B. 打开富化工具页面时：collectDetectedWorkbookPaths 合并持久化结果与实时扫描，由页面自动添加并识别；
 *   C. 打开新工作簿时：WorkbookOpen 事件实时记录；
 *   D. 切换活动工作簿时：WorkbookActivate 事件实时记录；
 *   E. 切换活动工作表时：SheetActivate 事件实时记录。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { detectAnimeSourceLayout } from './enrich-engine.js'
import { bgmLog, getApp } from '../tools/util/index.js'
import {
  countDataRowsAfter,
  findBangumiTargetSheetInWorkbook,
  getOpenWorkbooks,
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
  findFirstMatchingSheet: (wb: WpsWorkbook) => WpsWorksheet | null
}

/** 新番表文件名预筛关键词（低成本，命中后再做表头/数据行校验） */
export const ANIME_SOURCE_FILENAME_KEYWORDS = ['新番', '番组', 'xinfan'] as const

/** 文件名是否命中新番表关键词（纯函数，可单测） */
export function isAnimeSourceFilename(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return ANIME_SOURCE_FILENAME_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

/** 从文件路径提取文件名（纯函数，可单测） */
export function extractFileNameFromPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath
}

/**
 * 从工作簿名提取「yy年m月」月度标签（纯函数，可单测）。
 * 例：「2026年4月新番表 v2.13.xlsx」→「26年4月」；无月份时返回去扩展名的文件名。
 */
export function monthLabelFromWorkbookName(name: string): string {
  const match = /(\d{2,4})年(\d{1,2})月/.exec(name)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const year = match[1].length === 4 ? match[1].slice(-2) : match[1]
    return `${year}年${String(Number(match[2]))}月`
  }
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.substring(0, dot) : name
}

/** 读取并校验单个工作表是否为新番表布局（表头 ≥3 关键字 + ≥2 数据行）；不满足返回 null */
function inspectAnimeSourceWorksheet(wb: WpsWorkbook, index: number): WpsWorksheet | null {
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
export function findAnimeSourceSheetInWorkbook(wb: WpsWorkbook): WpsWorksheet | null {
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    const ws = inspectAnimeSourceWorksheet(wb, index)
    if (ws) return ws
  }
  return null
}

/** 新番表检测器：文件名关键词预筛 + 表头/数据行校验 */
export const ANIME_SOURCE_DETECTOR: WorkbookDetector = {
  key: 'bgm_enrich_auto_detect',
  label: '新番表',
  isNameMatch: (wb: WpsWorkbook) => isAnimeSourceFilename(wb.Name),
  findFirstMatchingSheet: findAnimeSourceSheetInWorkbook,
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
  findFirstMatchingSheet: findBangumiTargetSheetInWorkbook,
}

/** 全部已注册检测器（事件与全量扫描统一遍历） */
export const ALL_DETECTORS: readonly WorkbookDetector[] = [
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
]

// ========== 工作簿判定与扫描 ==========

/** 安全执行目标表校验（校验异常按未命中处理，供扫描循环跳过异常项） */
function findFirstMatchingSheetSafely(
  detector: WorkbookDetector,
  wb: WpsWorkbook,
): WpsWorksheet | null {
  try {
    return detector.findFirstMatchingSheet(wb)
  } catch {
    return null
  }
}

/**
 * 判断工作簿是否命中检测目标：名称预筛 + 表头/数据行双重校验。
 * 仅命中名称不算数，必须同时存在可识别的目标表布局，避免误判普通表格。
 */
export function isMatchingWorkbook(detector: WorkbookDetector, wb: WpsWorkbook): boolean {
  if (detector.isNameMatch && !detector.isNameMatch(wb)) return false
  return findFirstMatchingSheetSafely(detector, wb) !== null
}

/**
 * 扫描所有已打开工作簿，返回命中指定检测目标的工作簿列表。
 *
 * 边界处理：部分 WPS 环境下 `Application.Workbooks` 集合可能与当前活动工作簿不一致
 * （活动工作簿未出现在枚举结果中），因此额外把 ActiveWorkbook 作为兜底候选纳入扫描，
 * 避免「已打开目标工作簿却扫描不到」。
 *
 * 排序偏好（参考 findBangumiTargetSheets）：当前活动工作簿优先，其余按扫描顺序。
 */
export function scanMatchingWorkbooks(detector: WorkbookDetector): WpsWorkbook[] {
  const app = getApp()
  if (!app) {
    bgmLog(LOG_LEVELS.WARN, '[workbookDetect] 无法获取 Application')
    return []
  }

  let activeWbName = ''
  try {
    activeWbName = app.ActiveWorkbook?.Name ?? ''
  } catch {
    // 活动窗口切换中时不启用活动工作簿排序偏好
  }
  const found: WpsWorkbook[] = []
  const seen = new Set<string>()
  const workbooks = getOpenWorkbooks()

  for (const wb of workbooks) {
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    if (name && !seen.has(name)) {
      const isMatch = (() => {
        try {
          return isMatchingWorkbook(detector, wb)
        } catch {
          return false
        }
      })()
      if (isMatch) {
        seen.add(name)
        found.push(wb)
      }
    }
  }

  found.sort((a, b) => {
    const aActive = a.Name === activeWbName ? 0 : 1
    const bActive = b.Name === activeWbName ? 0 : 1
    return aActive - bActive
  })
  return found
}

/** 描述当前 WPS 中已打开的工作簿（诊断日志用，读取失败不影响主流程） */
export function describeOpenWorkbooks(): string {
  const app = getApp()
  if (!app) return 'Application 不可用'
  if (!app.Workbooks) return 'Workbooks 不可用'
  const workbooks = getOpenWorkbooks()
  const rawWorkbookCount = (() => {
    try {
      return app.Workbooks.Count
    } catch {
      return 0
    }
  })()
  const windowCount = (() => {
    try {
      return app.Windows?.Count ?? 0
    } catch {
      return 0
    }
  })()
  let activeName = '(无)'
  try {
    activeName = app.ActiveWorkbook?.Name ?? '(无)'
  } catch {
    // 读取活动工作簿失败时保留占位
  }
  return `${String(workbooks.length)} 个 [${workbooks.map((wb) => wb.Name).join(' | ')}]；Workbooks.Count=${String(rawWorkbookCount)}；Windows.Count=${String(windowCount)}；活动工作簿 ${activeName}`
}

// ========== 持久化（Ribbon ↔ 富化页面跨 WebView 共享） ==========

/** 读取指定检测目标的自动识别记录（可能包含已关闭的工作簿，调用方需二次校验） */
export function loadDetectedPaths(detector: WorkbookDetector): string[] {
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
export function persistDetectedPaths(detector: WorkbookDetector, paths: readonly string[]): void {
  const app = getApp()
  if (!app?.PluginStorage) {
    bgmLog(LOG_LEVELS.WARN, '[workbookDetect] PluginStorage 不可用，无法持久化')
    return
  }
  app.PluginStorage.setItem(detector.key, JSON.stringify([...new Set(paths)]))
}

/** 判断持久化路径对应的工作簿当前是否仍在 WPS 中打开（仅做名称比对，不读单元格） */
export function isWorkbookOpen(path: string): boolean {
  const fileName = extractFileNameFromPath(path).trim().toLowerCase()
  const normalizedPath = path.trim().toLowerCase()
  for (const wb of getOpenWorkbooks()) {
    try {
      if (wb.FullName.trim().toLowerCase() === normalizedPath) return true
      if (wb.Name.trim().toLowerCase() === fileName) return true
    } catch {
      // 工作簿正在切换/关闭，跳过当前项
    }
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
export function mergeCandidatePaths(
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
  const openPaths = scanMatchingWorkbooks(detector).map((wb) => wb.FullName)
  const persisted = loadDetectedPaths(detector)
  return mergeCandidatePaths(persisted, openPaths, isWorkbookOpen)
}

/**
 * 把当前实时扫描结果**并入**持久化记录（仅追加/去重，不清空历史记录）。
 *
 * 与 overwriteDetectedPathsInStorage 的区别：后者在 WPS 启动时全量覆盖，适用于「以当前事实为准」；
 * 本函数适用于页面打开等中途场景 —— 若此时 Workbooks 集合尚未就绪（例如只枚举到部分工作簿），
 * 覆盖写会把已经识别到的目标工作簿记录抹掉，导致后续页面更扫不到。
 */
export function mergeDetectedPathsIntoStorage(): void {
  for (const detector of ALL_DETECTORS) {
    const openPaths = scanMatchingWorkbooks(detector).map((wb) => wb.FullName)
    const persisted = loadDetectedPaths(detector)
    const merged = mergeCandidatePaths(persisted, openPaths, isWorkbookOpen)
    persistDetectedPaths(detector, merged)
    bgmLog(
      LOG_LEVELS.INFO,
      `[workbookDetect] ${detector.label} 合并识别记录：${String(merged.length)} 个`,
    )
  }
}

// ========== WPS 启动检查（检查方式 A + 事件时机 C/D/E） ==========

let isEventsRegistered = false

/** 记录单个工作簿到指定检测目标的持久化列表（已存在则跳过） */
function recordWorkbookPathIfNew(detector: WorkbookDetector, wb: WpsWorkbook): void {
  const current = loadDetectedPaths(detector)
  if (!current.includes(wb.FullName)) {
    persistDetectedPaths(detector, [...current, wb.FullName])
    bgmLog(LOG_LEVELS.INFO, `[workbookDetect] ${detector.label} 已记录工作簿: ${wb.Name}`)
  }
}

/** 对单个检测器执行名称预筛 + 完整校验，命中则记入持久化列表；未命中静默跳过 */
function recordWorkbookIfMatched(detector: WorkbookDetector, wb: WpsWorkbook): void {
  if (detector.isNameMatch && !detector.isNameMatch(wb)) return
  try {
    if (!detector.findFirstMatchingSheet(wb)) return
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[workbookDetect] ${detector.label} 校验失败: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }
  recordWorkbookPathIfNew(detector, wb)
}

/** 对全部检测器依次尝试记录（事件回调统一入口） */
function recordWorkbookForAllDetectors(wb: WpsWorkbook): void {
  for (const detector of ALL_DETECTORS) {
    recordWorkbookIfMatched(detector, wb)
  }
}

/** 重新扫描并覆盖全部检测器的持久化记录（WPS 启动时全量刷新） */
function overwriteDetectedPathsInStorage(): void {
  for (const detector of ALL_DETECTORS) {
    const paths = scanMatchingWorkbooks(detector).map((wb) => wb.FullName)
    persistDetectedPaths(detector, paths)
    bgmLog(
      LOG_LEVELS.INFO,
      `[workbookDetect] WPS 启动检查：${detector.label} 识别到 ${String(paths.length)} 个工作簿`,
    )
  }
}

/**
 * 初始化自动识别（打开 WPS 时调用，幂等）：
 * 1. 立即扫描已打开工作簿并持久化；
 * 2. 注册 WorkbookOpen / WorkbookActivate / SheetActivate 事件，实时维护识别记录。
 *    事件注册失败不影响功能：富化页面打开时仍会做实时扫描检查。
 */
export function initWorkbookAutoDetection(): void {
  overwriteDetectedPathsInStorage()
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
        recordWorkbookForAllDetectors(wb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[workbookDetect] WorkbookOpen 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[workbookDetect] 注册 WorkbookOpen 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    // 激活/切换事件触发频繁：先做低成本名称预筛，命中才完整校验，避免频繁读单元格
    app.WorkbookActivate = (wb: WpsWorkbook) => {
      try {
        recordWorkbookForAllDetectors(wb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[workbookDetect] WorkbookActivate 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[workbookDetect] 注册 WorkbookActivate 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    // 切换活动工作表时以当前活动工作簿为目标做检测
    app.SheetActivate = () => {
      try {
        const activeWb = getApp()?.ActiveWorkbook
        if (activeWb) recordWorkbookForAllDetectors(activeWb)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[workbookDetect] SheetActivate 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[workbookDetect] 注册 SheetActivate 失败（事件不可用，页面打开时检查不受影响）: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

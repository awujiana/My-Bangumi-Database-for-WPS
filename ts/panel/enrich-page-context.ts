/**
 * @fileoverview 富化页共享上下文：页面状态单例 + DOM 取元素工具
 * @module panel/enrich-page-context
 * @description
 *   从 `enrich-page.ts` 抽出的**被所有富化子流程共享**的部分：
 *   `EnrichPageState` 的形状与其单例 `state`、批量结果类型、以及四个
 *   `safeGet*` 取值工具。抽出来的目的是让「文件选择 / 匹配预览 / 冲突对话框 /
 *   批量富化」等流程块能被切到独立模块而不必各自复制一份状态。
 *
 *   这里**只放数据与取元素**，不放流程逻辑，也不反向 import `enrich-page.ts`
 *   （会成环）。
 */

import type { IntroSheetContext } from '../sync/enrich-intro.js'
import type { EnrichColumnMapping } from '../sync/enrich-layout.js'
import type { ConflictInfo, MatchResult } from '../sync/enrich-types.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'
import type { EnrichDetailGroup } from './enrich-detail-render.js'

// ========== 类型定义 ==========

export interface BatchFileResult {
  filePath: string
  fileName: string
  /** 识别到的表头行；0 表示未识别成功 */
  headerRow: number
  matched: number
  addedEntries: number
  updatedEntries: number
  unmatched: number
  success: boolean
  error?: string
}

export interface EnrichPageState {
  filePath: string
  animeSourceSheet: WpsWorksheet | null
  bangumiSheet: WpsWorksheet | null
  columnMapping: EnrichColumnMapping | null
  headerRow: number
  dataStartRow: number
  matches: MatchResult[]
  /** 「数据预览」当前页签：source=新番表数据，match=匹配结果 */
  activePreviewTab: 'source' | 'match'
  /** 源数据预览是否已成功渲染（决定「查看详细数据表格」按钮是否可用） */
  hasSourcePreview: boolean
  isEnriching: boolean
  cancelRequested: boolean
  pendingConflicts: ConflictInfo[]
  currentConflictIndex: number

  // 批量字段
  batchFiles: string[]
  batchResults: BatchFileResult[]
  batchIndex: number
  isBatchEnriching: boolean
  batchCancelRequested: boolean

  // 详情弹窗数据（最近一次富化各文件的条目明细，单文件为 1 组）
  enrichDetailGroups: EnrichDetailGroup[]

  // 单文件自动识别表头时打开的源工作簿（重新选择文件/清空列表时安全回收）
  sourceWorkbook: WpsWorkbook | null
  isSourceWorkbookOpenedByUs: boolean

  // 关联的「新番简介」工作表上下文（按名称与主表关联，富化时补写导演/编剧等字段）
  introContext: IntroSheetContext | null

  // 可选开关：单文件识别成功后即关闭源工作簿，开始富化时自动重开
  closeSourceAfterDetect: boolean
}

// ========== 状态 ==========

export const state: EnrichPageState = {
  filePath: '',
  animeSourceSheet: null,
  bangumiSheet: null,
  columnMapping: null,
  headerRow: 0,
  dataStartRow: 0,
  matches: [],
  activePreviewTab: 'source',
  hasSourcePreview: false,
  isEnriching: false,
  cancelRequested: false,
  pendingConflicts: [],
  currentConflictIndex: 0,

  batchFiles: [],
  batchResults: [],
  batchIndex: 0,
  isBatchEnriching: false,
  batchCancelRequested: false,

  enrichDetailGroups: [],

  sourceWorkbook: null,
  isSourceWorkbookOpenedByUs: false,

  introContext: null,

  closeSourceAfterDetect: false,
}

// ========== 工具函数 ==========

export function safeGetElement(id: string): HTMLElement | null {
  return document.getElementById(id)
}

export function safeGetButton(id: string): HTMLButtonElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLButtonElement ? element : null
}

export function safeGetSelect(id: string): HTMLSelectElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLSelectElement ? element : null
}

export function safeGetCheckbox(id: string): HTMLInputElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLInputElement ? element : null
}

/**
 * @fileoverview Undo/Redo 栈，记录单元格变更以支持撤销操作
 * @module sync/undoStack
 */

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog, getDataSheet, setCellValue } from '../tools/util.js'
import type { WpsWorksheet } from '../tools/wps.js'

/** 被删除行的完整快照 */
export interface RowSnapshot {
  /** 删除时的行号 */
  row: number
  /** 列号 → 单元格值的映射 */
  values: Record<number, string>
}

/** 单次变更记录类型 */
export type UndoEntry =
  | {
      type: 'cell'
      row: number
      col: number
      oldValue: string
      newValue: string
    }
  | {
      type: 'row-delete'
      rowSnapshot: RowSnapshot
    }

/** 一次同步操作的所有变更 */
export interface UndoSession {
  /** 会话开始时间戳 */
  timestamp: number
  /** 同步策略描述 */
  description: string
  /** 该会话的所有变更（按执行顺序） */
  entries: UndoEntry[]
}

/** Undo 会话栈保留上限（最近 N 次同步） */
const MAX_SESSIONS = 20

/** Undo 会话栈 */
const sessions: UndoSession[] = []

/** 当前正在进行的会话（null 表示无活动会话） */
let currentSession: UndoSession | null = null

/**
 * 开始一个新的 undo 会话
 * @param description 会话描述（如 "GitHub 同步 add-update 策略"）
 */
export function beginUndoSession(description: string): void {
  currentSession = {
    timestamp: Date.now(),
    description,
    entries: [],
  }
}

/**
 * 记录一次单元格变更到当前会话
 * @param entry 变更记录
 */
export function recordUndoEntry(entry: Omit<Extract<UndoEntry, { type: 'cell' }>, 'type'>): void {
  if (!currentSession) return
  currentSession.entries.push({ ...entry, type: 'cell' })
}

/**
 * 记录一次整行删除到当前会话
 * @param rowSnapshot 被删除行的完整快照
 */
export function recordRowDeleteEntry(rowSnapshot: RowSnapshot): void {
  if (!currentSession) return
  currentSession.entries.push({ type: 'row-delete', rowSnapshot })
}

/**
 * 结束当前会话并压入栈。空会话不入栈。
 */
export function endUndoSession(): void {
  if (!currentSession) return
  if (currentSession.entries.length > 0) {
    sessions.push(currentSession)
    if (sessions.length > MAX_SESSIONS) {
      sessions.shift()
    }
  }
  currentSession = null
}

/**
 * 撤销最近一次同步操作
 *
 * 恢复顺序：
 * 1. 先逆序恢复所有单元格变更；
 * 2. 再按行号从大到小恢复被删除的行（避免先行插入导致后续行号偏移）。
 *
 * 性能优化：缓存工作表引用，避免每次恢复都调用 getDataSheet()（COM 跨进程调用 + 日志输出）。
 *
 * @returns 恢复的条目数，若无可撤销会话返回 0
 */
export function undoLastSync(): number {
  const session = sessions.pop()
  if (!session) return 0

  const cellEntries: Extract<UndoEntry, { type: 'cell' }>[] = []
  const rowDeleteEntries: RowSnapshot[] = []

  for (const entry of session.entries) {
    if (entry.type === 'row-delete') {
      rowDeleteEntries.push(entry.rowSnapshot)
    } else {
      cellEntries.push(entry)
    }
  }

  // 缓存工作表引用，避免每次恢复都调用 getDataSheet()
  const ws: WpsWorksheet | null | undefined = getDataSheet()
  if (!ws) {
    bgmLog(LOG_LEVELS.WARN, '[undoLastSync] 无法获取数据工作表，撤销失败')
    return 0
  }

  // 1. 逆序恢复单元格变更（与执行顺序相反）
  for (let i = cellEntries.length - 1; i >= 0; i--) {
    const entry = cellEntries[i]
    if (entry) {
      setCellValue(ws, entry.row, entry.col, entry.oldValue)
    }
  }

  // 2. 按行号从大到小恢复被删除的行
  rowDeleteEntries.sort((a, b) => b.row - a.row)
  for (const snapshot of rowDeleteEntries) {
    restoreDeletedRowWithWs(ws, snapshot)
  }

  return session.entries.length
}

/**
 * 获取当前栈中的会话数
 */
export function getUndoSessionCount(): number {
  return sessions.length
}

/**
 * 获取最近一次会话描述（用于 UI 提示）
 */
export function getLastSessionDescription(): string | null {
  if (sessions.length === 0) return null
  return sessions[sessions.length - 1]?.description ?? null
}

/**
 * 清空所有 undo 会话
 */
export function clearUndoStack(): void {
  sessions.length = 0
  currentSession = null
}

// ========== 内部辅助：恢复单元格值 ==========

/**
 * 恢复被删除的整行（使用已缓存的工作表引用）
 * @param ws 数据工作表引用
 * @param snapshot 删除前保存的行快照
 */
function restoreDeletedRowWithWs(ws: WpsWorksheet, snapshot: RowSnapshot): void {
  try {
    // 在删除位置插入新行
    ws.Range(`${String(snapshot.row)}:${String(snapshot.row)}`).Insert()
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.WARN, `[undoStack] 插入行 ${String(snapshot.row)} 失败: ${errMsg}`)
    return
  }

  // 恢复该行所有列的值
  for (const [colStr, value] of Object.entries(snapshot.values)) {
    const col = parseInt(colStr, 10)
    if (Number.isNaN(col)) continue
    setCellValue(ws, snapshot.row, col, value)
  }
}

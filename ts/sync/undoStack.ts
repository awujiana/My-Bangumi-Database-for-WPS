/**
 * @fileoverview Undo/Redo 栈，记录单元格变更以支持撤销操作
 * @module sync/undoStack
 */

import { getDataSheet, setCellValue } from '../tools/util.js'
import type { WpsWorksheet } from '../tools/wps.js'

/** 单次单元格变更记录 */
export interface UndoEntry {
  row: number
  col: number
  oldValue: string
  newValue: string
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
export function recordUndoEntry(entry: UndoEntry): void {
  if (!currentSession) return
  currentSession.entries.push(entry)
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
 * 撤销最近一次同步操作（按执行逆序恢复单元格值）
 * @returns 恢复的条目数，若无可撤销会话返回 0
 */
export function undoLastSync(): number {
  const session = sessions.pop()
  if (!session) return 0
  // 逆序恢复（与执行顺序相反）
  for (let i = session.entries.length - 1; i >= 0; i--) {
    const entry = session.entries[i]
    if (entry) {
      restoreCellValue(entry.row, entry.col, entry.oldValue)
    }
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
 * 将指定单元格恢复为 oldValue
 * @param row 行号
 * @param col 列号
 * @param value 要恢复的旧值
 */
function restoreCellValue(row: number, col: number, value: string): void {
  const ws: WpsWorksheet | null | undefined = getDataSheet()
  if (!ws) return
  setCellValue(ws, row, col, value)
}

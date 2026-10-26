/**
 * @fileoverview Undo/Redo 栈，记录单元格变更以支持撤销操作
 * @module sync/undoStack
 */
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog, getDataSheet, setCellValue } from '../tools/util/index.js';
/** Undo 会话栈保留上限（最近 N 次同步） */
const MAX_SESSIONS = 20;
/** Undo 会话栈（超限时重建为新数组丢弃最旧项；no-array-front-mutation 禁
    shift() 与 no-unnecessary-splice 禁 splice(0,1) 互斥，故用 slice 重建） */
let sessions = [];
/** 当前正在进行的会话（null 表示无活动会话） */
let currentSession = null;
/**
 * 开始一个新的 undo 会话
 * @param description 会话描述（如 "GitHub 同步 add-update 策略"）
 */
export function beginUndoSession(description) {
    currentSession = {
        timestamp: Date.now(),
        description,
        entries: [],
    };
}
/**
 * 记录一次单元格变更到当前会话
 * @param entry 变更记录
 */
export function recordUndoEntry(entry) {
    if (!currentSession)
        return;
    currentSession.entries.push({ ...entry, type: 'cell' });
}
/**
 * 记录一次整行删除到当前会话
 * @param rowSnapshot 被删除行的完整快照
 */
export function recordRowDeleteEntry(rowSnapshot) {
    if (!currentSession)
        return;
    currentSession.entries.push({ type: 'row-delete', rowSnapshot });
}
/**
 * 结束当前会话并压入栈。空会话不入栈。
 */
export function endUndoSession() {
    if (!currentSession)
        return;
    if (currentSession.entries.length > 0) {
        sessions.push(currentSession);
        if (sessions.length > MAX_SESSIONS) {
            sessions = sessions.slice(1);
        }
    }
    currentSession = null;
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
export function undoLastSync() {
    const session = sessions.pop();
    if (!session)
        return 0;
    const cellEntries = [];
    const rowDeleteEntries = [];
    for (const entry of session.entries) {
        if (entry.type === 'row-delete') {
            rowDeleteEntries.push(entry.rowSnapshot);
        }
        else {
            cellEntries.push(entry);
        }
    }
    // 缓存工作表引用，避免每次恢复都调用 getDataSheet()
    const worksheet = getDataSheet();
    if (!worksheet) {
        bgmLog(LOG_LEVELS.WARN, '[undoLastSync] 无法获取数据工作表，撤销失败');
        return 0;
    }
    // 1. 逆序恢复单元格变更（与执行顺序相反）
    for (let index = cellEntries.length - 1; index >= 0; index -= 1) {
        const entry = cellEntries[index];
        if (entry) {
            setCellValue(worksheet, entry.row, entry.column, entry.oldValue);
        }
    }
    // 2. 按行号从大到小恢复被删除的行
    rowDeleteEntries.sort((a, b) => b.row - a.row);
    for (const snapshot of rowDeleteEntries) {
        restoreDeletedRowWithWorksheet(worksheet, snapshot);
    }
    return session.entries.length;
}
/**
 * 获取当前栈中的会话数
 */
export function getUndoSessionCount() {
    return sessions.length;
}
/**
 * 获取最近一次会话描述（用于 UI 提示）
 */
export function getLastSessionDescription() {
    if (sessions.length === 0)
        return null;
    return sessions.at(-1)?.description ?? null;
}
/**
 * 清空所有 undo 会话
 */
export function clearUndoStack() {
    sessions.length = 0;
    currentSession = null;
}
// ========== 内部辅助：恢复单元格值 ==========
/**
 * 恢复被删除的整行（使用已缓存的工作表引用）
 * @param worksheet 数据工作表引用
 * @param snapshot 删除前保存的行快照
 */
function restoreDeletedRowWithWorksheet(worksheet, snapshot) {
    try {
        // 在删除位置插入新行
        worksheet.Range(`${String(snapshot.row)}:${String(snapshot.row)}`).Insert();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[undoStack] 插入行 ${String(snapshot.row)} 失败: ${errorMessage}`);
        return;
    }
    // 恢复该行所有列的值
    for (const [columnString, value] of Object.entries(snapshot.values)) {
        const column = Number(columnString);
        if (!Number.isNaN(column)) {
            setCellValue(worksheet, snapshot.row, column, value);
        }
    }
}

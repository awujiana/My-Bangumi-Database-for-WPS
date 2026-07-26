/**
 * @fileoverview Undo/Redo 栈，记录单元格变更以支持撤销操作
 * @module sync/undoStack
 */
/** 被删除行的完整快照 */
export interface RowSnapshot {
    /** 删除时的行号 */
    row: number;
    /** 列号 → 单元格值的映射 */
    values: Record<number, string>;
}
/** 单次变更记录类型 */
export type UndoEntry = {
    type: 'cell';
    row: number;
    col: number;
    oldValue: string;
    newValue: string;
} | {
    type: 'row-delete';
    rowSnapshot: RowSnapshot;
};
/** 一次同步操作的所有变更 */
export interface UndoSession {
    /** 会话开始时间戳 */
    timestamp: number;
    /** 同步策略描述 */
    description: string;
    /** 该会话的所有变更（按执行顺序） */
    entries: UndoEntry[];
}
/**
 * 开始一个新的 undo 会话
 * @param description 会话描述（如 "GitHub 同步 add-update 策略"）
 */
export declare function beginUndoSession(description: string): void;
/**
 * 记录一次单元格变更到当前会话
 * @param entry 变更记录
 */
export declare function recordUndoEntry(entry: Omit<Extract<UndoEntry, {
    type: 'cell';
}>, 'type'>): void;
/**
 * 记录一次整行删除到当前会话
 * @param rowSnapshot 被删除行的完整快照
 */
export declare function recordRowDeleteEntry(rowSnapshot: RowSnapshot): void;
/**
 * 结束当前会话并压入栈。空会话不入栈。
 */
export declare function endUndoSession(): void;
/**
 * 撤销最近一次同步操作
 *
 * 恢复顺序：
 * 1. 先逆序恢复所有单元格变更；
 * 2. 再按行号从大到小恢复被删除的行（避免先行插入导致后续行号偏移）。
 *
 * @returns 恢复的条目数，若无可撤销会话返回 0
 */
export declare function undoLastSync(): number;
/**
 * 获取当前栈中的会话数
 */
export declare function getUndoSessionCount(): number;
/**
 * 获取最近一次会话描述（用于 UI 提示）
 */
export declare function getLastSessionDescription(): string | null;
/**
 * 清空所有 undo 会话
 */
export declare function clearUndoStack(): void;
//# sourceMappingURL=undoStack.d.ts.map
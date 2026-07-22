/**
 * @fileoverview Undo/Redo 栈，记录单元格变更以支持撤销操作
 * @module sync/undoStack
 */
/** 单次单元格变更记录 */
export interface UndoEntry {
    row: number;
    col: number;
    oldValue: string;
    newValue: string;
}
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
export declare function recordUndoEntry(entry: UndoEntry): void;
/**
 * 结束当前会话并压入栈。空会话不入栈。
 */
export declare function endUndoSession(): void;
/**
 * 撤销最近一次同步操作（按执行逆序恢复单元格值）
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
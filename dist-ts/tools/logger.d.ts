/**
 * @fileoverview 日志模块 - 提供统一的日志记录和敏感信息脱敏
 * @module tools/logger
 * @description
 *   - 提供分级日志（INFO/WARN/ERROR/DEBUG）
 *   - 内置 RingBuffer 存储最近日志
 *   - 自动脱敏日志中的 Token 等敏感信息
 *   - 不污染全局 console，由调用方主动调用 logger 方法
 */
/** 日志级别 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
/** 日志条目 */
export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: number;
}
/** 获取最近日志 */
export declare function getRecentLogs(level?: LogLevel, limit?: number): LogEntry[];
/** 清空日志缓冲区 */
export declare function clearLogs(): void;
/** Token 脱敏：隐藏前缀，仅保留后 4 位，其余替换为 * */
export declare function maskToken(token: string): string;
/** 脱敏字符串中的 token（检测形如 token=xxx / token:xxx / Bearer xxx 的模式） */
export declare function maskSensitiveData(input: string): string;
/** 导出最近日志到文件（浏览器下载） */
export declare function exportLogsToFile(): void;
/** logger 对象 */
export declare const logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
};
//# sourceMappingURL=logger.d.ts.map
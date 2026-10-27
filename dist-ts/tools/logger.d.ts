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
/**
 * 脱敏字符串中的凭据（键值对形式 + `Bearer xxx` 形式）。
 *
 * 键名覆盖范围刻意放宽到常见凭据命名：token / secret / password / API key，
 * 以及带下划线或连字符的变体（access_token、refresh_token、client_secret、
 * API-key…）。键名列表**不包含 `authorization`** —— 该键的值通常是 `Bearer xxx`，
 * 若在此处先被掩码就会破坏按 `Bearer` 匹配的规则（先掩 `Bearer` 本身，真正的
 * 凭据反而漏出）。
 *
 * 正则写成字面量而非 `new RegExp(拼接串)`：既满足 security/detect-non-literal-regexp，
 * 也避免 `prefer-string-raw` 与反斜杠转义的来回。
 *
 * 这是日志的**最后一道防线**：调用方不应依赖它来避免泄漏，
 * 而是本身就不要把凭据写进日志（见 ts/tools/http.ts 的 Authorization 日志）。
 */
export declare function maskSensitiveData(input: string): string;
/**
 * 本模块**只负责记录**，不负责导出。
 *
 * 曾经这里有一个 `exportLogsToFile()`（`bgm-logs-<毫秒>.txt`、ISO UTC 时间戳、无表头），
 * 与「设置页 / 日志弹窗」走的 `ui/handlers/data-export.ts`（`bgm-系统日志-<时间戳>.txt`、
 * 本地时间、带表头、CSV 带 BOM）是**两套产物** —— 同一个功能两个入口，格式还不一样。
 * 已删除，统一由 `exportData('systemLogs', 'txt')` 出口。
 */
/** logger 对象 */
export declare const logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
};
//# sourceMappingURL=logger.d.ts.map
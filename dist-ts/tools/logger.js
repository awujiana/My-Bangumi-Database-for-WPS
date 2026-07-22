/**
 * @fileoverview 日志模块 - 提供统一的日志记录和敏感信息脱敏
 * @module tools/logger
 * @description
 *   - 提供分级日志（INFO/WARN/ERROR/DEBUG）
 *   - 内置 RingBuffer 存储最近日志
 *   - 自动脱敏日志中的 Token 等敏感信息
 *   - 不污染全局 console，由调用方主动调用 logger 方法
 */
import { RingBuffer } from './logBuffer.js';
const LOG_BUFFER_CAPACITY = 1000;
const logBuffer = new RingBuffer(LOG_BUFFER_CAPACITY);
/** 写入日志到环形缓冲区 */
function pushLog(entry) {
    logBuffer.push(entry);
}
/** 获取最近日志 */
export function getRecentLogs(level, limit = 100) {
    const all = logBuffer.toArray();
    const filtered = level ? all.filter((e) => e.level === level) : all;
    return filtered.slice(-limit);
}
/** 清空日志缓冲区 */
export function clearLogs() {
    logBuffer.clear();
}
/** Token 脱敏：保留前 4 后 4，中间替换为 * */
export function maskToken(token) {
    if (token.length <= 8)
        return '*'.repeat(token.length);
    return token.slice(0, 4) + '*'.repeat(Math.min(token.length - 8, 20)) + token.slice(-4);
}
/** 脱敏字符串中的 token（检测形如 token=xxx / token:xxx / Bearer xxx 的模式） */
export function maskSensitiveData(input) {
    return input
        .replace(/(token[=:]?\s*)([a-zA-Z0-9]{8,})/gi, (_m, p1, p2) => p1 + maskToken(p2))
        .replace(/(Bearer\s+)([a-zA-Z0-9]{8,})/gi, (_m, p1, p2) => p1 + maskToken(p2));
}
/** 导出最近日志到文件（浏览器下载） */
export function exportLogsToFile() {
    const logs = getRecentLogs(undefined, 1000);
    const text = logs
        .map((e) => `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.message}`)
        .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bgm-logs-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
/** logger 对象 */
export const logger = {
    info(message) {
        const entry = {
            level: 'INFO',
            message: maskSensitiveData(message),
            timestamp: Date.now(),
        };
        pushLog(entry);
        // eslint-disable-next-line no-console -- logger 模块是 console 输出的唯一入口
        console.log(`[INFO] ${entry.message}`);
    },
    warn(message) {
        const entry = {
            level: 'WARN',
            message: maskSensitiveData(message),
            timestamp: Date.now(),
        };
        pushLog(entry);
        console.warn(`[WARN] ${entry.message}`);
    },
    error(message) {
        const entry = {
            level: 'ERROR',
            message: maskSensitiveData(message),
            timestamp: Date.now(),
        };
        pushLog(entry);
        console.error(`[ERROR] ${entry.message}`);
    },
    debug(message) {
        const entry = {
            level: 'DEBUG',
            message: maskSensitiveData(message),
            timestamp: Date.now(),
        };
        pushLog(entry);
        // WPS 环境无 process.env.NODE_ENV，总是输出 debug 日志到控制台
        // 上层 bgmLog 会基于 BGM.LOG_LEVEL 进行过滤，避免生产噪音
        // eslint-disable-next-line no-console -- logger 模块是 console 输出的唯一入口
        console.debug(`[DEBUG] ${entry.message}`);
    },
};

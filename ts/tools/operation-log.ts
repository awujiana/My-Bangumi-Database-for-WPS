/**
 * @fileoverview 分作用域的操作日志存储
 * @module tools/operation-log
 * @description
 *   给「面板自身的操作日志」一个**可读回的结构化存储**，供日志导出使用。
 *
 *   **为什么需要它**：清理页原本把日志直接 `appendChild` 进 DOM，没有 JS 侧数据。
 *   要导出就只能去解析 DOM 文本（脆弱、丢信息），或者从全局环形缓冲里按
 *   `[cleanPage]` 前缀捞（容量 1000 且与其它模块共享，长会话会互相挤掉）。
 *
 *   **为什么放在 tools 层**：清理页（`ts/panel/`）要**写**，设置页的导出入口
 *   （`ts/ui/`）要**读**，而分层规则禁止底层反向依赖上层 —— 放在 tools 层
 *   两侧都能直接 import，不会引入环。
 *
 *   **为什么不复用 logger 的 RingBuffer**：那是全局共享的调试日志，语义不同
 *   （排查用 vs 用户可见的操作结果），容量与生命周期也不同，混在一起会让
 *   「导出清理日志」导出到一堆无关的系统日志。
 */

/** 操作日志级别（比系统日志多一个 `ok`，用于「成功」这类正向结果） */
export type OperationLogLevel = 'info' | 'ok' | 'warn' | 'error'

/** 一条操作日志 */
export interface OperationLogEntry {
  /** 毫秒时间戳 */
  timestamp: number
  level: OperationLogLevel
  message: string
}

/**
 * 每个作用域的容量上限。
 *
 * 只增不减会让长会话无限增长；但清理日志的量级很小（一次扫描几十到几百条），
 * 2000 条足够覆盖「一次完整清理 + 若干次重扫」，超了丢最旧的即可。
 */
const MAX_ENTRIES_PER_SCOPE = 2000

const stores = new Map<string, OperationLogEntry[]>()

/**
 * 清理页日志的作用域键。
 *
 * 放在这里是为了让「写的一方」（`ts/panel/clean-page.ts`）与「读的一方」
 * （`ts/ui/handlers/data-export.ts`）共用同一个常量 —— 两处若各写字符串，
 * 一旦改一处就会「导出为空」且**没有任何报错**，属于最难查的静默失效。
 */
export const CLEAN_LOG_SCOPE = 'clean'

/**
 * 追加一条操作日志。
 *
 * 刻意**不接 `bgmLog`** —— 写全局系统日志是调用方的事（清理页已经在做），
 * 这里只负责存，避免调用一次产生两条日志。
 */
export function appendOperationLog(
  scope: string,
  message: string,
  level: OperationLogLevel = 'info',
): void {
  const entries = stores.get(scope) ?? []
  entries.push({ timestamp: Date.now(), level, message })
  if (entries.length > MAX_ENTRIES_PER_SCOPE) {
    entries.splice(0, entries.length - MAX_ENTRIES_PER_SCOPE)
  }
  stores.set(scope, entries)
}

/** 取某个作用域的全部日志（副本，外部改动不影响内部） */
export function getOperationLogs(scope: string): OperationLogEntry[] {
  return (stores.get(scope) ?? []).map((entry) => ({ ...entry }))
}

/** 清空某个作用域的日志 */
export function clearOperationLogs(scope: string): void {
  stores.delete(scope)
}

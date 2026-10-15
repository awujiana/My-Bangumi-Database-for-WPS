/**
 * @fileoverview GitHub 同步的日期 / 时长格式化纯函数
 * @module sync/githubTimeFormat
 * @description 从 `github-sync.ts` 抽出的零副作用纯逻辑：日期字符串本地化、值追加合并、
 *              时长 / ETA 格式化、时间筛选标签。除 `trim` 外无任何 WPS / DOM 依赖，
 *              可在 Node 测试环境直接运行（P1-G 上帝模块拆分 + P1-H 测试安全网）。
 */

import { trim } from '../tools/string-utilities-pure.js'
import { formatDuration } from '../tools/util/duration.js'
import type { SyncTimeFilter } from './github-sync-diff.js'

/**
 * 日期列名集合（写入时转换为本地"年月日"字符串格式）
 */
export const DATE_COLUMNS = new Set(['开播日期', '完播日'])

/**
 * 将远程日期字符串（YYYY-MM-DD 等格式）转换为本地"年月日"格式字符串
 *
 * 本地 Excel 的"开播日期""完播日"列使用"YYYY年MM月DD日"格式的字符串，
 * 远程仓库使用 YYYY-MM-DD 格式，同步时需转换为本地格式写入。
 *
 * @param dateString 日期字符串，支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
 * @returns "年月日"格式字符串，如"2015年12月15日"，解析失败返回 null
 */
export function formatDateToLocal(dateString: string): string | null {
  if (!dateString) return null
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(dateString)
  if (!match) return null
  const year = match[1] ?? ''
  const month = (match[2] ?? '').padStart(2, '0')
  const day = (match[3] ?? '').padStart(2, '0')
  return `${year}年${month}月${day}日`
}

/**
 * 追加值到现有值后面，使用 ` | ` 分隔符
 *
 * 规则：
 * - 本地为空 → 直接返回新值
 * - 远程为空 → 返回本地值（不追加空值）
 * - 本地已包含新值 → 返回本地值（避免重复）
 * - 否则 → 返回 "本地 | 新值"
 *
 * @param localValue 本地现有值
 * @param remoteValue 远程新值
 * @returns 合并后的字符串
 */
export function appendValueWithSeparator(localValue: string, remoteValue: string): string {
  const local = trim(localValue)
  const remote = trim(remoteValue)
  if (!remote) return local
  if (!local) return remote
  if (local.includes(remote)) return local
  return `${local} | ${remote}`
}

/**
 * 格式化持续时间（毫秒 → 可读字符串）。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份）。此前这里与
 * `ui/components/progress.ts`、`ui/sync-result-dialog.ts` 各有一份且已漂移
 * （999ms 四舍五入成 `1.00秒`、整分补成 `1分00秒`），2026-10-15 统一为
 * progress 版的截断语义（`0.99秒` / `1分`）。
 */
export { formatDuration } from '../tools/util/duration.js'

/**
 * 格式化预估剩余时间
 */
export function formatEta(ms: number): string {
  if (ms <= 0) return '剩余: 计算中...'
  return `预计剩余: ${formatDuration(ms)}`
}

/**
 * 格式化时间筛选标签（year/quarter/month，future 归入 month 分支，与原有三元逻辑一致）
 */
export function formatTimeFilterLabel(timeFilter: SyncTimeFilter): string {
  if (timeFilter.range === 'year') {
    return `${String(timeFilter.year)}年`
  }
  if (timeFilter.range === 'quarter') {
    return `${String(timeFilter.year)}年${String(timeFilter.quarter ?? '')}月新番`
  }
  return `${String(timeFilter.year)}年${String(timeFilter.month ?? '')}月`
}

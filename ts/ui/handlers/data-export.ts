/**
 * @fileoverview 日志/记录导出源注册表
 * @module ui/handlers/data-export
 * @description
 *   三个工具（Bangumi 同步 / 新番表富化 / 数据清理）的日志与记录，统一在这里
 *   登记「表头 + 取数函数」，再交由 `tools/file-export` 输出 CSV 或 TXT。
 *
 *   为什么做成注册表而不是四处各写一个导出函数：
 *   导出入口有 **8 个**（4 个数据源 × 2 种格式），还要在「各页日志区」和
 *   「设置页集中入口」两处重复出现。散着写必然漏改，所以收敛成一个
 *   `data-action="exportData"` + `data-args='["<key>","<format>"]'`，
 *   新增数据源只需在 {@link EXPORT_SOURCES} 加一项。
 *
 *   本模块位于 UI 层，可依赖 tools / sync / panel 任意模块。
 */

import { LOG_LEVELS } from '../../core/constants.js'
import { exportRows } from '../../tools/file-export.js'
import type { ExportCell, ExportFormat } from '../../tools/file-export.js'
import { CLEAN_LOG_SCOPE, getOperationLogs } from '../../tools/operation-log.js'
import { getRecentLogs } from '../../tools/logger.js'
import { bgmLog } from '../../tools/util/index.js'
import { getAllEnrichRecords } from '../../sync/enrich-record.js'
import { getAllSyncRecords } from '../../sync/sync-record.js'
import { showToast } from '../dialog.js'

/** 一个可导出的数据源 */
export interface ExportSource {
  /** 唯一键，用于 `data-args` 与 {@link getExportSource} 查找 */
  key: string
  /** 中文名（设置页展示 + 文件名主体） */
  label: string
  /** CSV/TXT 表头 */
  headers: readonly string[]
  /** 取数（导出时才调用，避免启动时白读一次存储） */
  getRows: () => ExportCell[][]
}

/** 把毫秒时间戳格式化成 `YYYY-MM-DD HH:mm:ss`；非法输入返回空串 */
function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** 系统日志 / 操作日志共用的「时间 | 级别 | 消息」三列 */
const LOG_HEADERS = ['时间', '级别', '消息'] as const

export const EXPORT_SOURCES: readonly ExportSource[] = [
  {
    key: 'syncRecords',
    label: '同步记录',
    headers: ['时间', '名称', '类型', '收藏类型', '状态', '数量', 'SID', 'URL', '来源', '消息'],
    getRows: () =>
      getAllSyncRecords().map((record) => [
        record.time ?? '',
        record.name ?? '',
        record.type ?? '',
        record.collType ?? '',
        record.status ?? '',
        record.count ?? '',
        record.sid ?? '',
        record.url ?? '',
        record.source ?? '',
        record.message ?? '',
      ]),
  },
  {
    key: 'systemLogs',
    label: '系统日志',
    headers: LOG_HEADERS,
    getRows: () =>
      getRecentLogs(undefined, 1000).map((entry) => [
        formatTimestamp(entry.timestamp),
        entry.level,
        entry.message,
      ]),
  },
  {
    key: 'enrichRecords',
    label: '富化记录',
    headers: ['时间', '匹配方式', '名称', '行号', '富化字段', '原值', '新值', '动作', '备注'],
    getRows: () =>
      getAllEnrichRecords().map((record) => [
        record.timestamp,
        record.matchType,
        record.name,
        record.row,
        record.enrichedField,
        record.oldValue,
        record.updatedValue,
        record.action,
        record.note ?? '',
      ]),
  },
  {
    key: 'cleanLogs',
    label: '清理日志',
    headers: LOG_HEADERS,
    getRows: () =>
      getOperationLogs(CLEAN_LOG_SCOPE).map((entry) => [
        formatTimestamp(entry.timestamp),
        entry.level,
        entry.message,
      ]),
  },
]

/** 按键查找数据源（未找到返回 undefined） */
export function getExportSource(key: string): ExportSource | undefined {
  return EXPORT_SOURCES.find((source) => source.key === key)
}

/**
 * 执行导出。
 *
 * 无数据时不落文件 —— 生成一个只有表头的空文件对用户毫无价值，
 * 不如明确告诉他「暂无数据」。
 *
 * @param key - {@link EXPORT_SOURCES} 里的 key
 * @param format - 导出格式
 * @returns 导出的行数；0 表示未导出（数据源不存在或无数据）
 */
export function exportData(key: string, format: ExportFormat): number {
  const source = getExportSource(key)
  if (!source) {
    bgmLog(LOG_LEVELS.WARN, `[dataExport] 未知导出源: ${key}`)
    return 0
  }

  let rows: ExportCell[][]
  try {
    rows = source.getRows()
  } catch (error: unknown) {
    showToast(`${source.label}导出失败：${(error as Error).message}`, 'error')
    bgmLog(LOG_LEVELS.ERROR, `[dataExport] ${source.label} 取数失败: ${(error as Error).message}`)
    return 0
  }

  if (rows.length === 0) {
    showToast(`暂无${source.label}可导出`, 'warning')
    return 0
  }

  const count = exportRows(source.label, source.headers, rows, format)
  const formatLabel = format === 'csv' ? 'CSV' : 'TXT'
  showToast(`已导出 ${String(count)} 条${source.label}（${formatLabel}）`, 'success')
  bgmLog(
    LOG_LEVELS.INFO,
    `[dataExport] 导出 ${source.label} ${String(count)} 条，格式 ${formatLabel}`,
  )
  return count
}

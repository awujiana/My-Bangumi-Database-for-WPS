/**
 * @fileoverview 通用文件导出（CSV / TXT）
 * @module tools/file-export
 * @description
 *   把「表头 + 行数据」导出成本地文件，供三个工具的日志/记录导出共用。
 *
 *   设计要点：
 *   1. **CSV 带 UTF-8 BOM**：Excel 靠 BOM 判断 UTF-8，没有它中文全是乱码。
 *      这是本模块存在的唯一非显然细节，改动时别把 BOM 删了。
 *   2. **只依赖标准 DOM API**（Blob / URL.createObjectURL / a.download）。
 *      WPS 任务窗格是 WebView，这些 API 都可用；不要用 `FileDialog`
 *      （那是「选择已有文件」的 API，没有「另存为」用法）。
 *   3. 本模块是**纯逻辑 + 一个副作用出口**（{@link downloadTextFile}），
 *      序列化函数（{@link toCsv} / {@link toText}）无 DOM 依赖，便于单测。
 *
 * @remarks 此前 Blob 下载逻辑在 logger / export-jsonl / action-handlers /
 *   debug-panel 四处各写一遍，后续可逐步收敛到 {@link downloadTextFile}。
 */

/** 导出格式 */
export type ExportFormat = 'csv' | 'txt'

const CSV_MIME = 'text/csv;charset=utf-8'
const TXT_MIME = 'text/plain;charset=utf-8'

/** CSV 的 UTF-8 BOM —— Excel 靠它识别编码，缺了中文就乱码 */
const UTF8_BOM = '﻿'

/** TXT 的列分隔符 */
const TXT_SEPARATOR = ' | '

/** 单元格原始值（导出前统一转成字符串） */
export type ExportCell = string | number | boolean | null | undefined

/** 把任意单元格值转成安全的展示字符串 */
export function stringifyCell(value: ExportCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return value ? '是' : '否'
}

/**
 * RFC4180 字段转义：字段中出现分隔符、引号或换行时用双引号包裹，
 * 字段内部的双引号写成两个。
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/u.test(value)) return `"${value.replace(/"/gu, '""')}"`
  return value
}

/**
 * 序列化为 CSV 文本（**含 UTF-8 BOM**）。
 *
 * 换行用 CRLF 而非 LF —— 与 RFC4180 一致，且 Excel 对 CRLF 兼容更好。
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly ExportCell[])[],
): string {
  const lines: string[] = [headers.map((header) => escapeCsvField(header)).join(',')]
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvField(stringifyCell(cell))).join(','))
  }
  return UTF8_BOM + lines.join('\r\n')
}

/**
 * 序列化为纯文本：首行表头，其余为数据行，列之间用 ` | ` 分隔。
 *
 * 刻意**不做列宽对齐** —— 中文是等宽字体的两倍宽，算显示宽度要维护一张
 * CJK 区间表，收益（好看一点）不抵复杂度和出错风险。
 */
export function toText(
  headers: readonly string[],
  rows: readonly (readonly ExportCell[])[],
): string {
  const lines: string[] = [headers.join(TXT_SEPARATOR)]
  for (const row of rows) {
    lines.push(row.map((cell) => stringifyCell(cell)).join(TXT_SEPARATOR))
  }
  return lines.join('\n')
}

/** 把时间戳格式化成文件名用的 `YYYYMMDD-HHmmss`（本地时区） */
export function formatFileTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${String(date.getFullYear())}${month}${day}-${hours}${minutes}${seconds}`
}

/** 拼装导出文件名，形如 `bgm-同步记录-20260913-055403.csv` */
export function buildFileName(baseName: string, format: ExportFormat): string {
  return `bgm-${baseName}-${formatFileTimestamp(Date.now())}.${format}`
}

/**
 * 触发浏览器下载一段文本。
 *
 * 这是本模块**唯一**有副作用的函数（其余都是纯函数）。
 * 无 DOM 环境（单测 / SSR）下静默返回，不抛错 —— 导出失败的代价远小于
 * 打断当前业务流程。
 */
export function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * 按格式导出一组行数据。
 *
 * @param baseName - 文件名主体（不含前缀与扩展名）
 * @param headers - 表头
 * @param rows - 数据行（每行长度不必与表头一致，缺失补空）
 * @param format - 导出格式
 * @returns 实际导出的行数（供调用方弹 toast 提示）
 */
export function exportRows(
  baseName: string,
  headers: readonly string[],
  rows: readonly (readonly ExportCell[])[],
  format: ExportFormat,
): number {
  const isCsv = format === 'csv'
  const text = isCsv ? toCsv(headers, rows) : toText(headers, rows)
  downloadTextFile(buildFileName(baseName, format), text, isCsv ? CSV_MIME : TXT_MIME)
  return rows.length
}

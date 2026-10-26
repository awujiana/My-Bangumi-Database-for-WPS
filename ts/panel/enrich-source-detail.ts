/**
 * @fileoverview 源数据完整表格弹窗：把新番表源数据按列映射渲染成完整表格并托管其显示/隐藏。
 * @module panel/enrich-source-detail
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */

import { sanitizeHtml } from '../tools/sanitize.js'
import { escapeHtml } from '../tools/string-utilities.js'
import { getCellValue, getLastRow } from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'
import { COLUMN_MAPPING_FIELDS } from './enrich-page-state.js'
import type { ScalarMappingKey } from './enrich-page-state.js'
import { renderPreviewCell } from './enrich-preview-cell.js'
import { state, safeGetElement } from './enrich-page-context.js'

// ========== 源数据完整表格弹窗 ==========

export function showSourceDetail(): void {
  const modalElement = safeGetElement('sourceDetailModal')
  const bodyElement = safeGetElement('sourceDetailBody')
  const worksheet = state.animeSourceSheet
  if (!modalElement || !bodyElement || !worksheet) return

  bodyElement.innerHTML = renderSourceDetailTable(worksheet)
  modalElement.style.display = 'flex'
}

export function hideSourceDetail(): void {
  const modalElement = safeGetElement('sourceDetailModal')
  if (modalElement) {
    modalElement.style.display = 'none'
  }
}

/**
 * 渲染源表完整表格（弹窗展示）。
 *
 * 列集 = 有表头的列 ∪ 列映射命中的列（Hazx 模板的名称列没有表头，旧版按表头过滤会把它
 * 整列丢掉，造成弹窗「列数不全」）。无表头的映射列用字段名兜底（如「名称」）。
 * 单元格复用数据预览的渲染（周几七色 / 集数徽章 / TAGS 彩色标签 / 首播与平台着色），
 * 保证弹窗与预览样式一致。
 */
function renderSourceDetailTable(worksheet: WpsWorksheet): string {
  const maxColumns = 50
  const { headerRow, dataStartRow } = state
  const mapping = state.columnMapping

  // 列映射：列号 → 字段键（含 platformExtraCols 聚合列，也按平台徽章渲染）
  const fieldByColumn = new Map<number, ScalarMappingKey>()
  if (mapping) {
    for (const f of COLUMN_MAPPING_FIELDS) {
      const column = mapping[f.key]
      if (column && column > 0) fieldByColumn.set(column, f.key)
    }
    const extraPlatformColumns = mapping.platformExtraCols ?? []
    for (const column of extraPlatformColumns) {
      fieldByColumn.set(column, 'platformCol')
    }
  }
  const labelByField = new Map(COLUMN_MAPPING_FIELDS.map((f) => [f.key, f.label]))

  interface DetailColumn {
    column: number
    label: string
    field?: ScalarMappingKey | undefined
  }
  const columns: DetailColumn[] = []
  for (let column = 1; column <= maxColumns; column += 1) {
    const header = getCellValue(worksheet, headerRow, column).trim()
    const field = fieldByColumn.get(column)
    if (header || field) {
      const label =
        header || (field ? (labelByField.get(field) ?? '') : '') || `第${String(column)}列`
      columns.push({ column, label, field })
    }
  }

  if (columns.length === 0) {
    return '<div class="preview-hint">未找到表头列，无法展示完整表格</div>'
  }

  const maxRows = 100
  const lastRow = Math.min(getLastRow(worksheet), dataStartRow + maxRows - 1)

  const bodyRows: string[] = []
  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const rowCells: string[] = []
    let hasData = false
    for (const column of columns) {
      const value = getCellValue(worksheet, row, column.column).trim()
      if (value) hasData = true
      if (column.field) {
        // 已映射字段复用预览渲染（空值时 renderPreviewCell 自会输出空 td）
        rowCells.push(renderPreviewCell(column.field, value))
      } else {
        rowCells.push(`<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`)
      }
    }
    if (hasData) {
      bodyRows.push(
        `<tr data-row="${String(row)}"><td class="row-num">${String(row)}</td>${rowCells.join('')}</tr>`,
      )
    }
  }

  return sanitizeHtml(
    `<div class="preview-table"><table><thead><tr><th></th>${columns
      .map((c) => `<th>${escapeHtml(c.label)}</th>`)
      .join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
  )
}

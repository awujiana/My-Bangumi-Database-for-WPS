/**
 * @fileoverview 既有条件格式规则的表格呈现引擎（纯函数，零 WPS / DOM 依赖）
 * @module panel/conditionalFormatTable
 * @description 「既有规则」区从纯文本列表升级为**表格**（对标 WPS 规则管理器并更强）：
 *   列 = 优先级序号 / 类型 / 格式预览 / 应用于 / 公式 / 如果为真则停止 / 操作。
 *
 * 为什么把 HTML 生成也做成纯函数：
 *   347 条规则（实测用户表就是这个量级）下，页面层每次渲染都要重建整棵列表。
 *   行 HTML 抽成纯函数后可以脱离 jsdom 单测「转义 / 越界 / 空值」三类边界，
 *   页面层只管拼装与事件委托。
 *
 * 与 WPS 原生的差异（本项目更强的点）：
 *   - 支持对既有规则**搜索**（WPS 只有「当前选择 / 整表」下拉）；
 *   - 支持把任意一条既有规则**一键导入规则库**（变成可管理的插件规则）；
 *   - 分页渲染，347 条不卡（WPS 一次性渲染整表会明显掉帧）；
 *   - 格式预览同时显示填充色与字体色（WPS 只显示填充）。
 */

import { escapeHtml } from '../tools/string-utilities.js'
import type { ForeignRuleSnapshot } from './conditional-format-rules.js'

// ===== 类型标签表 =====

/** WPS XlFormatConditionType → 中文标签（与 WPS 规则管理器口径一致） */
export const FC_TYPE_LABELS: Record<number, string> = {
  1: '单元格值',
  2: '公式',
  3: '文本包含',
  4: '文本不包含',
  5: 'Top10 / 平均值',
  6: '图标集',
  7: '前 10%',
  8: '数据条',
  9: '色阶',
  10: '唯一值 / 重复值',
  11: '发生日期',
  12: '表达式',
}

/** 取类型标签（读不到类型号时按 kind 给兜底文案） */
export function fcTypeLabel(type: number | undefined, kind: 'expression' | 'other'): string {
  if (type === undefined) return kind === 'expression' ? '公式' : '其它类型'
  return FC_TYPE_LABELS[type] ?? `类型 ${String(type)}`
}

// ===== 行模型 =====

/** 表格的一行（由快照派生，全部为渲染所需，不直接持 COM 对象） */
export interface ForeignRuleRow {
  /** 1 基序号，即优先级（靠前先生效）；同时是 COM 层 Item() 的下标 */
  index: number
  /** 类型中文标签 */
  typeLabel: string
  /** 插件能否按原样重建（false = 数据条 / 图标集等，导入时会说明） */
  rebuildable: boolean
  /** 填充色（'#00B050'；读不到留空） */
  fillColor?: string
  /** 字体色 */
  fontColor?: string
  /** 生效范围地址 */
  range: string
  /** 公式（非公式类为空串） */
  formula: string
  /** 「如果为真则停止」；undefined = 宿主未暴露该属性 */
  stopIfTrue?: boolean
}

/** 快照 → 行模型（序号由数组下标推，保证与 FormatConditions.Item 一致） */
export function toForeignRuleRows(snapshots: readonly ForeignRuleSnapshot[]): ForeignRuleRow[] {
  return snapshots.map((snapshot, position) => ({
    index: position + 1,
    typeLabel: fcTypeLabel(snapshot.type, snapshot.kind),
    rebuildable: snapshot.kind === 'expression',
    ...(snapshot.interior !== undefined && { fillColor: snapshot.interior }),
    ...(snapshot.fontColor !== undefined && { fontColor: snapshot.fontColor }),
    range: snapshot.range || '（未读到范围）',
    formula: snapshot.formula,
    ...(snapshot.stopIfTrue !== undefined && { stopIfTrue: snapshot.stopIfTrue }),
  }))
}

/**
 * 搜索既有规则（类型 / 范围 / 公式 / 颜色，大小写不敏感子串）
 *
 * 颜色也进索引：实测用户找规则时经常记得「那条黄色的」而不记得公式。
 */
export function filterForeignRuleRows(
  rows: readonly ForeignRuleRow[],
  query: string,
): ForeignRuleRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) =>
    [row.typeLabel, row.range, row.formula, row.fillColor ?? '', row.fontColor ?? ''].some(
      (field) => field.toLowerCase().includes(needle),
    ),
  )
}

// ===== 分页 =====

/** 每页行数：347 条分 7 页；单页 DOM 量可控，翻页无感 */
export const FOREIGN_RULE_PAGE_SIZE = 50

export interface Page<T> {
  /** 当前页码（1 基） */
  page: number
  /** 总页数（至少 1，空列表也是 1 页） */
  pageCount: number
  /** 本页条目 */
  items: T[]
}

/**
 * 切片分页（页码越界时收敛到合法区间，避免「删完最后一页后停在空页」）
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize = FOREIGN_RULE_PAGE_SIZE,
): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)))
  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount)
  const start = (current - 1) * pageSize
  return { page: current, pageCount, items: items.slice(start, start + pageSize) }
}

// ===== 行 HTML =====

/** 公式超过该长度截断显示（title 里给全量） */
const FORMULA_PREVIEW_LIMIT = 48

/** 格式预览：填充块 + 字体色细条（WPS 只显示填充，这里两个都给） */
export function formatSwatchHtml(row: ForeignRuleRow): string {
  const fill = row.fillColor
    ? `background:${escapeHtml(row.fillColor)}`
    : 'background:repeating-conic-gradient(#3a3a4a 0% 25%, #2a2a36 0% 50%) 50% / 8px 8px'
  const fontBar =
    row.fontColor === undefined
      ? ''
      : `<span class="conditional-format-swatch-font" style="background:${escapeHtml(row.fontColor)}" title="字体色 ${escapeHtml(row.fontColor)}"></span>`
  const title = row.fillColor
    ? `填充 ${escapeHtml(row.fillColor)}${row.fontColor ? ` · 字体 ${escapeHtml(row.fontColor)}` : ''}`
    : '未读到格式（宿主未暴露 Interior / Font）'
  return `<span class="conditional-format-swatch" style="${fill}" title="${title}">${fontBar}</span>`
}

/**
 * 生成单行 HTML
 *
 * 所有用户/宿主可控字符串都过 {@link escapeHtml}——公式与范围来自 Excel 内容，
 * 是 XSS 的入口（本页 CSP 禁 inline script，但仍要防 attribute 注入）。
 * 交互走 `data-action` + 容器事件委托，不给每行绑监听器（347 行 = 347×N 个监听器）。
 */
export function buildForeignRuleRowHtml(row: ForeignRuleRow): string {
  const isHiddenStop = row.stopIfTrue === undefined
  const formulaPreview =
    row.formula.length > FORMULA_PREVIEW_LIMIT
      ? `${row.formula.slice(0, FORMULA_PREVIEW_LIMIT)}…`
      : row.formula
  return `
      <div class="conditional-format-row${row.rebuildable ? '' : ' conditional-format-row-foreign'}" data-row-index="${String(row.index)}">
        <span class="conditional-format-col-index" title="优先级（靠前先生效）">${String(row.index)}</span>
        <span class="conditional-format-col-type" title="${row.rebuildable ? '公式类：插件可原样重建' : '该类型插件无法重建，应用时会被丢弃或触发降级'}">${escapeHtml(row.typeLabel)}${row.rebuildable ? '' : '<em class="conditional-format-tag-warn">不可重建</em>'}</span>
        ${formatSwatchHtml(row)}
        <span class="conditional-format-col-range" title="${escapeHtml(row.range)}">${escapeHtml(row.range)}</span>
        <code class="conditional-format-col-formula" title="${escapeHtml(row.formula)}">${escapeHtml(formulaPreview)}</code>
        <label class="conditional-format-col-stop" title="${isHiddenStop ? '当前 WPS 未暴露该属性，无法修改' : '勾选后：本条命中就不再评估后续规则'}">
          <input type="checkbox" data-action="stop" ${row.stopIfTrue === true ? 'checked' : ''} ${isHiddenStop ? 'disabled' : ''} />
        </label>
        <span class="conditional-format-col-actions">
          <button type="button" data-action="import" title="导入规则库（变成可管理的插件规则）">⤵</button>
          <button type="button" data-action="up" title="上移（提高优先级）">↑</button>
          <button type="button" data-action="down" title="下移（降低优先级）">↓</button>
          <button type="button" data-action="delete" title="从工作表删除这条规则">✕</button>
        </span>
      </div>`
}

/** 表头（与 buildForeignRuleRowHtml 的列一一对应） */
export function buildForeignRuleHeadHtml(): string {
  return `
      <div class="conditional-format-row conditional-format-row-head" aria-hidden="true">
        <span class="conditional-format-col-index">#</span>
        <span class="conditional-format-col-type">类型</span>
        <span class="conditional-format-col-swatch">格式</span>
        <span class="conditional-format-col-range">应用于</span>
        <span class="conditional-format-col-formula">公式</span>
        <span class="conditional-format-col-stop">为真则停</span>
        <span class="conditional-format-col-actions">操作</span>
      </div>`
}

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
import { UNGROUPED_LABEL, snapshotGroupKey } from './conditional-format-rules.js'
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
  /**
   * 分组映射的查找键（= snapshotGroupKey(快照)，公式 \0 原始范围）
   *
   * ⚠️ 不能用行上的 `range` 字段现算：那个字段读不到范围时是**显示兜底**
   * 「（未读到范围）」，而分组映射（existingGroups）是用**原始**范围存的——
   * 拿兜底串算 key 永远命中不了，范围读不到的规则会死死掉进「未分组」，
   * 归组 / 重命名对它全部静默失效（2026-10-24 修：渲染层与存储层的 key 口径统一）。
   */
  groupKey: string
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
  /** 是否被选中（多选） */
  selected: boolean
}

/**
 * 快照 → 行模型（序号由数组下标推，保证与 FormatConditions.Item 一致）
 *
 * @param selection 已选中的 1 基序号集合（跨筛选 / 翻页保持：用户在第 2 页选的，
 *   翻回第 1 页仍然勾着 —— 这是多选的基本预期，做不到就是 bug）
 */
export function toForeignRuleRows(
  snapshots: readonly ForeignRuleSnapshot[],
  selection: ReadonlySet<number> = new Set(),
): ForeignRuleRow[] {
  return snapshots.map((snapshot, position) => {
    const index = position + 1
    return {
      index,
      groupKey: snapshotGroupKey(snapshot),
      typeLabel: fcTypeLabel(snapshot.type, snapshot.kind),
      rebuildable: snapshot.kind === 'expression',
      ...(snapshot.interior !== undefined && { fillColor: snapshot.interior }),
      ...(snapshot.fontColor !== undefined && { fontColor: snapshot.fontColor }),
      range: snapshot.range || '（未读到范围）',
      formula: snapshot.formula,
      ...(snapshot.stopIfTrue !== undefined && { stopIfTrue: snapshot.stopIfTrue }),
      selected: selection.has(index),
    }
  })
}

/**
 * 当前可见行里「是否全选」与「半选」（全选复选框的三态）
 *
 * 半选用 `indeterminate` 而不是用第三个图标：原生 checkbox 支持该属性，
 * 且读屏软件能正确播报「部分选中」。
 */
export function selectionSummary(visibleRows: readonly ForeignRuleRow[]): {
  isAllSelected: boolean
  isSomeSelected: boolean
} {
  const selectedCount = visibleRows.filter((row) => row.selected).length
  return {
    isAllSelected: visibleRows.length > 0 && selectedCount === visibleRows.length,
    isSomeSelected: selectedCount > 0 && selectedCount < visibleRows.length,
  }
}

/**
 * 把序号在选中集合里加入 / 移除（返回新集合，不改原集合）
 *
 * 不可变：渲染层每次都是 `state.existingSelection = toggleSelection(...)` 再重渲染，
 * 改原集合会让「上一次渲染的旧行模型」和「当前 state」指向同一个 Set，
 * 出现「取消了勾选但旧行还显示勾着」的灵异画面。
 */
export function toggleSelection(
  selection: ReadonlySet<number>,
  index: number,
  isSelected: boolean,
): Set<number> {
  const next = new Set(selection)
  if (isSelected) next.add(index)
  else next.delete(index)
  return next
}

// ===== 「显示其格式规则」范围筛选 =====

/**
 * 解析 A1 范围地址为可比较的矩形（绝对引用符 `$` 先剥掉）
 *
 * 支持 `A1` / `A1:B9` / `A:A`（整列）/ `1:10`（整行）三种形态；
 * 解析不了返回 null —— 调用方按「不相交」处理并在 UI 上说明，
 * 而不是抛错把整张表都藏掉。
 *
 * 行 / 列的「0」表示该维度不限：`A:A` 的 row 是 0..0，与任何行范围都算相交。
 */
/**
 * 列字母转列号（A→1，Z→26，AA→27）
 *
 * 用 `charCodeAt` 逐字符算而不是 `[...letters]` 展开：展开运算符遇组合字符 / emoji
 * 会拆成码点，而列字母只可能是 ASCII，逐字符更稳也更快。
 */
export function columnNumberOf(letters: string): number {
  let total = 0
  for (let index = 0; index < letters.length; index += 1) {
    total = total * 26 + (letters.codePointAt(index) ?? 0) - 64
  }
  return total
}

/**
 * 把单元格地址拆成「列字母段 + 行号段」，不是合法形态返回 null
 *
 * 不用正则：`^([A-Z]{1,3})?(\d+)?$` 被 ReDoS 扫描判为不安全（可选组里嵌量词），
 * 而这种地址本来就是逐字符扫描最直白。
 */
function splitCellReference(cell: string): { letters: string; digits: string } | null {
  const upper = cell.toUpperCase()
  let split = 0
  while (split < upper.length) {
    const code = upper.codePointAt(split) ?? 0
    if (code < 65 || code > 90) break
    split += 1
  }
  const letters = upper.slice(0, split)
  // 超过 3 位（XFD = 16384 列）不可能是合法列号，早退后再声明 digits
  if (letters.length > 3) return null
  const digits = upper.slice(split)
  for (let index = 0; index < digits.length; index += 1) {
    const code = digits.codePointAt(index) ?? 0
    if (code < 48 || code > 57) return null
  }
  return { letters, digits }
}

/** 单元格地址转「行 / 列」坐标；两个维度都缺省说明根本不是地址 */
function cellToCoordinate(cell: string): { row: number; column: number } | null {
  const parts = splitCellReference(cell)
  if (!parts) return null
  const column = parts.letters === '' ? 0 : columnNumberOf(parts.letters)
  const row = parts.digits === '' ? 0 : Number(parts.digits)
  if (column === 0 && row === 0) return null
  return { row, column }
}

export function parseRangeRect(
  range: string,
): { startRow: number; endRow: number; startColumn: number; endColumn: number } | null {
  const cleaned = range.replace(/\$/gu, '').trim()
  if (cleaned === '') return null
  const [head = '', tail = head] = cleaned.split(':', 2)

  const start = cellToCoordinate(head)
  const end = cellToCoordinate(tail)
  if (!start || !end) return null
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  }
}

/** 两个 A1 范围是否相交（含「整列 / 整行」语义） */
export function hasRangeOverlap(first: string, second: string): boolean {
  const a = parseRangeRect(first)
  const b = parseRangeRect(second)
  if (!a || !b) return false
  // 某一边该维度为 0 = 不限，直接算相交
  const hasRowOverlap =
    a.startRow === 0 || b.startRow === 0 || (a.startRow <= b.endRow && b.startRow <= a.endRow)
  const hasColumnOverlap =
    a.startColumn === 0 ||
    b.startColumn === 0 ||
    (a.startColumn <= b.endColumn && b.startColumn <= a.endColumn)
  return hasRowOverlap && hasColumnOverlap
}

/**
 * 按「显示其格式规则」范围筛选行
 *
 * `selection` 时只保留 AppliesTo 与选区相交的规则 —— 用户框了一列想看
 * 「这条列上挂了哪些条件」时不用在 347 条里翻（对齐 WPS 原生下拉）。
 */
export function filterRowsByScope(
  rows: readonly ForeignRuleRow[],
  scope: 'all' | 'selection',
  selectionRange: string,
): ForeignRuleRow[] {
  if (scope === 'all' || selectionRange === '') return [...rows]
  return rows.filter((row) => hasRangeOverlap(row.range, selectionRange))
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
      <div class="conditional-format-row${row.rebuildable ? '' : ' conditional-format-row-foreign'}${row.selected ? ' is-selected' : ''}" data-row-index="${String(row.index)}" title="拖拽调整优先级 · 右键打开操作菜单">
        <label class="conditional-format-col-check" title="选中后可批量操作（删除 / 导入 / 复制）">
          <input type="checkbox" data-action="select" ${row.selected ? 'checked' : ''} aria-label="选择第 ${String(row.index)} 条规则" />
        </label>
        <span class="conditional-format-col-index" title="优先级（靠前先生效）">${String(row.index)}</span>
        <span class="conditional-format-col-type" title="${row.rebuildable ? '公式类：插件可原样重建' : '该类型插件无法重建，应用时会被丢弃或触发降级'}">${escapeHtml(row.typeLabel)}${row.rebuildable ? '' : '<em class="conditional-format-tag-warn">不可重建</em>'}</span>
        ${formatSwatchHtml(row)}
        <span class="conditional-format-col-range conditional-format-cell-editable" data-action="edit-range" title="${escapeHtml(row.range)}">${escapeHtml(row.range)}</span>
        <code class="conditional-format-col-formula conditional-format-cell-editable" data-action="edit-formula" title="${escapeHtml(row.formula)}">${escapeHtml(formulaPreview)}</code>
        <label class="conditional-format-col-stop" title="${isHiddenStop ? '当前 WPS 未暴露该属性，无法修改' : '勾选后：本条命中就不再评估后续规则'}">
          <input type="checkbox" data-action="stop" ${row.stopIfTrue === true ? 'checked' : ''} ${isHiddenStop ? 'disabled' : ''} />
        </label>
      </div>`
}

/**
 * 表头（与 buildForeignRuleRowHtml 的列一一对应）
 *
 * 全选复选框带 `data-action="select-all"`，`indeterminate` 由页面层在渲染后设置
 * （HTML 属性表达不了三态，必须走 DOM property）。
 */
export function buildForeignRuleHeadHtml(isAllSelected = false): string {
  return `
      <div class="conditional-format-row conditional-format-row-head">
        <label class="conditional-format-col-check" title="全选 / 取消全选（当前页）">
          <input type="checkbox" data-action="select-all" ${isAllSelected ? 'checked' : ''} aria-label="全选当前页规则" />
        </label>
        <span class="conditional-format-col-index">#</span>
        <span class="conditional-format-col-type">类型</span>
        <span class="conditional-format-col-swatch">格式</span>
        <span class="conditional-format-col-range">应用于</span>
        <span class="conditional-format-col-formula">公式</span>
        <span class="conditional-format-col-stop">为真则停</span>
      </div>`
}

/**
 * 既有规则表格的本地分组渲染
 *
 * 组序 = 组内首条规则的出现顺序（Map 插入序），「未分组」恒排最后。
 * 标题复用规则库分组的 class（group-title / group-toggle / group-count），
 * 两处观感天然一致；折叠只藏行、计数仍在（看得出这组有多少条）。
 *
 * 标题上除收起钮外还有两个组级操作：✎ 重命名（组内全部规则换组名）、
 * ✕ 解散（映射清除，规则回「未分组」）——只靠「先勾行再找批量条」的归组
 * 入口不符合「看到组标题就能改组名」的心智（2026-10-24 用户实测反馈）。
 *
 * @param groups snapshotGroupKey → 组名（页面层从 PluginStorage 读出）
 * @param collapsed 被收起的分组名集合（会话态）
 */
export function buildForeignRuleGroupsHtml(
  rows: readonly ForeignRuleRow[],
  groups: Readonly<Record<string, string>>,
  collapsed: ReadonlySet<string>,
): string {
  const buckets = new Map<string, ForeignRuleRow[]>()
  for (const row of rows) {
    // 用行上预计算的 groupKey（原始公式@范围），不用 row.range 现算——
    // 后者读不到范围时是显示兜底串，与映射的存储 key 对不上
    const group = groups[row.groupKey] ?? UNGROUPED_LABEL
    const bucket = buckets.get(group)
    if (bucket) bucket.push(row)
    else buckets.set(group, [row])
  }
  // 「未分组」移到最后：用户主动归好的组应该先看到
  const ungrouped = buckets.get(UNGROUPED_LABEL)
  if (ungrouped !== undefined) {
    buckets.delete(UNGROUPED_LABEL)
    buckets.set(UNGROUPED_LABEL, ungrouped)
  }
  return [...buckets]
    .map(([group, groupRows]) => {
      const isCollapsed = collapsed.has(group)
      return `
      <div class="conditional-format-group conditional-format-existing-group${isCollapsed ? ' is-collapsed' : ''}" data-group="${escapeHtml(group)}">
        <div class="conditional-format-group-title">
          <button type="button" class="conditional-format-group-toggle" data-action="toggle-existing-group" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${isCollapsed ? '展开分组' : '收起分组'}">${isCollapsed ? '▸' : '▾'}</button>
          <span class="conditional-format-group-name">${escapeHtml(group)}</span>
          <span class="conditional-format-group-count">${String(groupRows.length)}</span>
          <button type="button" class="conditional-format-group-edit" data-action="rename-existing-group" title="重命名分组（组内全部规则改用新组名）">✎</button>
          <button type="button" class="conditional-format-group-remove" data-action="dissolve-existing-group" title="解散分组（规则回「未分组」，不从工作表删除）">✕</button>
          <button type="button" class="conditional-format-group-pick" data-action="pick-existing-group" title="全选 / 取消本组">☑</button>
          <button type="button" class="conditional-format-group-export" data-action="export-existing-group" title="导出本组规则为 JSON（选保存位置）">📤</button>
          <button type="button" class="conditional-format-group-delete" data-action="delete-existing-group" title="从工作表删除本组全部规则">🗑</button>
        </div>
        ${groupRows.map((row) => buildForeignRuleRowHtml(row)).join('')}
      </div>`
    })
    .join('')
}

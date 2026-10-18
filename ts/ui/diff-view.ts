/**
 * @fileoverview 通用 diff 视图模块（diff2html 风格）
 * @module ui/diffView
 * @description
 * 把「待删除行 / 单元格新旧值 / 重复组保留对比」渲染成统一的 diff 视图，
 * 参考 diff2html 的行式呈现范式：**行号 + 变更标记 + 行级底色 + 行内高亮**。
 *
 * 行类型（{@link DiffRowKind}）：
 * - `keep`     保留行（重复组对比中的基准，标记 `=`）
 * - `delete`   将被删除的行 / 单元格旧值（标记 `-`，红色系）
 * - `insert`   变更后的新值（标记 `+`，绿色系）
 * - `context`  分组说明行（跨列单格，标记 `·`）
 *
 * 设计约束：
 * - **安全**：所有用户数据（工作表名、条目名、URL）先 `escapeHtml`，再整体过
 *   `sanitizeHtml`；「显示更多」的批量行追加走 `sanitizeTableRows` ——
 *   顶层裸 `<tr>` 会被 DOMPurify 按 HTML 规范剥离，必须包进表格上下文。
 * - **性能**：大列表分页渲染（默认每页 50 行），「显示更多」按批
 *   `insertAdjacentHTML` 追加，避免千行级 innerHTML 一次性注入导致任务窗格卡顿。
 * - **零依赖**：不引 diff2html 本体（任务窗格 CSP 禁外链、包体敏感），
 *   只复用其交互范式。
 */

import { escapeHtml } from '../tools/string-utilities.js'
import { sanitizeHtml, sanitizeTableRows } from '../tools/sanitize.js'

// ========== 类型 ==========

/** diff 行的类型 */
export type DiffRowKind = 'keep' | 'delete' | 'insert' | 'context'

/** diff 视图的一行 */
export interface DiffRow {
  /** 行类型 */
  kind: DiffRowKind
  /** Excel 行号（1-based；context 行可省略） */
  rowNumber?: number
  /** 行单元格内容（原始文本，模块负责转义） */
  cells: readonly string[]
  /** 行尾补充说明（如「无 URL」「标签并入保留行」） */
  note?: string
  /**
   * 行内 diff：设置后**最后一个单元格**按公共前后缀裁剪渲染
   * （`<span class="diff-del">` 旧中段 / `diff-ins` 新中段）。
   * delete 行与 insert 行应设置同一份 `{ oldValue, nextValue }`。
   */
  inlineDiff?: { oldValue: string; nextValue: string }
}

/** diff 视图的一个区块（通常 = 一条规则 × 一个目标） */
export interface DiffSection {
  /** 稳定标识（分页状态键；同一容器内必须唯一） */
  id: string
  /** 区块标题（如规则名） */
  title: string
  /** 副标题（如目标标签 + 统计） */
  subtitle?: string
  /** 表头列名 */
  columns: readonly string[]
  /** 数据行 */
  rows: readonly DiffRow[]
}

/** 渲染选项 */
export interface DiffRenderOptions {
  /** 每页行数（默认 50） */
  pageSize?: number
}

/** 行内 diff 的四段裁剪结果 */
export interface InlineDiffParts {
  /** 公共前缀 */
  prefix: string
  /** 旧值中段（差异部分） */
  oldMid: string
  /** 新值中段（差异部分） */
  nextMid: string
  /** 公共后缀 */
  suffix: string
}

// ========== 常量 ==========

/** 默认每页行数 */
const DEFAULT_PAGE_SIZE = 50

/** 行类型 → 变更标记与 class */
const ROW_META: Record<DiffRowKind, { marker: string; cls: string }> = {
  keep: { marker: '=', cls: 'diff-row-keep' },
  delete: { marker: '-', cls: 'diff-row-delete' },
  insert: { marker: '+', cls: 'diff-row-insert' },
  context: { marker: '·', cls: 'diff-row-context' },
}

// ========== 容器状态（分页进度 + 监听去重） ==========

interface DiffViewState {
  sections: readonly DiffSection[]
  pageSize: number
  /** section id → 已渲染行数 */
  rendered: Map<string, number>
}

/** 容器 → 状态（WeakMap：容器被 GC 时状态一并回收，无泄漏） */
const containerStates = new WeakMap<HTMLElement, DiffViewState>()

// ========== 行内 diff ==========

/**
 * 按公共前后缀裁剪新旧值，得到行内高亮的四段。
 * 纯函数、零依赖：不追求最小编辑脚本（LCS），只裁剪首尾公共部分——
 * 单元格值通常是小改动（去空格 / 改分隔符 / 补别名），前后缀裁剪已足够直观。
 */
export function splitInlineDiff(oldValue: string, nextValue: string): InlineDiffParts {
  const maxStart = Math.min(oldValue.length, nextValue.length)
  let start = 0
  while (start < maxStart && oldValue[start] === nextValue[start]) start += 1
  let endOld = oldValue.length
  let endNext = nextValue.length
  while (endOld > start && endNext > start && oldValue[endOld - 1] === nextValue[endNext - 1]) {
    endOld -= 1
    endNext -= 1
  }
  return {
    prefix: oldValue.slice(0, start),
    oldMid: oldValue.slice(start, endOld),
    nextMid: nextValue.slice(start, endNext),
    suffix: oldValue.slice(endOld),
  }
}

// ========== 渲染 ==========

/** 行尾说明（无则空串） */
function renderNote(note: string | undefined): string {
  return note ? ` <span class="diff-note">${escapeHtml(note)}</span>` : ''
}

/** 渲染单个单元格（最后一个单元格支持行内 diff 与行尾说明） */
function renderCell(row: DiffRow, index: number, cellCount: number): string {
  const isLast = index === cellCount - 1
  if (isLast && row.inlineDiff) {
    const parts = splitInlineDiff(row.inlineDiff.oldValue, row.inlineDiff.nextValue)
    const mid = row.kind === 'delete' ? parts.oldMid : parts.nextMid
    const midClass = row.kind === 'delete' ? 'diff-del' : 'diff-ins'
    // 中段为空（纯追加 / 纯删除尾部）时不渲染空 span，保持 DOM 干净
    const midHtml = mid === '' ? '' : `<span class="${midClass}">${escapeHtml(mid)}</span>`
    return `<td class="diff-cell">${escapeHtml(parts.prefix)}${midHtml}${escapeHtml(
      parts.suffix,
    )}${renderNote(row.note)}</td>`
  }
  return `<td class="diff-cell">${escapeHtml(row.cells[index] ?? '')}${
    isLast ? renderNote(row.note) : ''
  }</td>`
}

/** 渲染单行（context 行为跨列单格） */
export function renderDiffRow(row: DiffRow, columnCount: number): string {
  const meta = ROW_META[row.kind]
  if (row.kind === 'context') {
    // 标记列 + 行号列 + 数据列
    const span = columnCount + 2
    return `<tr class="diff-row ${meta.cls}"><td class="diff-marker">${meta.marker}</td><td class="diff-context" colspan="${String(
      span,
    )}">${escapeHtml(row.cells[0] ?? '')}</td></tr>`
  }
  const cells = row.cells.map((_, index) => renderCell(row, index, row.cells.length)).join('')
  const rowNumber = row.rowNumber === undefined ? '' : escapeHtml(String(row.rowNumber))
  return `<tr class="diff-row ${meta.cls}"><td class="diff-marker">${meta.marker}</td><td class="diff-row-num">${rowNumber}</td>${cells}</tr>`
}

/** 渲染区块骨架（表头 + 首页行 + 「显示更多」按钮） */
function renderSectionShell(section: DiffSection, pageSize: number): string {
  const headCells = section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')
  const firstPage = section.rows.slice(0, pageSize).map((row) => renderDiffRow(row, section.columns.length)).join('')
  const remaining = section.rows.length - Math.min(section.rows.length, pageSize)
  const subtitle = section.subtitle
    ? `<span class="diff-section-subtitle">${escapeHtml(section.subtitle)}</span>`
    : ''
  const moreButton =
    remaining > 0
      ? `<button type="button" class="diff-more-btn" data-diff-more="${escapeHtml(section.id)}">显示更多（剩余 ${String(remaining)} 行）</button>`
      : ''
  return `<div class="diff-section" data-diff-id="${escapeHtml(section.id)}">
  <div class="diff-section-head"><span class="diff-section-title">${escapeHtml(section.title)}</span>${subtitle}</div>
  <div class="diff-table-wrap">
    <table class="diff-table">
      <thead><tr><th class="diff-marker-col" aria-label="变更类型"></th><th class="diff-num-col">行号</th>${headCells}</tr></thead>
      <tbody>${firstPage}</tbody>
    </table>
  </div>${moreButton}
</div>`
}

/**
 * 把 diff 区块渲染进容器（整体替换容器内容）。
 *
 * @param container - 目标容器（null 时静默返回）
 * @param sections - 区块列表；空数组清空容器
 * @param options - 渲染选项（每页行数）
 */
export function renderDiffSections(
  container: HTMLElement | null,
  sections: readonly DiffSection[],
  options: DiffRenderOptions = {},
): void {
  if (!container) return
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE)
  const state: DiffViewState = { sections, pageSize, rendered: new Map() }
  for (const section of sections) {
    state.rendered.set(section.id, Math.min(section.rows.length, pageSize))
  }
  containerStates.set(container, state)

  if (sections.length === 0) {
    container.replaceChildren()
    return
  }
  container.innerHTML = sanitizeHtml(
    sections.map((section) => renderSectionShell(section, pageSize)).join(''),
  )
  // 分页点击委托（幂等；容器内容重建后无需重新绑定）
  bindDiffPagination(container)
}

/**
 * 「显示更多」按批追加（由容器点击委托调用，也可在测试中直接调用）。
 *
 * @returns 本次追加后的该区块剩余行数（0 = 已全部渲染）
 */
export function appendDiffPage(container: HTMLElement, sectionId: string): number {
  const state = containerStates.get(container)
  if (!state) return 0
  const section = state.sections.find((item) => item.id === sectionId)
  if (!section) return 0
  const rendered = state.rendered.get(sectionId) ?? state.pageSize
  const nextRows = section.rows.slice(rendered, rendered + state.pageSize)
  if (nextRows.length === 0) return 0

  const sectionElement = [...container.querySelectorAll<HTMLElement>('.diff-section')].find(
    (element) => element.dataset.diffId === sectionId,
  )
  const tbody = sectionElement?.querySelector('tbody')
  if (!tbody) return 0
  // 行片段必须走 sanitizeTableRows：顶层裸 <tr> 在 DOMPurify 主路径会被剥离
  tbody.insertAdjacentHTML('beforeend', sanitizeTableRows(nextRows.map((row) => renderDiffRow(row, section.columns.length)).join('')))
  const nextCount = rendered + nextRows.length
  state.rendered.set(sectionId, nextCount)

  const remaining = section.rows.length - nextCount
  const button = sectionElement?.querySelector<HTMLButtonElement>('[data-diff-more]')
  if (button) {
    if (remaining > 0) {
      button.textContent = `显示更多（剩余 ${String(remaining)} 行）`
    } else {
      button.remove()
    }
  }
  return remaining
}

/**
 * 绑定容器内的「显示更多」点击委托（幂等：重复调用不会重复绑定）。
 * {@link renderDiffSections} 内部已绑定，一般无需显式调用；
 * 仅当容器内容被外部逻辑重建后才需要重新绑定。
 */
export function bindDiffPagination(container: HTMLElement): void {
  if (container.dataset.diffPaginationBound === 'true') return
  container.dataset.diffPaginationBound = 'true'
  container.addEventListener('click', (event: Event) => {
    const { target } = event
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('[data-diff-more]')
    if (!button || !container.contains(button)) return
    appendDiffPage(container, button.dataset.diffMore ?? '')
  })
}

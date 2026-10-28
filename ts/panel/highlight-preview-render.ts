/**
 * @fileoverview 番剧高亮「实时预览」的详情渲染（表格 / 卡片两种视图）
 * @module panel/highlight-preview-render
 *
 * 为什么单独成模块：预览详情是**纯字符串拼装**（行号 / 名称 / 匹配值 → HTML），
 * 而高亮页本身被 COM 依赖缠住（`ts/panel/highlight-page.ts` 要 mock 十几个模块
 * 才能在 jsdom 里跑）。把拼装抽出来，就能直接对「转义、上限、视图切换」写单测，
 * 页面只负责取数与写 DOM。
 *
 * 两种视图是同一份数据的不同呈现，**不是两套取数**：
 * - `table`：行号 / 名称 / 匹配值三列表格，窄窗格里一屏能看十几行；
 * - `card`：一行一张卡片，名称与匹配值分行显示，长名称不会被列宽截断。
 *
 * 上限 {@link PREVIEW_DETAIL_LIMIT} 是**渲染上限**，不是命中上限：命中可能上千行
 * （一整季的番剧），全量铺进 DOM 会让预览区卡住；超出部分只报数，不静默丢。
 */

/** 预览视图 */
export type PreviewView = 'table' | 'card'

/** 一条命中行（预览详情的最小数据单元） */
export interface PreviewRowDetail {
  /** 工作表行号（1 基） */
  row: number
  /** 名称列的值（可能为空串：表里没填名称） */
  name: string
  /** 日期源列的值（参与季度匹配的原始文本） */
  value: string
}

/**
 * 详情区最多渲染多少行
 *
 * 50 行 × 3 列 ≈ 150 个单元格，任何窗格宽度下滚动都不卡；再多的行用户也不会
 * 靠预览看，而是去表里看 —— 预览的职责是「确认口径对不对」。
 */
export const PREVIEW_DETAIL_LIMIT = 50

/** 把存储里读到的任意值归一成视图名（坏值一律当表格） */
export function normalizePreviewView(value: string): PreviewView {
  return value === 'card' ? 'card' : 'table'
}

/** 空名称/空值的占位（不显示空白单元格，否则用户以为是渲染丢了） */
const EMPTY_PLACEHOLDER = '—'

/** HTML 转义（本模块自带，避免为一个函数引入 tools 层依赖） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

/** 转义 + 空值占位 */
function cellText(text: string): string {
  const trimmed = text.trim()
  return trimmed === '' ? EMPTY_PLACEHOLDER : escapeHtml(trimmed)
}

/** 超出渲染上限时的说明（没有超出则返回空串） */
function buildMoreHint(total: number): string {
  if (total <= PREVIEW_DETAIL_LIMIT) return ''
  return `<p class="highlight-preview-more">仅显示前 ${String(PREVIEW_DETAIL_LIMIT)} 行，共 ${String(total)} 行（完整结果请点「应用高亮」后在表里查看）</p>`
}

/**
 * 表格视图
 *
 * 用真 `<table>` 而不是 CSS Grid：预览表的列固定三列、行数有上限，
 * 表格语义（th/td）对读屏与复制都更友好，也不需要列宽拖拽。
 */
export function buildPreviewTableHtml(items: readonly PreviewRowDetail[]): string {
  const shown = items.slice(0, PREVIEW_DETAIL_LIMIT)
  const rows = shown
    .map(
      (item) => `<tr>
          <td class="highlight-preview-cell-row">${String(item.row)}</td>
          <td class="highlight-preview-cell-name" title="${cellText(item.name)}">${cellText(item.name)}</td>
          <td class="highlight-preview-cell-value" title="${cellText(item.value)}">${cellText(item.value)}</td>
        </tr>`,
    )
    .join('')
  return `<div class="highlight-preview-table">
      <table>
        <thead>
          <tr><th>行</th><th>名称</th><th>匹配值</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${buildMoreHint(items.length)}`
}

/** 卡片视图（一行一张卡：行号徽标 + 名称 + 匹配值） */
export function buildPreviewCardsHtml(items: readonly PreviewRowDetail[]): string {
  const shown = items.slice(0, PREVIEW_DETAIL_LIMIT)
  const cards = shown
    .map(
      (item) => `<article class="highlight-preview-card">
          <span class="highlight-preview-card-row">行 ${String(item.row)}</span>
          <div class="highlight-preview-card-name" title="${cellText(item.name)}">${cellText(item.name)}</div>
          <div class="highlight-preview-card-value" title="${cellText(item.value)}">${cellText(item.value)}</div>
        </article>`,
    )
    .join('')
  return `<div class="highlight-preview-cards">${cards}</div>${buildMoreHint(items.length)}`
}

/**
 * 按视图拼详情 HTML
 *
 * @param items 命中行（已带名称与匹配值）
 * @param view 视图；坏值当表格（{@link normalizePreviewView}）
 * @returns 空数组时返回空串 —— 调用方据此清空容器（无命中时摘要行已说明「命中 0 行」，
 *   再渲染一个空表格只会多一层噪音）
 */
export function buildPreviewDetailHtml(
  items: readonly PreviewRowDetail[],
  view: PreviewView,
): string {
  if (items.length === 0) return ''
  return normalizePreviewView(view) === 'card'
    ? buildPreviewCardsHtml(items)
    : buildPreviewTableHtml(items)
}

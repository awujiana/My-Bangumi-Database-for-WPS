/**
 * @fileoverview 统一统计卡片组件
 * @module ui/stat-cards
 * @description
 *   三个页面的预览区各自手写了统计卡片，样式与结构各不相同
 *   （`clean-stat-*` / `match-stat-*` / `record-stat-*`），
 *   新增一个统计值要在三处分别改 HTML + CSS + 渲染代码。
 *
 *   这里收敛成**一个**渲染函数：调用方只给 `{ label, value, tone }` 数组，
 *   结构与配色由组件统一负责。样式在 `css/styles.css` 的 `.stat-grid` /
 *   `.stat-card`（所有页面都引入该文件，故三页外观一致）。
 *
 *   **安全**：值可能来自用户数据（工作表名、规则名），一律先 `escapeHtml`
 *   再整体过 `sanitizeHtml`。
 */

import { escapeHtml } from '../tools/string-utilities.js'
import { sanitizeHtml } from '../tools/sanitize.js'

/** 统计卡片的语义色调（对应 tokens 里的语义色） */
export type StatTone = 'default' | 'success' | 'warning' | 'error' | 'accent'

/** 一张统计卡片 */
export interface StatCard {
  /** 卡片下方的小字说明 */
  label: string
  /** 卡片上的大数字/文本（已格式化好，直接展示） */
  value: string | number
  /** 色调，默认 `default` */
  tone?: StatTone
}

/** tone → CSS class 后缀（`default` 不加后缀，用基础样式） */
const TONE_CLASS: Record<StatTone, string> = {
  default: '',
  success: ' stat-card-success',
  warning: ' stat-card-warning',
  error: ' stat-card-error',
  accent: ' stat-card-accent',
}

/**
 * 把统计卡片渲染进容器。
 *
 * 目标容器不存在时静默返回 —— 页面可能还没渲染到该区块（或当前页签未激活），
 * 这不是错误，不值得打断调用方。
 *
 * @param container - 目标容器（为 null 时静默返回）
 * @param cards - 卡片列表；空数组会渲染出一个空的栅格（视觉上不占位）
 */
export function renderStatCards(container: HTMLElement | null, cards: readonly StatCard[]): void {
  if (!container) return
  if (cards.length === 0) {
    container.replaceChildren()
    return
  }

  const html = cards
    .map((card) => {
      const tone = card.tone ?? 'default'
      return `<div class="stat-card${TONE_CLASS[tone]}"><div class="stat-value">${escapeHtml(
        String(card.value),
      )}</div><div class="stat-label">${escapeHtml(card.label)}</div></div>`
    })
    .join('')

  container.innerHTML = sanitizeHtml(`<div class="stat-grid">${html}</div>`)
}

/** 清空统计区（预览被作废 / 重新扫描前调用） */
export function clearStatCards(container: HTMLElement | null): void {
  if (container) container.replaceChildren()
}

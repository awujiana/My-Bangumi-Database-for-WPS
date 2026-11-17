/**
 * @fileoverview 数据中心纯 SVG 图表（饼图 / 月度柱状图 / 环比箭头）
 * @module ui/dataCenterCharts
 * @description 不引入图表库：与 `sync-stats-chart.ts` 同风格，直接吃 tokens.css 的主题变量，
 *              在 file:// 安装态稳定。所有可见文案由调用方以已翻译文本传入，模块本身不 import i18n。
 *
 * 安全：标签一律经 escapeHtml 转义，颜色只用固定调色板（非用户输入），避免 XSS。
 */

import { escapeHtml } from '../tools/string-utilities.js'
import type { MonthlyCount, PeriodComparison, StatusCount } from '../services/data-center-stats.js'

/** 饼图调色板（按状态 1~5 顺序）：填充色 token */
const STATUS_FILLS: readonly string[] = [
  'var(--chip-blue)',
  'var(--chip-green)',
  'var(--chip-yellow)',
  'var(--chip-purple)',
  'var(--chip-red)',
]

/** 状态展示名（简体兜底，调用方传已翻译的 labels 覆盖） */
const DEFAULT_STATUS_LABELS: readonly string[] = ['想看', '看过', '在看', '搁置', '抛弃']

/** 饼图扇形的颜色（按索引，越界回退） */
function fillFor(index: number): string {
  return STATUS_FILLS[index] ?? 'var(--chip-purple)'
}

/** 计算饼图某扇形的 SVG path（圆心 60,60 半径 50） */
function slicePath(startFraction: number, endFraction: number): string {
  const centerX = 60
  const centerY = 60
  const radius = 50
  if (endFraction - startFraction >= 1) {
    return `M ${String(centerX)} ${String(centerY - radius)} A ${String(radius)} ${String(radius)} 0 1 1 ${String(centerX - 0.001)} ${String(centerY - radius)} Z`
  }
  const startAngle = startFraction * 2 * Math.PI - Math.PI / 2
  const endAngle = endFraction * 2 * Math.PI - Math.PI / 2
  const startX = centerX + radius * Math.cos(startAngle)
  const startY = centerY + radius * Math.sin(startAngle)
  const endX = centerX + radius * Math.cos(endAngle)
  const endY = centerY + radius * Math.sin(endAngle)
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0
  return `M ${String(centerX)} ${String(centerY)} L ${String(startX)} ${String(startY)} A ${String(radius)} ${String(radius)} 0 ${String(largeArc)} 1 ${String(endX)} ${String(endY)} Z`
}

/**
 * 渲染状态分布饼图 + 图例
 * @param counts 各状态计数（含 0）
 * @param labels 已翻译的状态名（5 项，顺序同 STAT_STATUSES）
 */
export function renderStatusPie(counts: readonly StatusCount[], labels?: readonly string[]): string {
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  const names = labels ?? DEFAULT_STATUS_LABELS
  let cursor = 0
  const slices: string[] = []
  const legend: string[] = []

  for (const [index, item] of counts.entries()) {
    const fraction = total > 0 ? item.count / total : 0
    if (fraction > 0) {
      slices.push(
        `<path d="${slicePath(cursor, cursor + fraction)}" fill="${fillFor(index)}" stroke="var(--bg-surface-2)" stroke-width="1"></path>`,
      )
    }
    cursor += fraction
    const label = names[index] ?? String(item.status)
    legend.push(
      `<div class="dc-legend-item"><span class="dc-legend-dot" style="background:${fillFor(index)}"></span>${escapeHtml(label)} <strong>${String(item.count)}</strong></div>`,
    )
  }

  return `
    <div class="dc-pie">
      <svg viewBox="0 0 120 120" class="dc-pie-svg" role="img">
        ${total > 0 ? slices.join('') : `<circle cx="60" cy="60" r="50" fill="var(--bg-surface-2)"></circle>`}
      </svg>
      <div class="dc-pie-center"><strong>${String(total)}</strong></div>
    </div>
    <div class="dc-legend">${legend.join('')}</div>
  `
}

/** 渲染月度完成数柱状图 */
export function renderMonthlyBars(months: readonly MonthlyCount[], emptyText: string): string {
  if (months.length === 0) {
    return `<p class="dc-empty">${escapeHtml(emptyText)}</p>`
  }
  const max = Math.max(...months.map((item) => item.count), 1)
  const bars = months
    .map((item) => {
      const heightPercent = Math.round((item.count / max) * 100)
      return `
        <div class="dc-bar-col">
          <div class="dc-bar-track"><div class="dc-bar-fill" style="height:${String(heightPercent)}%"></div></div>
          <span class="dc-bar-value">${String(item.count)}</span>
          <span class="dc-bar-label">${escapeHtml(item.month)}</span>
        </div>
      `
    })
    .join('')
  return `<div class="dc-bars">${bars}</div>`
}

/** 渲染环比：绿色向上 / 红色向下（涨跌语义按中国习惯：增为红？此处是完成数，增用 success 绿） */
export function renderComparison(comparison: PeriodComparison, labels: { up: string; down: string; flat: string }): string {
  const { changePercent } = comparison
  let direction: 'up' | 'down' | 'flat'
  if (changePercent > 0) {
    direction = 'up'
  } else if (changePercent < 0) {
    direction = 'down'
  } else {
    direction = 'flat'
  }
  const colorByDirection = {
    up: 'var(--text-success)',
    down: 'var(--text-danger)',
    flat: 'var(--text-3)',
  }
  const arrowByDirection = { up: '▲', down: '▼', flat: '—' }
  const color = colorByDirection[direction]
  const arrow = arrowByDirection[direction]
  const label = labels[direction]
  return `
    <div class="dc-compare" style="color:${color}">
      <span class="dc-compare-arrow">${arrow}</span>
      <strong>${changePercent > 0 ? '+' : ''}${String(changePercent)}%</strong>
      <span class="dc-compare-label">${escapeHtml(label)}</span>
    </div>
  `
}

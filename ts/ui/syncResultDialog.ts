/**
 * @fileoverview 同步结果增强对话框
 * @module ui/syncResultDialog
 * @description 在同步完成后显示增强的统计结果弹窗，包含：
 * - 数据统计概览（总条数、新增、更新、删除、无变更、失败）
 * - 开播日期统计（最早/最晚开播日、最新开播季度）
 * - 导出为 JSONL 文件
 * - 查看同步详情
 * - 逐条查看与对比
 */

import { LOG_LEVELS } from '../core/constants.js'
import { exportSheetToJsonlFile } from '../sync/exportJsonl.js'
import type { GithubSyncResult } from '../sync/githubSync.js'
import type { GithubSyncDetailItem } from '../sync/githubSyncDiff.js'
import { extractSubjectId } from '../sync/pureUtils.js'
import {
  getDataSheet,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  getCellValue,
  trim,
} from '../tools/util/index.js'
import { bgmLog } from '../tools/util.js'

import { renderSyncDetailTable } from './dialog.js'

// ========== 日期统计类型 ==========

export interface DateStats {
  /** 最早开播日期（YYYY-MM-DD） */
  earliestDate: string | null
  /** 最晚开播日期（YYYY-MM-DD） */
  latestDate: string | null
  /** 最新开播季度（如 "2024年7月新番"） */
  latestSeason: string | null
  /** 有开播日期的条目数 */
  datedCount: number
  /** 总条目数 */
  totalCount: number
}

// ========== 对话框选项 ==========

export interface SyncResultDialogOptions {
  /** 同步结果统计 */
  result: GithubSyncResult
  /** 总耗时（毫秒） */
  elapsedMs: number
  /** 平均速度（行/秒） */
  avgSpeed: number
  /** 同步策略显示名称 */
  strategyLabel: string
  /** 是否被用户停止 */
  stopped: boolean
  /** 查看详情时滚动到的目标行号（可选，默认跳转到最新记录） */
  scrollToRow?: number
}

// ========== 日期统计计算 ==========

/**
 * 从日期字符串推断季度
 * 1-3月 → 冬，4-6月 → 春，7-9月 → 夏，10-12月 → 秋
 */
function getSeasonFromDate(dateString: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})/.exec(dateString)
  if (!match) return null
  const year = match[1]!
  const month = parseInt(match[2]!, 10)
  const seasonMap: Record<number, string> = {
    1: '冬',
    2: '冬',
    3: '冬',
    4: '春',
    5: '春',
    6: '春',
    7: '夏',
    8: '夏',
    9: '夏',
    10: '秋',
    11: '秋',
    12: '秋',
  }
  const season = seasonMap[month]
  if (!season) return null
  return `${year}年${String(month)}月新番`
}

/**
 * 从 Excel 工作表中计算开播日期统计
 *
 * 遍历数据行，读取「开播日期」列，计算最早/最晚日期和最新季度。
 * 支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 格式。
 *
 * @returns 日期统计信息
 */
export function computeDateStatsFromSheet(): DateStats {
  const stats: DateStats = {
    earliestDate: null,
    latestDate: null,
    latestSeason: null,
    datedCount: 0,
    totalCount: 0,
  }

  const ws = getDataSheet()
  if (!ws) return stats

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)

  if (!colMap.has('Bangumi_URL') || !colMap.has('开播日期')) {
    return stats
  }

  const dateCol = colMap.get('开播日期')!
  const startRow = headerRow + 1

  let earliest: string | null = null
  let latest: string | null = null
  let datedCount = 0
  let totalCount = 0

  for (let row = startRow; row <= lastRow; row += 1) {
    const url = trim(getCellValue(ws, row, colMap.get('Bangumi_URL')!))
    if (url) {
      const sid = extractSubjectId(url)
      if (sid) {
        totalCount += 1

        const dateString = trim(getCellValue(ws, row, dateCol))
        if (dateString) {
          datedCount += 1

          // 标准化日期：移除分隔符，用于比较
          const normalized = dateString.replace(/[/.]/g, '-')
          const dateMatch = /^\d{4}-\d{1,2}-\d{1,2}$/.exec(normalized)
          if (dateMatch) {
            if (earliest === null || normalized < earliest) earliest = normalized
            if (latest === null || normalized > latest) latest = normalized
          }
        }
      }
    }
  }

  stats.earliestDate = earliest
  stats.latestDate = latest
  stats.datedCount = datedCount
  stats.totalCount = totalCount

  if (latest) {
    stats.latestSeason = getSeasonFromDate(latest)
  }

  return stats
}

// ========== 增强结果弹窗 ==========

let _resultDialog: HTMLElement | null = null
let _resultDialogEscHandler: ((e: KeyboardEvent) => void) | null = null

/** 清理 ESC 监听器 */
function _clearEscHandler(): void {
  if (_resultDialogEscHandler) {
    document.removeEventListener('keydown', _resultDialogEscHandler)
    _resultDialogEscHandler = null
  }
}

/**
 * 计算格式化耗时字符串
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    const seconds = Math.max(0, ms / 1000)
    return `${seconds.toFixed(2)}秒`
  }
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${String(seconds)}秒`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(minutes)}分${secs.toString().padStart(2, '0')}秒`
}

/**
 * 构建同步统计图表 HTML（完整仪表盘布局）
 *
 * 布局：
 * ┌─ 概览条（进度环 + 关键指标） ──────────────────────────┐
 * │  总条目  │  完成进度环  │  处理效率  │  耗时  │  速度   │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 图表区 ──────────────────────────────────────────────┐
 * │  ┌─ 环形分布图 ─┐  ┌─ 水平柱状图 ──────────────┐      │
 * │  │   🍩 SVG     │  │  ✅ 新增 ████████         │      │
 * │  │   图例       │  │  🔄 更新 ████            │      │
 * │  └──────────────┘  │  ❌ 删除 ██             │      │
 * │                    │  ⏭️ 无变更 ██████████     │      │
 * │                    │  ⚠️ 失败  █              │      │
 * │                    │  🔍 跳过  ███            │      │
 * │                    └──────────────────────────┘      │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 性能仪表盘 ────────────────────────────────────────┐
 * │  ⏱ 1分30秒  │  ⚡ 15/s  │  📈 44%  │  ✅ 120条/秒   │
 * └──────────────────────────────────────────────────────┘
 */
function buildSyncChartSection(
  result: GithubSyncResult,
  elapsedMs: number,
  avgSpeed: number,
  strategyLabel: string,
): string {
  const totalProcessed = result.added + result.updated + result.deleted
  const totalActive = totalProcessed + result.unchanged + result.failed
  const totalAll = totalActive + result.skipped

  // 各部分占比（基于 totalAll，包含 skipped）
  const pctOf = (v: number) => (totalAll > 0 ? (v / totalAll) * 100 : 0)
  const addedPct = pctOf(result.added)
  const updatedPct = pctOf(result.updated)
  const deletedPct = pctOf(result.deleted)
  const unchangedPct = pctOf(result.unchanged)
  const failedPct = pctOf(result.failed)
  const skippedPct = pctOf(result.skipped)

  // 完成度（已处理/总计，不含跳过）
  const completionPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 效率（处理数/活跃总数）
  const efficiencyPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 环形图 SVG
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const seg = (pct: number) => (pct / 100) * circumference

  // 耗时格式化
  const elapsedString = formatDuration(elapsedMs)
  const speedString = avgSpeed > 0 ? avgSpeed.toFixed(1) : '--'

  // 预计剩余
  const remaining = totalActive - totalProcessed
  const etaMs = avgSpeed > 0 && remaining > 0 ? Math.round((remaining / avgSpeed) * 1000) : 0

  // 概览卡片数据
  const overviewCards = [
    {
      label: '远程总条目',
      value: result.remoteTotal,
      sub: `本地 ${String(totalAll)} 条`,
      icon: '📥',
      cls: 'bgm-overview-card-primary',
    },
    {
      label: '本次处理',
      value: totalProcessed,
      sub: `新增+更新+删除`,
      icon: '🔧',
      cls: 'bgm-overview-card-success',
    },
    {
      label: '失败',
      value: result.failed,
      sub: result.failed > 0 ? '需关注' : '无异常',
      icon: result.failed > 0 ? '⚠️' : '✅',
      cls: result.failed > 0 ? 'bgm-overview-card-warning' : 'bgm-overview-card-muted',
    },
  ]

  return `
    <!-- ===== 顶部概览条 ===== -->
    <div class="bgm-overview-bar">
      <!-- 左侧：概览卡片组 -->
      <div class="bgm-overview-cards">
        ${overviewCards
          .map(
            (c) => `
          <div class="bgm-overview-card ${c.cls}">
            <div class="bgm-overview-card-header">
              <span class="bgm-overview-icon">${c.icon}</span>
              <span class="bgm-overview-label">${c.label}</span>
            </div>
            <div class="bgm-overview-value">${String(c.value)}</div>
            <div class="bgm-overview-sub">${c.sub}</div>
          </div>
        `,
          )
          .join('')}
      </div>

      <!-- 右侧：完成度环 -->
      <div class="bgm-completion-ring">
        <svg viewBox="0 0 120 120" class="bgm-progress-svg">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface0, #313244)" stroke-width="10" />
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="${completionPct >= 90 ? 'var(--green, #a6e3a1)' : completionPct >= 50 ? 'var(--yellow, #f9e2af)' : 'var(--red, #f38ba8)'}"
            stroke-width="10"
            stroke-dasharray="${String((completionPct / 100) * 2 * Math.PI * 50)} ${String(2 * Math.PI * 50)}"
            stroke-dashoffset="${String(2 * Math.PI * 50 * 0.25)}"
            stroke-linecap="round"
            transform="rotate(-90 60 60)"
            class="bgm-progress-ring" />
        </svg>
        <div class="bgm-progress-center">
          <div class="bgm-progress-value">${String(completionPct)}%</div>
          <div class="bgm-progress-label">完成度</div>
        </div>
      </div>
    </div>

    <!-- ===== 图表区 ===== -->
    <div class="bgm-chart-container">
      <!-- 左侧：环形分布图 -->
      <div class="bgm-chart-left">
        <div class="bgm-donut-chart">
          <svg viewBox="0 0 140 140" class="bgm-donut-svg">
            <circle cx="70" cy="70" r="${String(radius)}" fill="none" stroke="var(--surface0, #313244)" stroke-width="14" />
            ${
              totalAll > 0
                ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--green, #a6e3a1)" stroke-width="14"
                stroke-dasharray="${String(seg(addedPct))} ${String(circumference)}"
                stroke-dashoffset="0"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--yellow, #f9e2af)" stroke-width="14"
                stroke-dasharray="${String(seg(updatedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-seg(addedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--red, #f38ba8)" stroke-width="14"
                stroke-dasharray="${String(seg(deletedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--overlay1, #7f849c)" stroke-width="14"
                stroke-dasharray="${String(seg(unchangedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              ${
                result.failed > 0
                  ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--peach, #fab387)" stroke-width="14"
                stroke-dasharray="${String(seg(failedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />`
                  : ''
              }
              ${
                result.skipped > 0
                  ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--lavender, #b4befe)" stroke-width="14"
                stroke-dasharray="${String(seg(skippedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct) + seg(failedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />`
                  : ''
              }
            `
                : ''
            }
          </svg>
          <div class="bgm-donut-center">
            <div class="bgm-donut-center-value">${String(totalProcessed)}</div>
            <div class="bgm-donut-center-label">已处理</div>
          </div>
        </div>
        <div class="bgm-chart-legend">
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--green, #a6e3a1)"></span>新增 ${String(result.added)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--yellow, #f9e2af)"></span>更新 ${String(result.updated)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--red, #f38ba8)"></span>删除 ${String(result.deleted)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--overlay1, #7f849c)"></span>无变更 ${String(result.unchanged)}</div>
          ${result.failed > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--peach, #fab387)"></span>失败 ${String(result.failed)}</div>` : ''}
          ${result.skipped > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--lavender, #b4befe)"></span>跳过 ${String(result.skipped)}</div>` : ''}
        </div>
      </div>

      <!-- 右侧：柱状图 -->
      <div class="bgm-chart-right">
        <div class="bgm-bar-chart">
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">✅ 新增</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-add" style="width:${String(addedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.added)}<span class="bgm-bar-pct">(${addedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔄 更新</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-update" style="width:${String(updatedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.updated)}<span class="bgm-bar-pct">(${updatedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">❌ 删除</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-delete" style="width:${String(deletedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.deleted)}<span class="bgm-bar-pct">(${deletedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⏭️ 无变更</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-unchanged" style="width:${String(unchangedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.unchanged)}<span class="bgm-bar-pct">(${unchangedPct.toFixed(0)}%)</span></span>
          </div>
          ${
            result.failed > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⚠️ 失败</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-fail" style="width:${String(failedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.failed)}<span class="bgm-bar-pct">(${failedPct.toFixed(0)}%)</span></span>
          </div>`
              : ''
          }
          ${
            result.skipped > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔍 跳过</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-skip" style="width:${String(skippedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(result.skipped)}<span class="bgm-bar-pct">(${skippedPct.toFixed(0)}%)</span></span>
          </div>`
              : ''
          }
        </div>
      </div>
    </div>

    <!-- ===== 性能仪表盘 ===== -->
    <div class="bgm-perf-dashboard">
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--blue, #89b4fa)" stroke-width="6"
              stroke-dasharray="${String((completionPct / 100) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⏱</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${elapsedString}</div>
          <div class="bgm-perg-label">总耗时</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--green, #a6e3a1)" stroke-width="6"
              stroke-dasharray="${String(Math.min(avgSpeed / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⚡</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${speedString}</div>
          <div class="bgm-perg-label">行/秒</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--peach, #fab387)" stroke-width="6"
              stroke-dasharray="${String((efficiencyPct / 100) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>📈</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${String(efficiencyPct)}%</div>
          <div class="bgm-perg-label">处理效率</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--sapphire, #74c7ec)" stroke-width="6"
              stroke-dasharray="${String(Math.min(totalProcessed / Math.max(elapsedMs / 1000, 1) / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>🔮</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${etaMs > 0 ? formatDuration(etaMs) : '完成'}</div>
          <div class="bgm-perg-label">预计剩余</div>
        </div>
      </div>
    </div>

    <!-- ===== 元信息栏 ===== -->
    <div class="bgm-meta-bar">
      <span class="bgm-meta-tag">🎯 ${escapeHtml(strategyLabel)}</span>
      <span class="bgm-meta-tag">📥 远程 ${String(result.remoteTotal)}</span>
      <span class="bgm-meta-tag">✅ 完成 ${String(completionPct)}%</span>
      ${result.skipped > 0 ? `<span class="bgm-meta-tag">🔍 跳过 ${String(result.skipped)}</span>` : ''}
      ${result.failed > 0 ? `<span class="bgm-meta-tag bgm-meta-tag-warn">⚠️ 失败 ${String(result.failed)}</span>` : ''}
    </div>
  `
}

/**
 * 显示同步完成增强结果弹窗
 *
 * @param options 同步结果选项
 */
export function showSyncResultDialog(options: SyncResultDialogOptions): void {
  const { result, elapsedMs, avgSpeed, strategyLabel, stopped, scrollToRow } = options

  // 移除旧对话框
  if (_resultDialog) {
    _clearEscHandler()
    _resultDialog.remove()
    _resultDialog = null
  }

  // 计算日期统计
  const dateStats = computeDateStatsFromSheet()

  // 创建弹窗
  const modal = document.createElement('div')
  modal.className = 'bgm-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'bgmResultTitle')

  // ── 构造弹窗内容 ──
  const icon = stopped ? '⏹️' : '✅'
  const title = stopped ? '同步已停止' : '同步完成'

  // 图表区域（替换原 statCards）
  const chartSection = buildSyncChartSection(result, elapsedMs, avgSpeed, strategyLabel)

  // 日期统计
  let dateHtml = ''
  if (dateStats.datedCount > 0) {
    dateHtml = `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">📅 开播日期统计</div>
        <div class="bgm-result-date-grid">
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最早开播</span>
            <span class="bgm-result-date-value">${dateStats.earliestDate ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最晚开播</span>
            <span class="bgm-result-date-value">${dateStats.latestDate ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最新季度</span>
            <span class="bgm-result-date-value">${dateStats.latestSeason ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">有日期条目</span>
            <span class="bgm-result-date-value">${String(dateStats.datedCount)}/${String(dateStats.totalCount)}</span>
          </div>
        </div>
      </div>`
  }

  const content = `
    <div class="bgm-modal-content">
      <div class="bgm-dialog-header">
        <span class="bgm-dialog-icon bgm-icon-success">${icon}</span>
        <span class="bgm-dialog-title" id="bgmResultTitle">${title}</span>
      </div>
      <div class="bgm-dialog-body">
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📊 数据统计</div>
          ${chartSection}
        </div>
        ${dateHtml}
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📋 操作</div>
          <div class="bgm-result-actions">
            <button id="bgmResultExportBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-primary">📥 导出 JSONL</button>
            <button id="bgmResultViewDetailsBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-default">📄 查看详情</button>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmResultCloseBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-success">确定</button>
      </div>
    </div>`

  modal.innerHTML = content
  document.body.appendChild(modal)
  _resultDialog = modal

  // ── 绑定事件 ──
  // 关闭按钮
  const closeButton = modal.querySelector<HTMLElement>('#bgmResultCloseBtn')
  closeButton?.addEventListener('click', () => {
    hideSyncResultDialog()
  })

  // 导出 JSONL
  const exportButton = modal.querySelector('#bgmResultExportBtn')
  exportButton?.addEventListener('click', () => {
    const originalText = exportButton.textContent
    const isSuccess = exportSheetToJsonlFile()
    if (isSuccess) {
      exportButton.textContent = '✅ 已导出'
      setTimeout(() => {
        exportButton.textContent = originalText
      }, 2000)
    } else {
      exportButton.textContent = '❌ 导出失败'
      setTimeout(() => {
        exportButton.textContent = originalText
      }, 2000)
    }
  })

  // 查看详情（打开同步记录表，或弹窗预览）
  const viewDetailsButton = modal.querySelector('#bgmResultViewDetailsBtn')
  viewDetailsButton?.addEventListener('click', () => {
    Promise.all([import('../sync/syncRecord.js'), import('../tools/config.js')])
      .then(([syncRecordModule, configModule]) => {
        const { getSyncRecordSheetIfExists, openSyncRecordSheet } = syncRecordModule
        const { getSyncRecordEnabled } = configModule

        const isSyncEnabled = getSyncRecordEnabled()
        const isSheetExists = getSyncRecordSheetIfExists() !== null

        if (isSyncEnabled && isSheetExists) {
          openSyncRecordSheet(scrollToRow)
        } else {
          showSyncDetailPreviewDialog({
            result,
            elapsedMs,
            avgSpeed,
            strategyLabel,
            scrollToRow,
            syncEnabled: isSyncEnabled,
            sheetExists: isSheetExists,
          })
        }
      })
      .catch(() => {
        bgmLog(LOG_LEVELS.WARN, '[syncResultDialog] 无法加载同步记录模块')
        showSyncDetailPreviewDialog({
          result,
          elapsedMs,
          avgSpeed,
          strategyLabel,
          scrollToRow,
          syncEnabled: false,
          sheetExists: false,
        })
      })
  })

  // ESC 关闭
  _resultDialogEscHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      hideSyncResultDialog()
    }
  }
  document.addEventListener('keydown', _resultDialogEscHandler)

  // 焦点管理
  closeButton?.focus()

  // 显示弹窗
  modal.style.display = 'flex'
}

/** 隐藏同步结果弹窗 */
export function hideSyncResultDialog(): void {
  if (_resultDialog) {
    _resultDialog.style.display = 'none'
    _resultDialog.remove()
    _resultDialog = null
  }
  _clearEscHandler()
}

// ========== 同步详情预览弹窗 ==========

interface SyncDetailPreviewOptions {
  result: GithubSyncResult
  elapsedMs: number
  avgSpeed: number
  strategyLabel: string
  scrollToRow?: number | undefined
  syncEnabled: boolean
  sheetExists: boolean
}

let _previewDialog: HTMLElement | null = null
let _previewDialogEscHandler: ((e: KeyboardEvent) => void) | null = null

/**
 * 渲染同步明细折叠表格
 * @param details 同步明细条目数组
 * @returns 折叠区域 HTML 字符串
 */
function renderDetailSection(details: GithubSyncDetailItem[] | undefined): string {
  if (!details || details.length === 0) return ''
  return `
    <div class="bgm-preview-detail-table">
      <div class="bgm-preview-detail-table-title">📑 同步明细（${String(details.length)} 条）</div>
      ${renderSyncDetailTable(details)}
    </div>
  `
}

/**
 * 显示同步详情预览弹窗（当同步记录表不存在或未启用时使用）
 */
function showSyncDetailPreviewDialog(options: SyncDetailPreviewOptions): void {
  const { result, elapsedMs, avgSpeed, strategyLabel, scrollToRow, syncEnabled, sheetExists } =
    options

  // 移除旧弹窗
  if (_previewDialog) {
    _clearPreviewEscHandler()
    _previewDialog.remove()
    _previewDialog = null
  }

  // 状态提示
  let statusNotice = ''
  if (!syncEnabled) {
    statusNotice = `
      <div class="bgm-preview-notice notice-warning">
        <span class="notice-icon">⚠️</span>
        <span>同步记录功能未启用，无法打开同步记录表。您可以在设置中启用后查看完整同步历史。</span>
      </div>`
  } else if (!sheetExists) {
    statusNotice = `
      <div class="bgm-preview-notice notice-info">
        <span class="notice-icon">ℹ️</span>
        <span>同步记录表尚未创建，这是首次同步。启用同步记录后可在工作表中查看完整历史。</span>
      </div>`
  }

  // 使用统一的图表构建函数
  const chartSection = buildSyncChartSection(result, elapsedMs, avgSpeed, strategyLabel)

  const modal = document.createElement('div')
  modal.className = 'bgm-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'bgmPreviewTitle')

  const content = `
    <div class="bgm-modal-content bgm-preview-dialog">
      <div class="bgm-dialog-header">
        <span class="bgm-dialog-icon bgm-icon-info">📄</span>
        <span class="bgm-dialog-title" id="bgmPreviewTitle">同步详情预览</span>
      </div>
      <div class="bgm-dialog-body">
        ${statusNotice}
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📊 同步统计</div>
          ${chartSection}
        </div>
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📋 详细信息</div>
          <div class="bgm-preview-detail-list">
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">远程总条目</span>
              <span class="bgm-preview-detail-value">${String(result.remoteTotal)}</span>
            </div>
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">跳过条目</span>
              <span class="bgm-preview-detail-value">${String(result.skipped)}</span>
            </div>
            ${
              scrollToRow !== undefined
                ? `
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">起始行号</span>
              <span class="bgm-preview-detail-value">第 ${String(scrollToRow)} 行</span>
            </div>`
                : ''
            }
          </div>
          ${renderDetailSection(result.details)}
        </div>
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">💡 操作建议</div>
          <div class="bgm-preview-suggestions">
            ${
              !syncEnabled
                ? `
              <p>• 启用同步记录功能，可在 Excel 中查看每次同步的详细历史，支持按 SID 去重和颜色标记。</p>`
                : ''
            }
            ${
              !sheetExists && syncEnabled
                ? `
              <p>• 同步记录表已启用但尚未创建，下次同步时会自动创建。</p>`
                : ''
            }
            <p>• 点击"📥 导出 JSONL"可将当前 Excel 数据导出为 JSONL 文件。</p>
            <p>• 使用"📤 导出配置"可备份当前设置，方便迁移和恢复。</p>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmPreviewCloseBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-success">确定</button>
      </div>
    </div>
  `

  modal.innerHTML = content
  document.body.appendChild(modal)
  _previewDialog = modal

  // 关闭按钮
  const closeButton = modal.querySelector<HTMLElement>('#bgmPreviewCloseBtn')
  closeButton?.addEventListener('click', () => {
    hideSyncDetailPreviewDialog()
  })

  // ESC 关闭
  _previewDialogEscHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      hideSyncDetailPreviewDialog()
    }
  }
  document.addEventListener('keydown', _previewDialogEscHandler)

  // 点击遮罩关闭
  modal.addEventListener('click', (e: MouseEvent) => {
    if (e.target === modal) {
      hideSyncDetailPreviewDialog()
    }
  })

  // 焦点管理
  closeButton?.focus()

  // 显示弹窗
  modal.style.display = 'flex'
}

function _clearPreviewEscHandler(): void {
  if (_previewDialogEscHandler) {
    document.removeEventListener('keydown', _previewDialogEscHandler)
    _previewDialogEscHandler = null
  }
}

/** 隐藏同步详情预览弹窗 */
function hideSyncDetailPreviewDialog(): void {
  if (_previewDialog) {
    _previewDialog.style.display = 'none'
    _previewDialog.remove()
    _previewDialog = null
  }
  _clearPreviewEscHandler()
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

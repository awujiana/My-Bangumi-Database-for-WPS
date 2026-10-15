/**
 * @fileoverview 同步统计仪表盘（概览条 + 环形分布图 + 柱状图 + 性能盘 + 元信息栏）
 * @module ui/syncStatsChart
 * @description `ui/dialog.ts`（进度弹窗完成态）与 `ui/sync-result-dialog.ts`（结果弹窗）
 *              此前各有一份 ~300 行**逐字重复**的仪表盘渲染，连配色阈值和 SVG 参数都一样，
 *              改一处就会在另一处静默漂移。收敛为一份，两处只负责组装数据。
 *
 *              入参统一用 `SyncProgressStats`（已下沉到 `core/types.ts` 的纯数据形状），
 *              因此 sync 层与 ui/handlers 也能复用，不必为了一个数据形状反向依赖 UI。
 *
 *              耗时格式化复用 `components/progress.ts` 的 canonical 实现（999ms 截断为
 *              `0.99秒`、整分不补 `00秒`）；此前 `sync-result-dialog.ts` 自带的是
 *              漂移版（四舍五入成 `1.00秒`、整分补 `00秒`）。
 */

import type { SyncProgressStats } from '../core/types.js'
import { escapeHtml } from '../tools/string-utilities.js'
import { formatDuration } from './components/progress.js'

/** 图表需要的计数部分（`GithubSyncResult` 与 `SyncProgressStats` 都满足） */
export type SyncStatsCounters = Pick<
  SyncProgressStats,
  'added' | 'updated' | 'deleted' | 'unchanged' | 'failed' | 'skipped' | 'remoteTotal'
>

/**
 * 把「同步结果计数 + 运行期指标」组装成图表模型
 *
 * 结果弹窗拿到的是 `GithubSyncResult`，还要带上耗时/速度/策略文案，这里统一收口。
 */
export function toSyncStatsChartModel(
  result: SyncStatsCounters,
  elapsedMs: number,
  avgSpeed: number,
  strategyLabel: string,
): SyncProgressStats {
  return {
    added: result.added,
    updated: result.updated,
    deleted: result.deleted,
    unchanged: result.unchanged,
    failed: result.failed,
    skipped: result.skipped,
    remoteTotal: result.remoteTotal,
    elapsedMs,
    avgSpeed,
    strategyLabel,
  }
}

/**
 * 渲染同步统计图表（完整仪表盘布局，与 syncResultDialog 风格一致）
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
 * │  ⏱ 1分30秒  │  ⚡️ 15/s  │  📈 44%  │  🔮 预计剩余  │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 元信息栏 ──────────────────────────────────────────┐
 * │  🎯 策略  📥 远程  ✅ 完成  🔍 跳过  ⚠️ 失败        │
 * └──────────────────────────────────────────────────────┘
 */
export function renderSyncStatsChart(stats: SyncProgressStats): string {
  const totalProcessed = stats.added + stats.updated + stats.deleted
  const totalActive = totalProcessed + stats.unchanged + stats.failed
  const totalAll = totalActive + stats.skipped

  // 各部分占比（基于 totalAll，包含 skipped）
  const pctOf = (v: number): number => (totalAll > 0 ? (v / totalAll) * 100 : 0)
  const addedPct = pctOf(stats.added)
  const updatedPct = pctOf(stats.updated)
  const deletedPct = pctOf(stats.deleted)
  const unchangedPct = pctOf(stats.unchanged)
  const failedPct = pctOf(stats.failed)
  const skippedPct = pctOf(stats.skipped)

  // 完成度（已处理/总计，不含跳过）
  const completionPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 环形图颜色：≥90 绿、≥50 黄、否则红
  let ringColor: string
  if (completionPct >= 90) {
    ringColor = 'var(--green, #a6e3a1)'
  } else if (completionPct >= 50) {
    ringColor = 'var(--yellow, #f9e2af)'
  } else {
    ringColor = 'var(--red, #f38ba8)'
  }

  // 效率（处理数/活跃总数）
  const efficiencyPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 环形图 SVG 参数
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const seg = (pct: number): number => (pct / 100) * circumference

  // 耗时格式化
  const elapsedString = formatDuration(stats.elapsedMs)
  const speedString = stats.avgSpeed > 0 ? stats.avgSpeed.toFixed(1) : '--'

  // 预计剩余
  const remaining = totalActive - totalProcessed
  const etaMs =
    stats.avgSpeed > 0 && remaining > 0 ? Math.round((remaining / stats.avgSpeed) * 1000) : 0

  // 概览卡片数据
  const overviewCards = [
    {
      label: '远程总条目',
      value: stats.remoteTotal,
      sub: `本地 ${String(totalAll)} 条`,
      icon: '📥',
      cls: 'bgm-overview-card-primary',
    },
    {
      label: '本次处理',
      value: totalProcessed,
      sub: '新增+更新+删除',
      icon: '🔧',
      cls: 'bgm-overview-card-success',
    },
    {
      label: '失败',
      value: stats.failed,
      sub: stats.failed > 0 ? '需关注' : '无异常',
      icon: stats.failed > 0 ? '⚠️' : '✅',
      cls: stats.failed > 0 ? 'bgm-overview-card-warning' : 'bgm-overview-card-muted',
    },
  ]

  return `
    <!-- ===== 顶部概览条 ===== -->
    <div class="bgm-overview-bar">
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
      <div class="bgm-completion-ring">
        <svg viewBox="0 0 120 120" class="bgm-progress-svg">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface0, #313244)" stroke-width="10" />
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="${ringColor}"
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
                stats.failed > 0
                  ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--peach, #fab387)" stroke-width="14"
                stroke-dasharray="${String(seg(failedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />`
                  : ''
              }
              ${
                stats.skipped > 0
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
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--green, #a6e3a1)"></span>新增 ${String(stats.added)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--yellow, #f9e2af)"></span>更新 ${String(stats.updated)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--red, #f38ba8)"></span>删除 ${String(stats.deleted)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--overlay1, #7f849c)"></span>无变更 ${String(stats.unchanged)}</div>
          ${stats.failed > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--peach, #fab387)"></span>失败 ${String(stats.failed)}</div>` : ''}
          ${stats.skipped > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--lavender, #b4befe)"></span>跳过 ${String(stats.skipped)}</div>` : ''}
        </div>
      </div>

      <div class="bgm-chart-right">
        <div class="bgm-bar-chart">
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">✅ 新增</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-add" style="width:${String(addedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.added)}<span class="bgm-bar-pct">(${addedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔄 更新</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-update" style="width:${String(updatedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.updated)}<span class="bgm-bar-pct">(${updatedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">❌ 删除</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-delete" style="width:${String(deletedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.deleted)}<span class="bgm-bar-pct">(${deletedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⏭️ 无变更</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-unchanged" style="width:${String(unchangedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.unchanged)}<span class="bgm-bar-pct">(${unchangedPct.toFixed(0)}%)</span></span>
          </div>
          ${
            stats.failed > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⚠️ 失败</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-fail" style="width:${String(failedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.failed)}<span class="bgm-bar-pct">(${failedPct.toFixed(0)}%)</span></span>
          </div>`
              : ''
          }
          ${
            stats.skipped > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔍 跳过</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-skip" style="width:${String(skippedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.skipped)}<span class="bgm-bar-pct">(${skippedPct.toFixed(0)}%)</span></span>
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
              stroke-dasharray="${String(Math.min(stats.avgSpeed / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⚡️</span></div>
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
              stroke-dasharray="${String(Math.min(totalProcessed / Math.max(stats.elapsedMs / 1000, 1) / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
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
      <span class="bgm-meta-tag">🎯 ${escapeHtml(stats.strategyLabel)}</span>
      <span class="bgm-meta-tag">📥 远程 ${String(stats.remoteTotal)}</span>
      <span class="bgm-meta-tag">✅ 完成 ${String(completionPct)}%</span>
      ${stats.skipped > 0 ? `<span class="bgm-meta-tag">🔍 跳过 ${String(stats.skipped)}</span>` : ''}
      ${stats.failed > 0 ? `<span class="bgm-meta-tag bgm-meta-tag-warn">⚠️ 失败 ${String(stats.failed)}</span>` : ''}
    </div>
  `
}

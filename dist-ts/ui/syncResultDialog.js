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
import { LOG_LEVELS } from '../core/constants.js';
import { exportSheetToJsonlFile } from '../sync/exportJsonl.js';
import { extractSubjectId } from '../sync/pureUtils.js';
import { getDataSheet, findHeaderRow, getColumnMap, getLastRow, getCellValue, trim, } from '../tools/util/index.js';
import { bgmLog } from '../tools/util.js';
// ========== 日期统计计算 ==========
/**
 * 从日期字符串推断季度
 * 1-3月 → 冬，4-6月 → 春，7-9月 → 夏，10-12月 → 秋
 */
function getSeasonFromDate(dateStr) {
    const match = dateStr.match(/^(\d{4})[-/.](\d{1,2})/);
    if (!match)
        return null;
    const year = match[1];
    const month = parseInt(match[2], 10);
    const seasonMap = {
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
    };
    const season = seasonMap[month];
    if (!season)
        return null;
    return `${year}年${month}月新番`;
}
/**
 * 从 Excel 工作表中计算开播日期统计
 *
 * 遍历数据行，读取「开播日期」列，计算最早/最晚日期和最新季度。
 * 支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 格式。
 *
 * @returns 日期统计信息
 */
export function computeDateStatsFromSheet() {
    const stats = {
        earliestDate: null,
        latestDate: null,
        latestSeason: null,
        datedCount: 0,
        totalCount: 0,
    };
    const ws = getDataSheet();
    if (!ws)
        return stats;
    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    if (!colMap.has('Bangumi_URL') || !colMap.has('开播日期')) {
        return stats;
    }
    const dateCol = colMap.get('开播日期');
    const startRow = headerRow + 1;
    let earliest = null;
    let latest = null;
    let datedCount = 0;
    let totalCount = 0;
    for (let row = startRow; row <= lastRow; row++) {
        const url = trim(getCellValue(ws, row, colMap.get('Bangumi_URL')));
        if (!url)
            continue;
        const sid = extractSubjectId(url);
        if (!sid)
            continue;
        totalCount++;
        const dateStr = trim(getCellValue(ws, row, dateCol));
        if (!dateStr)
            continue;
        datedCount++;
        // 标准化日期：移除分隔符，用于比较
        const normalized = dateStr.replace(/[/.]/g, '-');
        const dateMatch = normalized.match(/^\d{4}-\d{1,2}-\d{1,2}$/);
        if (!dateMatch)
            continue;
        if (earliest === null || normalized < earliest)
            earliest = normalized;
        if (latest === null || normalized > latest)
            latest = normalized;
    }
    stats.earliestDate = earliest;
    stats.latestDate = latest;
    stats.datedCount = datedCount;
    stats.totalCount = totalCount;
    if (latest) {
        stats.latestSeason = getSeasonFromDate(latest);
    }
    return stats;
}
// ========== 增强结果弹窗 ==========
let _resultDialog = null;
let _resultDialogEscHandler = null;
/** 清理 ESC 监听器 */
function _clearEscHandler() {
    if (_resultDialogEscHandler) {
        document.removeEventListener('keydown', _resultDialogEscHandler);
        _resultDialogEscHandler = null;
    }
}
/**
 * 计算格式化耗时字符串
 */
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
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
function buildSyncChartSection(result, elapsedMs, avgSpeed, strategyLabel) {
    const totalProcessed = result.added + result.updated + result.deleted;
    const totalActive = totalProcessed + result.unchanged + result.failed;
    const totalAll = totalActive + result.skipped;
    // 各部分占比（基于 totalAll，包含 skipped）
    const pctOf = (v) => totalAll > 0 ? (v / totalAll) * 100 : 0;
    const addedPct = pctOf(result.added);
    const updatedPct = pctOf(result.updated);
    const deletedPct = pctOf(result.deleted);
    const unchangedPct = pctOf(result.unchanged);
    const failedPct = pctOf(result.failed);
    const skippedPct = pctOf(result.skipped);
    // 完成度（已处理/总计，不含跳过）
    const completionPct = totalActive > 0
        ? Math.round((totalProcessed / totalActive) * 100)
        : 0;
    // 效率（处理数/活跃总数）
    const efficiencyPct = totalActive > 0
        ? Math.round((totalProcessed / totalActive) * 100)
        : 0;
    // 环形图 SVG
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const seg = (pct) => (pct / 100) * circumference;
    // 耗时格式化
    const elapsedStr = formatDuration(elapsedMs);
    const speedStr = avgSpeed > 0 ? avgSpeed.toFixed(1) : '--';
    // 预计剩余
    const remaining = totalActive - totalProcessed;
    const etaMs = avgSpeed > 0 && remaining > 0
        ? Math.round((remaining / avgSpeed) * 1000)
        : 0;
    // 概览卡片数据
    const overviewCards = [
        {
            label: '远程总条目',
            value: result.remoteTotal,
            sub: `本地 ${totalAll} 条`,
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
    ];
    return `
    <!-- ===== 顶部概览条 ===== -->
    <div class="bgm-overview-bar">
      <!-- 左侧：概览卡片组 -->
      <div class="bgm-overview-cards">
        ${overviewCards.map(c => `
          <div class="bgm-overview-card ${c.cls}">
            <div class="bgm-overview-card-header">
              <span class="bgm-overview-icon">${c.icon}</span>
              <span class="bgm-overview-label">${c.label}</span>
            </div>
            <div class="bgm-overview-value">${c.value}</div>
            <div class="bgm-overview-sub">${c.sub}</div>
          </div>
        `).join('')}
      </div>

      <!-- 右侧：完成度环 -->
      <div class="bgm-completion-ring">
        <svg viewBox="0 0 120 120" class="bgm-progress-svg">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface0, #313244)" stroke-width="10" />
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="${completionPct >= 90 ? 'var(--green, #a6e3a1)' : completionPct >= 50 ? 'var(--yellow, #f9e2af)' : 'var(--red, #f38ba8)'}"
            stroke-width="10"
            stroke-dasharray="${(completionPct / 100) * 2 * Math.PI * 50} ${2 * Math.PI * 50}"
            stroke-dashoffset="${2 * Math.PI * 50 * 0.25}"
            stroke-linecap="round"
            transform="rotate(-90 60 60)"
            class="bgm-progress-ring" />
        </svg>
        <div class="bgm-progress-center">
          <div class="bgm-progress-value">${completionPct}%</div>
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
            <circle cx="70" cy="70" r="${radius}" fill="none" stroke="var(--surface0, #313244)" stroke-width="14" />
            ${totalAll > 0 ? `
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--green, #a6e3a1)" stroke-width="14"
                stroke-dasharray="${seg(addedPct)} ${circumference}"
                stroke-dashoffset="0"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--yellow, #f9e2af)" stroke-width="14"
                stroke-dasharray="${seg(updatedPct)} ${circumference}"
                stroke-dashoffset="${-seg(addedPct)}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--red, #f38ba8)" stroke-width="14"
                stroke-dasharray="${seg(deletedPct)} ${circumference}"
                stroke-dashoffset="${-(seg(addedPct) + seg(updatedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--overlay1, #7f849c)" stroke-width="14"
                stroke-dasharray="${seg(unchangedPct)} ${circumference}"
                stroke-dashoffset="${-(seg(addedPct) + seg(updatedPct) + seg(deletedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              ${result.failed > 0 ? `
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--peach, #fab387)" stroke-width="14"
                stroke-dasharray="${seg(failedPct)} ${circumference}"
                stroke-dashoffset="${-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />` : ''}
              ${result.skipped > 0 ? `
              <circle cx="70" cy="70" r="${radius}" fill="none"
                stroke="var(--lavender, #b4befe)" stroke-width="14"
                stroke-dasharray="${seg(skippedPct)} ${circumference}"
                stroke-dashoffset="${-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct) + seg(failedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />` : ''}
            ` : ''}
          </svg>
          <div class="bgm-donut-center">
            <div class="bgm-donut-center-value">${totalProcessed}</div>
            <div class="bgm-donut-center-label">已处理</div>
          </div>
        </div>
        <div class="bgm-chart-legend">
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--green, #a6e3a1)"></span>新增 ${result.added}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--yellow, #f9e2af)"></span>更新 ${result.updated}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--red, #f38ba8)"></span>删除 ${result.deleted}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--overlay1, #7f849c)"></span>无变更 ${result.unchanged}</div>
          ${result.failed > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--peach, #fab387)"></span>失败 ${result.failed}</div>` : ''}
          ${result.skipped > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--lavender, #b4befe)"></span>跳过 ${result.skipped}</div>` : ''}
        </div>
      </div>

      <!-- 右侧：柱状图 -->
      <div class="bgm-chart-right">
        <div class="bgm-bar-chart">
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">✅ 新增</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-add" style="width:${addedPct}%"></div></div>
            <span class="bgm-bar-value">${result.added}<span class="bgm-bar-pct">(${addedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔄 更新</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-update" style="width:${updatedPct}%"></div></div>
            <span class="bgm-bar-value">${result.updated}<span class="bgm-bar-pct">(${updatedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">❌ 删除</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-delete" style="width:${deletedPct}%"></div></div>
            <span class="bgm-bar-value">${result.deleted}<span class="bgm-bar-pct">(${deletedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⏭️ 无变更</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-unchanged" style="width:${unchangedPct}%"></div></div>
            <span class="bgm-bar-value">${result.unchanged}<span class="bgm-bar-pct">(${unchangedPct.toFixed(0)}%)</span></span>
          </div>
          ${result.failed > 0 ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⚠️ 失败</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-fail" style="width:${failedPct}%"></div></div>
            <span class="bgm-bar-value">${result.failed}<span class="bgm-bar-pct">(${failedPct.toFixed(0)}%)</span></span>
          </div>` : ''}
          ${result.skipped > 0 ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔍 跳过</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-skip" style="width:${skippedPct}%"></div></div>
            <span class="bgm-bar-value">${result.skipped}<span class="bgm-bar-pct">(${skippedPct.toFixed(0)}%)</span></span>
          </div>` : ''}
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
              stroke-dasharray="${(completionPct / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}"
              stroke-dashoffset="${2 * Math.PI * 32 * 0.25}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⏱</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${elapsedStr}</div>
          <div class="bgm-perg-label">总耗时</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--green, #a6e3a1)" stroke-width="6"
              stroke-dasharray="${Math.min(avgSpeed / 50, 1) * 2 * Math.PI * 32} ${2 * Math.PI * 32}"
              stroke-dashoffset="${2 * Math.PI * 32 * 0.25}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⚡</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${speedStr}</div>
          <div class="bgm-perg-label">行/秒</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--peach, #fab387)" stroke-width="6"
              stroke-dasharray="${(efficiencyPct / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}"
              stroke-dashoffset="${2 * Math.PI * 32 * 0.25}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>📈</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${efficiencyPct}%</div>
          <div class="bgm-perg-label">处理效率</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--sapphire, #74c7ec)" stroke-width="6"
              stroke-dasharray="${Math.min((totalProcessed / Math.max(elapsedMs / 1000, 1)) / 50, 1) * 2 * Math.PI * 32} ${2 * Math.PI * 32}"
              stroke-dashoffset="${2 * Math.PI * 32 * 0.25}"
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
      <span class="bgm-meta-tag">📥 远程 ${result.remoteTotal}</span>
      <span class="bgm-meta-tag">✅ 完成 ${completionPct}%</span>
      ${result.skipped > 0 ? `<span class="bgm-meta-tag">🔍 跳过 ${result.skipped}</span>` : ''}
      ${result.failed > 0 ? `<span class="bgm-meta-tag bgm-meta-tag-warn">⚠️ 失败 ${result.failed}</span>` : ''}
    </div>
  `;
}
/**
 * 显示同步完成增强结果弹窗
 *
 * @param options 同步结果选项
 */
export function showSyncResultDialog(options) {
    const { result, elapsedMs, avgSpeed, strategyLabel, stopped, scrollToRow } = options;
    // 移除旧对话框
    if (_resultDialog) {
        _clearEscHandler();
        _resultDialog.remove();
        _resultDialog = null;
    }
    // 计算日期统计
    const dateStats = computeDateStatsFromSheet();
    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'bgm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bgmResultTitle');
    // ── 构造弹窗内容 ──
    const icon = stopped ? '⏹️' : '✅';
    const title = stopped ? '同步已停止' : '同步完成';
    // 图表区域（替换原 statCards）
    const chartSection = buildSyncChartSection(result, elapsedMs, avgSpeed, strategyLabel);
    // 日期统计
    let dateHtml = '';
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
            <span class="bgm-result-date-value">${dateStats.datedCount}/${dateStats.totalCount}</span>
          </div>
        </div>
      </div>`;
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
            <button id="bgmResultExportBtn" type="button" class="bgm-btn bgm-btn-primary">📥 导出 JSONL</button>
            <button id="bgmResultViewDetailsBtn" type="button" class="bgm-btn bgm-btn-default">📄 查看详情</button>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmResultCloseBtn" type="button" class="bgm-btn bgm-btn-success">确定</button>
      </div>
    </div>`;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    _resultDialog = modal;
    // ── 绑定事件 ──
    // 关闭按钮
    const closeBtn = modal.querySelector('#bgmResultCloseBtn');
    closeBtn?.addEventListener('click', () => {
        hideSyncResultDialog();
    });
    // 导出 JSONL
    const exportBtn = modal.querySelector('#bgmResultExportBtn');
    exportBtn?.addEventListener('click', () => {
        const originalText = exportBtn.textContent;
        const success = exportSheetToJsonlFile();
        if (success) {
            exportBtn.textContent = '✅ 已导出';
            setTimeout(() => {
                if (exportBtn)
                    exportBtn.textContent = originalText;
            }, 2000);
        }
        else {
            exportBtn.textContent = '❌ 导出失败';
            setTimeout(() => {
                if (exportBtn)
                    exportBtn.textContent = originalText;
            }, 2000);
        }
    });
    // 查看详情（打开同步记录表，或弹窗预览）
    const viewDetailsBtn = modal.querySelector('#bgmResultViewDetailsBtn');
    viewDetailsBtn?.addEventListener('click', () => {
        Promise.all([
            import('../sync/syncRecord.js'),
            import('../tools/config.js'),
        ])
            .then(([syncRecordMod, configMod]) => {
            const { getSyncRecordSheetIfExists, openSyncRecordSheet } = syncRecordMod;
            const { getSyncRecordEnabled } = configMod;
            const syncEnabled = getSyncRecordEnabled();
            const sheetExists = getSyncRecordSheetIfExists() !== null;
            if (syncEnabled && sheetExists) {
                openSyncRecordSheet(scrollToRow);
            }
            else {
                showSyncDetailPreviewDialog({
                    result,
                    elapsedMs,
                    avgSpeed,
                    strategyLabel,
                    scrollToRow,
                    syncEnabled,
                    sheetExists,
                });
            }
        })
            .catch(() => {
            bgmLog(LOG_LEVELS.WARN, '[syncResultDialog] 无法加载同步记录模块');
            showSyncDetailPreviewDialog({
                result,
                elapsedMs,
                avgSpeed,
                strategyLabel,
                scrollToRow,
                syncEnabled: false,
                sheetExists: false,
            });
        });
    });
    // ESC 关闭
    _resultDialogEscHandler = (e) => {
        if (e.key === 'Escape') {
            hideSyncResultDialog();
        }
    };
    document.addEventListener('keydown', _resultDialogEscHandler);
    // 焦点管理
    closeBtn?.focus();
    // 显示弹窗
    modal.style.display = 'flex';
}
/** 隐藏同步结果弹窗 */
export function hideSyncResultDialog() {
    if (_resultDialog) {
        _resultDialog.style.display = 'none';
        _resultDialog.remove();
        _resultDialog = null;
    }
    _clearEscHandler();
}
let _previewDialog = null;
let _previewDialogEscHandler = null;
/**
 * 显示同步详情预览弹窗（当同步记录表不存在或未启用时使用）
 */
function showSyncDetailPreviewDialog(options) {
    const { result, elapsedMs, avgSpeed, strategyLabel, scrollToRow, syncEnabled, sheetExists } = options;
    // 移除旧弹窗
    if (_previewDialog) {
        _clearPreviewEscHandler();
        _previewDialog.remove();
        _previewDialog = null;
    }
    // 状态提示
    let statusNotice = '';
    if (!syncEnabled) {
        statusNotice = `
      <div class="bgm-preview-notice notice-warning">
        <span class="notice-icon">⚠️</span>
        <span>同步记录功能未启用，无法打开同步记录表。您可以在设置中启用后查看完整同步历史。</span>
      </div>`;
    }
    else if (!sheetExists) {
        statusNotice = `
      <div class="bgm-preview-notice notice-info">
        <span class="notice-icon">ℹ️</span>
        <span>同步记录表尚未创建，这是首次同步。启用同步记录后可在工作表中查看完整历史。</span>
      </div>`;
    }
    // 使用统一的图表构建函数
    const chartSection = buildSyncChartSection(result, elapsedMs, avgSpeed, strategyLabel);
    const modal = document.createElement('div');
    modal.className = 'bgm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bgmPreviewTitle');
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
              <span class="bgm-preview-detail-value">${result.remoteTotal}</span>
            </div>
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">跳过条目</span>
              <span class="bgm-preview-detail-value">${result.skipped}</span>
            </div>
            ${scrollToRow !== undefined ? `
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">起始行号</span>
              <span class="bgm-preview-detail-value">第 ${scrollToRow} 行</span>
            </div>` : ''}
          </div>
        </div>
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">💡 操作建议</div>
          <div class="bgm-preview-suggestions">
            ${!syncEnabled ? `
              <p>• 启用同步记录功能，可在 Excel 中查看每次同步的详细历史，支持按 SID 去重和颜色标记。</p>` : ''}
            ${!sheetExists && syncEnabled ? `
              <p>• 同步记录表已启用但尚未创建，下次同步时会自动创建。</p>` : ''}
            <p>• 点击"📥 导出 JSONL"可将当前 Excel 数据导出为 JSONL 文件。</p>
            <p>• 使用"📤 导出配置"可备份当前设置，方便迁移和恢复。</p>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmPreviewCloseBtn" type="button" class="bgm-btn bgm-btn-success">确定</button>
      </div>
    </div>
  `;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    _previewDialog = modal;
    // 关闭按钮
    const closeBtn = modal.querySelector('#bgmPreviewCloseBtn');
    closeBtn?.addEventListener('click', () => {
        hideSyncDetailPreviewDialog();
    });
    // ESC 关闭
    _previewDialogEscHandler = (e) => {
        if (e.key === 'Escape') {
            hideSyncDetailPreviewDialog();
        }
    };
    document.addEventListener('keydown', _previewDialogEscHandler);
    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            hideSyncDetailPreviewDialog();
        }
    });
    // 焦点管理
    closeBtn?.focus();
    // 显示弹窗
    modal.style.display = 'flex';
}
function _clearPreviewEscHandler() {
    if (_previewDialogEscHandler) {
        document.removeEventListener('keydown', _previewDialogEscHandler);
        _previewDialogEscHandler = null;
    }
}
/** 隐藏同步详情预览弹窗 */
function hideSyncDetailPreviewDialog() {
    if (_previewDialog) {
        _previewDialog.style.display = 'none';
        _previewDialog.remove();
        _previewDialog = null;
    }
    _clearPreviewEscHandler();
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

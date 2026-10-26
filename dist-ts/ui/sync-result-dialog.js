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
import { exportSheetToJsonlFile } from '../sync/export-jsonl.js';
import { extractSubjectId } from '../sync/pure-utilities.js';
import { bgmLog, getDataSheet, findHeaderRow, getColumnMap, getLastRow, getCellValue, readRangeValues, trim, } from '../tools/util/index.js';
import { escapeHtml } from '../tools/string-utilities.js';
import { renderSyncStatsChart, toSyncStatsChartModel } from './sync-stats-chart.js';
import { renderSyncDetailTable } from './dialog.js';
// ========== 日期统计计算 ==========
/**
 * 从日期字符串推断季度
 * 1-3月 → 冬，4-6月 → 春，7-9月 → 夏，10-12月 → 秋
 */
function getSeasonFromDate(dateString) {
    const match = /^(\d{4})[-/.](\d{1,2})/.exec(dateString);
    if (!match)
        return null;
    const year = match[1] ?? '';
    const month = Number(match[2] ?? '');
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
    return `${year}年${String(month)}月新番`;
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
    const worksheet = getDataSheet();
    if (!worksheet)
        return stats;
    const headerRow = findHeaderRow(worksheet) || 1;
    const lastRow = getLastRow(worksheet);
    const columnMap = getColumnMap(worksheet, headerRow);
    const dateColumn = columnMap.get('开播日期');
    const urlColumn = columnMap.get('Bangumi_URL');
    if (dateColumn === undefined || urlColumn === undefined) {
        return stats;
    }
    const startRow = headerRow + 1;
    let earliest = null;
    let latest = null;
    let datedCount = 0;
    let totalCount = 0;
    // 性能：按列整列读（2 次 IPC），替代 2N 次逐格读（5000 行 ≈ 1 万次）。
    // 只读这两列本身，不扩到列包围盒（避免把无关列一起拉回来）。
    const rowCount = lastRow - startRow + 1;
    // 批量读出来的是**逐行值**（不是列号），故命名 ColumnValues 与上面的 Column（列号）区分
    const urlColumnValues = readRangeValues(worksheet, startRow, lastRow, urlColumn, urlColumn);
    const dateColumnValues = readRangeValues(worksheet, startRow, lastRow, dateColumn, dateColumn);
    const canBatch = urlColumnValues.length === rowCount && dateColumnValues.length === rowCount;
    for (let row = startRow; row <= lastRow; row += 1) {
        const index = row - startRow;
        const url = trim(canBatch ? (urlColumnValues[index]?.[0] ?? '') : getCellValue(worksheet, row, urlColumn));
        if (url) {
            const subjectId = extractSubjectId(url);
            if (subjectId) {
                totalCount += 1;
                const dateString = trim(canBatch
                    ? (dateColumnValues[index]?.[0] ?? '')
                    : getCellValue(worksheet, row, dateColumn));
                if (dateString) {
                    datedCount += 1;
                    // 标准化日期：移除分隔符，用于比较
                    const normalized = dateString.replace(/[/.]/g, '-');
                    const dateMatch = /^\d{4}-\d{1,2}-\d{1,2}$/.exec(normalized);
                    if (dateMatch) {
                        if (earliest === null || normalized < earliest)
                            earliest = normalized;
                        if (latest === null || normalized > latest)
                            latest = normalized;
                    }
                }
            }
        }
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
    if (!_resultDialogEscHandler) {
        return;
    }
    document.removeEventListener('keydown', _resultDialogEscHandler);
    _resultDialogEscHandler = null;
}
/**
 * 计算格式化耗时字符串。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份）；此处保留同名转出，
 * 因为 `ts/index.ts` 从本模块对外导出 `formatDuration`（`ui/handlers/*` 经 barrel 使用）。
 */
export { formatDuration } from '../tools/util/duration.js';
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
    const chartSection = renderSyncStatsChart(toSyncStatsChartModel(result, elapsedMs, avgSpeed, strategyLabel));
    // 日期统计
    const dateHtml = dateStats.datedCount > 0
        ? `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">📅 开播日期统计</div>
        <div class="bgm-result-date-grid">
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最早开播</span>
            <span class="bgm-result-date-value">${escapeHtml(dateStats.earliestDate) || '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最晚开播</span>
            <span class="bgm-result-date-value">${escapeHtml(dateStats.latestDate) || '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最新季度</span>
            <span class="bgm-result-date-value">${escapeHtml(dateStats.latestSeason) || '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">有日期条目</span>
            <span class="bgm-result-date-value">${String(dateStats.datedCount)}/${String(dateStats.totalCount)}</span>
          </div>
        </div>
      </div>`
        : '';
    // 缺列提示：远程有数据、本地却没有对应表头的字段。
    // 写入侧 safeSet 遇缺失列会静默 return，不提示的话用户只会看到「同步成功但字段没进来」。
    // 除字段名外还给出补列方法（表头行加同名列、顺序不限），core 侧另有 toast 主动通知。
    const missingColumns = result.missingColumns ?? [];
    const missingHtml = missingColumns.length > 0
        ? `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">⚠️ 未同步字段（本地缺少表头）</div>
        <div class="bgm-result-date-label">以下字段远程有数据，但你的表里没有对应列，本次已跳过。补法：在数据表头行添加与下面同名的列（顺序不限、可插在任意位置），重新执行同步即可补上。</div>
        <div class="bgm-meta-bar">
          ${missingColumns
            .map((name) => `<span class="bgm-meta-tag bgm-meta-tag-warn">${escapeHtml(name)}</span>`)
            .join('')}
        </div>
      </div>`
        : '';
    // 远程空值提示：本地该列为空、远程对应字段也是空的 → 同步后仍然为空。
    // computeDiff 不能用远程空值抹掉本地数据（正确），但完全静默，用户会以为
    // 同步没生效。这里点明「远程也没数据」，避免误判成加载项有 bug。
    // 只进弹窗不弹 toast：数据仓库里这类字段本就普遍缺失（如完播日约 75% 无数据）。
    const remoteEmptyFields = (result.remoteEmptyFields ?? []).slice(0, 8);
    const remoteEmptyHtml = remoteEmptyFields.length > 0
        ? `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">ℹ️ 远程也无数据的字段</div>
        <div class="bgm-result-date-label">以下列你的表里是空的，远程数据里也没有值，所以本次没有写入（刻意不覆盖你的本地数据）。这不是同步失败——若需要补全，请到 Bangumi 条目页补充信息，等数据仓库下次更新。</div>
        <div class="bgm-meta-bar">
          ${remoteEmptyFields
            .map((item) => `<span class="bgm-meta-tag">${escapeHtml(item.name)} · ${String(item.count)} 条</span>`)
            .join('')}
        </div>
      </div>`
        : '';
    // 脏数据提示：分片拼接时缺合法 subjectId 的记录被跳过（与 parseJsonl 的「非法行
    // 不中断整体解析」同口径）。不提示的话用户只会看到「下载了 N 条、只同步了
    // 一部分」却说不出原因——这里显式给出跳过条数，指向数据源本身有脏数据。
    const skippedInvalidLines = result.skippedInvalidLines ?? 0;
    const skippedHtml = skippedInvalidLines > 0
        ? `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">⚠️ 数据源含非法记录</div>
        <div class="bgm-result-date-label">远程数据中有 ${String(skippedInvalidLines)} 条记录缺少合法 subjectId，已跳过。这不是你表格的问题，请检查数据源（仓库 / 文件）的 JSONL 内容。</div>
      </div>`
        : '';
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
        ${missingHtml}
        ${remoteEmptyHtml}
        ${skippedHtml}
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
    </div>`;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    _resultDialog = modal;
    // ── 绑定事件 ──
    // 关闭按钮
    const closeButton = modal.querySelector('#bgmResultCloseBtn');
    closeButton?.addEventListener('click', () => {
        hideSyncResultDialog();
    });
    // 导出 JSONL
    const exportButton = modal.querySelector('#bgmResultExportBtn');
    exportButton?.addEventListener('click', () => {
        const originalText = exportButton.textContent;
        const isSuccess = exportSheetToJsonlFile();
        exportButton.textContent = isSuccess ? '✅ 已导出' : '❌ 导出失败';
        setTimeout(() => {
            exportButton.textContent = originalText;
        }, 2000);
    });
    // 查看详情（打开同步记录表，或弹窗预览）
    const viewDetailsButton = modal.querySelector('#bgmResultViewDetailsBtn');
    viewDetailsButton?.addEventListener('click', () => {
        void (async () => {
            try {
                const [syncRecordModule, configModule] = await Promise.all([
                    import('../sync/sync-record.js'),
                    import('../tools/config.js'),
                ]);
                const { getSyncRecordSheetIfExists, openSyncRecordSheet } = syncRecordModule;
                const { isSyncRecordEnabled } = configModule;
                const isSyncEnabled = isSyncRecordEnabled();
                const isSheetExists = getSyncRecordSheetIfExists() !== null;
                if (isSyncEnabled && isSheetExists) {
                    openSyncRecordSheet(scrollToRow);
                }
                else {
                    showSyncDetailPreviewDialog({
                        result,
                        elapsedMs,
                        avgSpeed,
                        strategyLabel,
                        scrollToRow,
                        syncEnabled: isSyncEnabled,
                        sheetExists: isSheetExists,
                    });
                }
            }
            catch {
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
            }
        })();
    });
    // ESC 关闭
    _resultDialogEscHandler = (event) => {
        if (event.key === 'Escape') {
            hideSyncResultDialog();
        }
    };
    document.addEventListener('keydown', _resultDialogEscHandler);
    // 焦点管理
    closeButton?.focus();
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
 * 渲染同步明细折叠表格
 * @param details 同步明细条目数组
 * @returns 折叠区域 HTML 字符串
 */
function renderDetailSection(details) {
    if (!details || details.length === 0)
        return '';
    return `
    <div class="bgm-preview-detail-table">
      <div class="bgm-preview-detail-table-title">📑 同步明细（${String(details.length)} 条）</div>
      ${renderSyncDetailTable(details)}
    </div>
  `;
}
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
    const chartSection = renderSyncStatsChart(toSyncStatsChartModel(result, elapsedMs, avgSpeed, strategyLabel));
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
              <span class="bgm-preview-detail-value">${String(result.remoteTotal)}</span>
            </div>
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">跳过条目</span>
              <span class="bgm-preview-detail-value">${String(result.skipped)}</span>
            </div>
            ${scrollToRow === undefined
        ? ''
        : `
            <div class="bgm-preview-detail-item">
              <span class="bgm-preview-detail-label">起始行号</span>
              <span class="bgm-preview-detail-value">第 ${String(scrollToRow)} 行</span>
            </div>`}
          </div>
          ${renderDetailSection(result.details)}
        </div>
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">💡 操作建议</div>
          <div class="bgm-preview-suggestions">
            ${syncEnabled
        ? ''
        : `
              <p>• 启用同步记录功能，可在 Excel 中查看每次同步的详细历史，支持按 SID 去重和颜色标记。</p>`}
            ${!sheetExists && syncEnabled
        ? `
              <p>• 同步记录表已启用但尚未创建，下次同步时会自动创建。</p>`
        : ''}
            <p>• 点击"📥 导出 JSONL"可将当前 Excel 数据导出为 JSONL 文件。</p>
            <p>• 使用"📤 导出配置"可备份当前设置，方便迁移和恢复。</p>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmPreviewCloseBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-success">确定</button>
      </div>
    </div>
  `;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    _previewDialog = modal;
    // 关闭按钮
    const closeButton = modal.querySelector('#bgmPreviewCloseBtn');
    closeButton?.addEventListener('click', () => {
        hideSyncDetailPreviewDialog();
    });
    // ESC 关闭
    _previewDialogEscHandler = (event) => {
        if (event.key === 'Escape') {
            hideSyncDetailPreviewDialog();
        }
    };
    document.addEventListener('keydown', _previewDialogEscHandler);
    // 点击遮罩关闭
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            hideSyncDetailPreviewDialog();
        }
    });
    // 焦点管理
    closeButton?.focus();
    // 显示弹窗
    modal.style.display = 'flex';
}
function _clearPreviewEscHandler() {
    if (!_previewDialogEscHandler) {
        return;
    }
    document.removeEventListener('keydown', _previewDialogEscHandler);
    _previewDialogEscHandler = null;
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

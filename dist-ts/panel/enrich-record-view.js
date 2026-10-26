/**
 * @fileoverview 富化记录视图：打开/清空富化记录工作表，并渲染最近记录列表。
 * @module panel/enrich-record-view
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { getAllEnrichRecords, getOrCreateEnrichRecordSheet, clearEnrichRecords, } from '../sync/enrich-record.js';
import { sanitizeHtml } from '../tools/sanitize.js';
import { escapeHtml } from '../tools/string-utilities.js';
import { bgmLog, BGM, getApp } from '../tools/util/index.js';
import { safeGetElement } from './enrich-page-context.js';
// ========== 富化记录 ==========
export function openEnrichRecordSheet() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        const app = getApp();
        if (app?.ActiveWorkbook) {
            sheet.Activate();
            bgmLog(LOG_LEVELS.INFO, `[enrich] 已打开富化记录工作表: ${sheet.Name}`);
        }
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'openEnrichRecordSheet',
        });
        BGM.Dialog.error('错误', '无法打开富化记录工作表');
    }
}
export function clearRecords() {
    BGM.Dialog.confirm('确定要清除所有富化记录吗？此操作不可撤销。', (isConfirmed) => {
        if (!isConfirmed)
            return;
        try {
            clearEnrichRecords();
            loadRecentRecords();
            bgmLog(LOG_LEVELS.INFO, '[enrich] 富化记录已清除');
        }
        catch (error) {
            BGM.handleError(error, {
                showAlert: false,
                level: BGM.ErrorLevel.ERROR,
                context: 'clearRecords',
            });
        }
    });
}
export function loadRecentRecords() {
    try {
        const records = getAllEnrichRecords();
        const totalElement = safeGetElement('totalRecordCount');
        if (totalElement)
            totalElement.textContent = String(records.length);
        const successCount = records.filter((r) => r.action === 'fill' || r.action === 'append').length;
        const skipCount = records.filter((r) => r.action === 'skip').length;
        const errorCount = records.filter((r) => r.action === 'error').length;
        const successElement = safeGetElement('successRecordCount');
        if (successElement)
            successElement.textContent = String(successCount);
        const skipElement = safeGetElement('skipRecordCount');
        if (skipElement)
            skipElement.textContent = String(skipCount);
        const errorElement = safeGetElement('errorRecordCount');
        if (errorElement)
            errorElement.textContent = String(errorCount);
        const recordsContainer = safeGetElement('recentRecords');
        if (!recordsContainer)
            return;
        const recentRecords = records.slice(-10).reverse();
        if (recentRecords.length === 0) {
            recordsContainer.innerHTML = sanitizeHtml('<div class="record-empty">暂无记录</div>');
            return;
        }
        const recordsHtml = recentRecords
            .map((r) => {
            const actionClass = `record-action-${r.action}`;
            let actionText;
            switch (r.action) {
                case 'fill': {
                    actionText = '填充';
                    break;
                }
                case 'append': {
                    actionText = '追加';
                    break;
                }
                case 'skip': {
                    actionText = '跳过';
                    break;
                }
                default: {
                    actionText = '错误';
                    break;
                }
            }
            const name = escapeHtml(r.name);
            const field = escapeHtml(r.enrichedField);
            const updatedValue = escapeHtml(r.updatedValue);
            const time = escapeHtml(r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN') : '');
            return `
          <div class="record-item">
            <div class="record-header">
              <span class="record-name">${name}</span>
              <span class="record-action ${actionClass}">${actionText}</span>
            </div>
            <div class="record-detail">
              <span class="record-field">${field}</span>
              <span class="record-value">${updatedValue}</span>
            </div>
            <div class="record-time">${time}</div>
          </div>
        `;
        })
            .join('');
        recordsContainer.innerHTML = sanitizeHtml(recordsHtml);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 最近记录已加载: ${String(records.length)} 条`);
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'loadRecentRecords',
        });
    }
}

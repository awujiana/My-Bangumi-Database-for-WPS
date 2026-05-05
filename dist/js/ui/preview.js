/**
 * UI 预览模块
 * @module ui/preview
 * @description 数据预览、同步记录预览、详情模态框
 */

import { getApp, bgmLog, BGM, LOG_LEVELS } from '../util.js';
import { getCellValue } from '../util.js';
import { showAlert } from './dialog.js';
import { escapeHtml } from '../util.js';

// ========== 详细预览数据存储 ==========
let detailPreviewData = [];

// ========== 详细预览同步内容 ==========
/**
 * 预览同步内容
 */
export function previewSyncContent() {
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined') {
        setTimeout(previewSyncContent, 500);
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        showAlert("错误", "无法获取 WPS Application 对象�?);
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws = wb.Worksheets(sheetIndex);
    if (!ws) {
        showAlert("错误", "无法获取工作表！");
        return;
    }

    let startRow = parseInt(startRowInput?.value) || 2;
    let userEndRow = parseInt(endRowInput?.value) || 0;

    let headerRow = findHeaderRow(ws, startRow);
    if (headerRow === 0) {
        showAlert("提示", "未找到表头行�?);
        return;
    }

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showAlert("提示", "未找到【条目ID】或【Bangumi URL】列�?);
        return;
    }

    let lastRow = userEndRow > 0 ? userEndRow : getLastRow(ws);
    if (lastRow <= headerRow) {
        showAlert("提示", "没有可预览的数据�?);
        return;
    }

    detailPreviewData = [];
    showDetailModal();

    let rows = [];
    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            let nameVal = getCellValue(ws, i, colMap.name);
            let sidVal = getCellValue(ws, i, colMap.subjectId);
            let urlVal = getCellValue(ws, i, colMap.url);

            if (!nameVal && !sidVal && !urlVal) continue;

            let sid = sidVal;
            if (!sid && urlVal && typeof extractSubjectId === 'function') {
                sid = extractSubjectId(urlVal);
            }

            let currentStatus = "";
            if (colMap.status) {
                currentStatus = getCellValue(ws, i, colMap.status) || "";
            }

            let rate = "";
            if (colMap.rate) {
                rate = getCellValue(ws, i, colMap.rate) || "";
            }

            let tags = "";
            if (colMap.tags) {
                tags = getCellValue(ws, i, colMap.tags) || "";
            }

            rows.push({
                row: i,
                name: nameVal || "(无名�?",
                sid: sid,
                url: urlVal,
                currentStatus: currentStatus,
                rate: rate,
                tags: tags,
                previewPayload: buildPreviewPayload(ws, i, colMap)
            });

            detailPreviewData.push({
                row: i,
                name: nameVal,
                sid: sid,
                payload: buildPreviewPayload(ws, i, colMap)
            });
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "预览�?" + i + " 行出�? " + e.message);
        }
    }

    renderDetailList(rows);
    updateDetailCount(rows.length);
}

/**
 * 构建预览用的 payload
 */
export function buildPreviewPayload(ws, row, colMap) {
    if (typeof buildJsonPayload === 'function') {
        return buildJsonPayload(ws, row, colMap);
    }
    return "{}";
}

/**
 * 过滤预览项目
 */
export function filterDetailItems(filterText) {
    let items = document.querySelectorAll(".detail-item");
    filterText = filterText.toLowerCase();

    items.forEach(item => {
        let text = item.textContent.toLowerCase();
        item.style.display = text.includes(filterText) ? "block" : "none";
    });
}

/**
 * 更新详情计数
 */
export function updateDetailCount(count) {
    let countEl = document.getElementById("detailCount");
    if (countEl) {
        countEl.textContent = "�?" + count + " �?;
    }
}

/**
 * 显示详情模态框
 */
export function showDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "flex";
    }
}

/**
 * 关闭详情模态框
 */
export function closeDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "none";
    }
}

/**
 * 渲染详情列表
 */
export function renderDetailList(items) {
    let container = document.getElementById("detailList");
    if (!container) return;

    container.innerHTML = "";

    items.forEach((item) => {
        let div = document.createElement("div");
        div.className = "detail-item";
        div.innerHTML = `
            <div class="detail-row">
                <span class="detail-label">�?${item.row}</span>
                <span class="detail-name">${escapeHtml(item.name)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">SID:</span>
                <span class="detail-sid">${item.sid || "(无法提取)"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">当前状�?</span>
                <span class="detail-status">${item.currentStatus || "(�?"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">评分:</span>
                <span class="detail-rate">${item.rate || "(�?"}</span>
            </div>
            <div class="detail-preview">
                <pre>${escapeHtml(item.previewPayload)}</pre>
            </div>
        `;
        container.appendChild(div);
    });
}

/**
 * 查看同步记录详情
 */
export function viewSyncRecordDetail(rowIndex) {
    if (typeof getAllSyncRecords !== 'function') {
        showAlert("提示", "同步记录功能不可�?);
        return;
    }

    let records = getAllSyncRecords();
    if (rowIndex < 0 || rowIndex >= records.length) {
        return;
    }

    let record = records[rowIndex];
    let detail = `
        序号: ${record.index}
        同步时间: ${record.time}
        名称: ${record.name}
        URL: ${record.url}
        SID: ${record.sid}
        条目类型: ${record.type}
        同步次数: ${record.count}
        内容: ${record.content}
        状�? ${record.status}
        备注: ${record.comment}
    `;

    showAlert("同步记录详情", detail);
}

// ========== 向后兼容（挂载到 window�?=========
window.previewSyncContent = previewSyncContent;
window.buildPreviewPayload = buildPreviewPayload;
window.filterDetailItems = filterDetailItems;
window.updateDetailCount = updateDetailCount;
window.showDetailModal = showDetailModal;
window.closeDetailModal = closeDetailModal;
window.renderDetailList = renderDetailList;
window.viewSyncRecordDetail = viewSyncRecordDetail;
window.detailPreviewData = detailPreviewData;

/**
 * UI \u9884\u89C8\u6A21\u5757
 * @module ui/preview
 * @description \u6570\u636E\u9884\u89C8\u3001\u540C\u6B65\u8BB0\u5F55\u9884\u89C8\u3001\u8BE6\u60C5\u6A21\u6001\u6846
 */

import { getApp, bgmLog, BGM, LOG_LEVELS } from '../util.js';
import { getCellValue } from '../util.js';
import { showAlert } from './dialog.js';
import { escapeHtml } from '../util.js';

// ========== \u4E2D\u6587\u6587\u672C\u5E38\u91CF ==========
const _T = {
    error: '\u9519\u8BEF',
    cannotGetApp: '\u65E0\u6CD5\u83B7\u53D6 WPS Application \u5BF9\u8C61\uFF01',
    cannotGetSheet: '\u65E0\u6CD5\u83B7\u53D6\u5DE5\u4F5C\u8868\uFF01',
    hint: '\u63D0\u793A',
    noHeaderRow: '\u672A\u627E\u5230\u8868\u5934\u884C\uFF01',
    noSubjectIdOrUrl: '\u672A\u627E\u5230\u3010\u6761\u76EEID\u3011\u6216\u3010Bangumi URL\u3011\u5217\uFF01',
    noPreviewData: '\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u6570\u636E\uFF01',
    noName: '(\u65E0\u540D)',
    cannotExtract: '(\u65E0\u6CD5\u63D0\u53D6)',
    noData: '(\u65E0)',
    previewRowErr: '\u9884\u89C8\u7B2C',
    rowErr: '\u884C\u51FA\u9519: ',
    countPrefix: '\u5171',
    countSuffix: ' \u6761',
    syncRecordNotAvailable: '\u540C\u6B65\u8BB0\u5F55\u529F\u80FD\u4E0D\u53EF\u7528\uFF01',
    syncRecordDetail: '\u540C\u6B65\u8BB0\u5F55\u8BE6\u60C5',
    labelRow: '\u884C:',
    labelSid: 'SID:',
    labelCurrentStatus: '\u5F53\u524D\u72B6\u6001:',
    labelRate: '\u8BC4\u5206:',
    fieldIndex: '\u5E8F\u53F7: ',
    fieldTime: '\u540C\u6B65\u65F6\u95F4: ',
    fieldName: '\u540D\u79F0: ',
    fieldUrl: 'URL: ',
    fieldSid: 'SID: ',
    fieldType: '\u6761\u76EE\u7C7B\u578B: ',
    fieldCount: '\u540C\u6B65\u6B21\u6570: ',
    fieldContent: '\u5185\u5BB9: ',
    fieldStatus: '\u72B6\u6001: ',
    fieldComment: '\u5907\u6CE8: ',
};

// ========== \u8BE6\u7EC6\u9884\u89C8\u6570\u636E\u5B58\u50A8 ==========
let detailPreviewData = [];

// ========== \u8BE6\u7EC6\u9884\u89C8\u540C\u6B65\u5185\u5BB9 ==========
/**
 * \u9884\u89C8\u540C\u6B65\u5185\u5BB9
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
        showAlert(_T.error, _T.cannotGetApp);
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws = wb.Worksheets.Item(sheetIndex);
    if (!ws) {
        showAlert(_T.error, _T.cannotGetSheet);
        return;
    }

    let startRow = parseInt(startRowInput?.value) || 2;
    let userEndRow = parseInt(endRowInput?.value) || 0;

    let headerRow = findHeaderRow(ws, startRow);
    if (headerRow === 0) {
        showAlert(_T.hint, _T.noHeaderRow);
        return;
    }

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showAlert(_T.hint, _T.noSubjectIdOrUrl);
        return;
    }

    let lastRow = userEndRow > 0 ? userEndRow : getLastRow(ws);
    if (lastRow <= headerRow) {
        showAlert(_T.hint, _T.noPreviewData);
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
                name: nameVal || _T.noName,
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
            bgmLog(LOG_LEVELS.WARN, _T.previewRowErr + i + _T.rowErr + e.message);
        }
    }

    renderDetailList(rows);
    updateDetailCount(rows.length);
}

/**
 * \u6784\u5EFA\u9884\u89C8\u7528\u7684 payload
 */
export function buildPreviewPayload(ws, row, colMap) {
    if (typeof buildJsonPayload === 'function') {
        return buildJsonPayload(ws, row, colMap);
    }
    return "{}";
}

/**
 * \u8FC7\u6EE4\u9884\u89C8\u9879\u76EE
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
 * \u66F4\u65B0\u8BE6\u60C5\u8BA1\u6570
 */
export function updateDetailCount(count) {
    let countEl = document.getElementById("detailCount");
    if (countEl) {
        countEl.textContent = _T.countPrefix + count + _T.countSuffix;
    }
}

/**
 * \u663E\u793A\u8BE6\u60C5\u6A21\u6001\u6846
 */
export function showDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "flex";
    }
}

/**
 * \u5173\u95ED\u8BE6\u60C5\u6A21\u6001\u6846
 */
export function closeDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "none";
    }
}

/**
 * \u6E32\u67D3\u8BE6\u60C5\u5217\u8868
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
                <span class="detail-label">${_T.labelRow}${item.row}</span>
                <span class="detail-name">${escapeHtml(item.name)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">${_T.labelSid}</span>
                <span class="detail-sid">${item.sid || _T.cannotExtract}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">${_T.labelCurrentStatus}</span>
                <span class="detail-status">${item.currentStatus || _T.noData}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">${_T.labelRate}</span>
                <span class="detail-rate">${item.rate || _T.noData}</span>
            </div>
            <div class="detail-preview">
                <pre>${escapeHtml(item.previewPayload)}</pre>
            </div>
        `;
        container.appendChild(div);
    });
}

/**
 * \u67E5\u770B\u540C\u6B65\u8BB0\u5F55\u8BE6\u60C5
 */
export function viewSyncRecordDetail(rowIndex) {
    if (typeof getAllSyncRecords !== 'function') {
        showAlert(_T.hint, _T.syncRecordNotAvailable);
        return;
    }

    let records = getAllSyncRecords();
    if (rowIndex < 0 || rowIndex >= records.length) {
        return;
    }

    let record = records[rowIndex];
    let detail = [
        _T.fieldIndex + record.index,
        _T.fieldTime + record.time,
        _T.fieldName + record.name,
        _T.fieldUrl + record.url,
        _T.fieldSid + record.sid,
        _T.fieldType + record.type,
        _T.fieldCount + record.count,
        _T.fieldContent + record.content,
        _T.fieldStatus + record.status,
        _T.fieldComment + record.comment
    ].join('\n');

    showAlert(_T.syncRecordDetail, detail);
}

// ========== \u5411\u540E\u517C\u5BB9\uFF08\u6302\u8F7D\u5230 window\uFF09==========
window.previewSyncContent = previewSyncContent;
window.buildPreviewPayload = buildPreviewPayload;
window.filterDetailItems = filterDetailItems;
window.updateDetailCount = updateDetailCount;
window.showDetailModal = showDetailModal;
window.closeDetailModal = closeDetailModal;
window.renderDetailList = renderDetailList;
window.viewSyncRecordDetail = viewSyncRecordDetail;
window.detailPreviewData = detailPreviewData;

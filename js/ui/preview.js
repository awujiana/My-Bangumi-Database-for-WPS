/**
 * UI 预览模块
 * @module ui/preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */

import { getApp, bgmLog, BGM, LOG_LEVELS, BGM_COLOR } from '../util.js';
import { getCellValue, getCell, trim, _getUserApiPath } from '../util.js';
import { showAlert, showConfirmDialog, showToast } from './dialog.js';
import { escapeHtml } from '../util.js';

// ========== 详细预览数据存储 ==========
let detailPreviewData = {
    allItems: [],
    currentFilter: 'all',
    totalWithType: 0,
    totalValid: 0,
    totalUploaded: 0,
    typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
};

// ========== 详细预览同步内容（富预览版）==========
/**
 * 预览同步内容
 * 带统计卡片、类型过滤按钮、单条上传功能
 */
export function previewSyncContent() {
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined') {
        setTimeout(previewSyncContent, 500);
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    // 优先使用锁定的工作表
    let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;
    let userEndRow = parseInt(endRowInput?.value) || 0;
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        showAlert('\u65E0\u6CD5\u83B7\u53D6 WPS Application \u5BF9\u8C61\uFF01');
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws;
    try {
        ws = wb.Worksheets.Item(sheetIndex);
    } catch (e) {
        showAlert('\u65E0\u6CD5\u83B7\u53D6\u5DE5\u4F5C\u8868\uFF01');
        return;
    }

    // 自动检测表头行
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) headerRow = 1;
    let dataStartRow = headerRow + 1;

    // 获取列映射
    let colMap = getColumnMap(ws, headerRow);

    // 获取最后一行
    let lastRow = 1;
    try {
        let lastRowCell = getCell(ws, ws.Rows.Count, 1);
        lastRow = lastRowCell.End(-4162).Row;
    } catch (e) {}
    let actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;

    // D列序列号
    let seqCol = 4;

    // 确定要处理的行范围
    let rowsToPreview = [];
    if (selectMode === 'auto') {
        if (typeof getSequentialRowsBySeqCol === 'function') {
            let seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
            rowsToPreview = seqResult.validRows || [];
        } else {
            for (let i = dataStartRow; i <= actualEndRow; i++) rowsToPreview.push(i);
        }
    } else {
        let manualStart = parseInt(startRowInput?.value) || dataStartRow;
        let manualEnd = parseInt(endRowInput?.value) || lastRow;
        if (isNaN(manualStart)) manualStart = dataStartRow;
        if (isNaN(manualEnd)) manualEnd = lastRow;
        if (manualStart > manualEnd) { manualStart = dataStartRow; manualEnd = lastRow; }
        for (let i = manualStart; i <= manualEnd; i++) rowsToPreview.push(i);
    }

    if (rowsToPreview.length === 0) {
        showAlert('\u6CA1\u6709\u6570\u636E\u53EF\u9884\u89C8\uFF01');
        return;
    }

    // 第一步：遍历所有行收集统计信息
    let totalValid = 0, totalWithType = 0, totalUploaded = 0;
    let typeCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let uploadedCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let allValidRows = [];

    for (let idx = 0; idx < rowsToPreview.length; idx++) {
        let i = rowsToPreview[idx];

        let bgmUrlCell, bgmUrl = "", name = "", status = "", rate = "", tagsRaw = "", finishedDate = "";

        if (colMap.has("Bangumi_URL")) {
            bgmUrlCell = getCell(ws, i, colMap.get("Bangumi_URL"));
            bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
        }
        if (colMap.has("\u540D\u79F0")) {
            let nameCell = getCell(ws, i, colMap.get("\u540D\u79F0"));
            name = nameCell ? trim(String(nameCell.Value() || "")) : "";
        }
        if (colMap.has("\u662F\u5426\u770B\u5B8C")) {
            let statusCell = getCell(ws, i, colMap.get("\u662F\u5426\u770B\u5B8C"));
            status = statusCell ? trim(String(statusCell.Value() || "")) : "";
        }
        if (colMap.has("\u6253\u5206")) {
            let rateCell = getCell(ws, i, colMap.get("\u6253\u5206"));
            rate = rateCell ? trim(String(rateCell.Value() || "")) : "";
        }
        if (colMap.has("\u6807\u7B7E/\u5206\u7EA7")) {
            let tagsCell = getCell(ws, i, colMap.get("\u6807\u7B7E/\u5206\u7EA7"));
            tagsRaw = tagsCell ? trim(String(tagsCell.Value() || "")) : "";
        }
        if (colMap.has("\u5B8C\u64AD\u65E5")) {
            let finishedDateCell = getCell(ws, i, colMap.get("\u5B8C\u64AD\u65E5"));
            finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";
        }

        // 检查D列颜色（已上传检测）
        let seqCell = getCell(ws, i, seqCol);
        let isUploaded = false;
        try {
            if (seqCell && seqCell.Interior) {
                let colorValue = seqCell.Interior.Color;
                if (colorValue === BGM_COLOR.SUCCESS ||
                    colorValue === BGM_COLOR.LIGHT_GREEN ||
                    colorValue === BGM_COLOR.DARK_GREEN ||
                    colorValue === 5292178) {
                    isUploaded = true;
                }
            }
        } catch (e) {}

        let sid = "";
        if (typeof extractSubjectId === 'function') sid = extractSubjectId(bgmUrl);
        if (sid) totalValid++;
        if (!sid) continue;

        let typeNum = 0;
        if (typeof mapWatchStatus === 'function') typeNum = mapWatchStatus(status, finishedDate);

        // type=0 不计入待上传
        if (typeNum === 0) continue;

        typeCount[typeNum]++;
        totalWithType++;
        if (isUploaded) {
            totalUploaded++;
            uploadedCount[typeNum]++;
        }

        allValidRows.push({
            row: i, name: name, sid: sid, bgmUrl: bgmUrl,
            status: status, rate: rate, tagsRaw: tagsRaw, finishedDate: finishedDate,
            typeNum: typeNum, isUploaded: isUploaded
        });
    }

    // 第二步：生成预览内容
    let itemsData = [];
    let addTagsFromStr = window.addTagsFromStr || function(set, str) {
        if (!str) return;
        str.split(/[,|\/、]/).forEach(t => { if (t.trim()) set.add(t.trim()); });
    };

    for (let idx = 0; idx < allValidRows.length; idx++) {
        let rowData = allValidRows[idx];
        let typeName = ["", "\u60F3\u770B", "\u5728\u770B", "\u770B\u8FC7", "\u641E\u7F6E", "\u629B\u5F03"][rowData.typeNum] || "\u672A\u77E5";

        let tagSet = new Set();
        addTagsFromStr(tagSet, rowData.tagsRaw);
        let tags = Array.from(tagSet);
        let tagsHtml = tags.length > 0
            ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>`
            : '<div class="detail-value">-</div>';

        let jsonBody = "";
        if (typeof buildJsonPayload === 'function') {
            jsonBody = buildJsonPayload(ws, rowData.row, colMap, rowData.finishedDate);
        }
        let urlDisplay = rowData.bgmUrl.length > 60 ? rowData.bgmUrl.substring(0, 60) + '...' : rowData.bgmUrl;

        let itemHtml = `
            <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${rowData.typeNum}" data-row="${rowData.row}" data-sid="${rowData.sid}">
                <div class="detail-item-header">
                    <div class="detail-item-title">
                        <span class="detail-item-row">\u884C ${rowData.row}</span>
                        <span class="detail-item-name">${escapeHtml(rowData.name) || '(\u65E0\u540D\u79F0)'}</span>
                    </div>
                    ${rowData.isUploaded ?
                        `<button class="upload-single-btn reupload" onclick="window.uploadSingleRow(${rowData.row}, this)">\u91CD\u65B0\u4E0A\u4F20</button>` :
                        `<button class="upload-single-btn" onclick="window.uploadSingleRow(${rowData.row}, this)">\u4E0A\u4F20</button>`
                    }
                    ${rowData.isUploaded ? '<span class="uploaded-badge">\u2713 \u5DF2\u4E0A\u4F20</span>' : ''}
                </div>
                <div class="detail-item-body">
                    <div class="detail-row">
                        <span class="detail-label">Bangumi URL</span>
                        <span class="detail-value url">${escapeHtml(urlDisplay) || '(\u7A7A)'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Subject ID</span>
                        <span class="detail-value sid ${rowData.sid ? 'valid' : ''}">${rowData.sid || '\u274C \u65E0\u6CD5\u63D0\u53D6'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">\u89C2\u770B\u72B6\u6001</span>
                        <span class="detail-value">${typeName} (type=${rowData.typeNum})</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">\u5B8C\u64AD\u65E5</span>
                        <span class="detail-value">${(rowData.finishedDate === null || rowData.finishedDate === undefined || rowData.finishedDate === "" || rowData.finishedDate === "null") ? '(\u7A7A\u767D)' : escapeHtml(rowData.finishedDate)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">\u8BC4\u5206</span>
                        <span class="detail-value" style="color:#f39c12;font-weight:600;">${rowData.rate && rowData.rate !== 'true' && rowData.rate !== 'True' ? '\u2B50 ' + rowData.rate : '(\u7A7A)'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">\u6807\u7B7E</span>
                        ${tagsHtml}
                    </div>
                    ${rowData.sid ? `
                    <div class="detail-row" style="flex-direction:column;gap:6px;">
                        <span class="detail-label" style="min-width:auto;">\u5C06\u53D1\u9001\u7684\u8BF7\u6C42</span>
                        <div class="detail-value" style="color:#27ae60;font-weight:500;">
                            POST /v0/users/{userId}/collections/${rowData.sid}
                        </div>
                        <div class="detail-value json">${escapeHtml(jsonBody)}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        itemsData.push({ html: itemHtml, type: rowData.typeNum });
    }

    // 存储数据
    detailPreviewData.allItems = itemsData;
    detailPreviewData.totalWithType = totalWithType;
    detailPreviewData.totalValid = totalValid;
    detailPreviewData.totalUploaded = totalUploaded;
    detailPreviewData.typeCount = typeCount;
    detailPreviewData.uploadedCount = uploadedCount;
    detailPreviewData.currentFilter = 'all';

    // 生成过滤按钮
    let toolbarHtml = `
        <button class="filter-btn all active" onclick="window.filterDetailItems('all')">\u5168\u90E8 (${totalWithType})</button>
        ${typeCount[3] > 0 ? `<button class="filter-btn type-3" onclick="window.filterDetailItems(3)">\u770B\u8FC7 (${typeCount[3]})</button>` : ''}
        ${typeCount[2] > 0 ? `<button class="filter-btn type-2" onclick="window.filterDetailItems(2)">\u5728\u8FFD (${typeCount[2]})</button>` : ''}
        ${typeCount[1] > 0 ? `<button class="filter-btn type-1" onclick="window.filterDetailItems(1)">\u60F3\u770B (${typeCount[1]})</button>` : ''}
        ${typeCount[4] > 0 ? `<button class="filter-btn type-4" onclick="window.filterDetailItems(4)">\u641E\u7F6E (${typeCount[4]})</button>` : ''}
        ${typeCount[5] > 0 ? `<button class="filter-btn type-5" onclick="window.filterDetailItems(5)">\u629B\u5F03 (${typeCount[5]})</button>` : ''}
    `;

    // 生成统计信息
    let pendingCount = totalWithType - totalUploaded;
    let statsHtml = `
        <div class="detail-stats">
            <div class="stat-card">
                <div class="stat-value">${rowsToPreview.length}</div>
                <div class="stat-label">\u603B\u884C\u6570</div>
            </div>
            <div class="stat-card" style="border-left:3px solid #f59e0b;">
                <div class="stat-value" style="color:#f59e0b;">${pendingCount}</div>
                <div class="stat-label">\u5F85\u4E0A\u4F20</div>
            </div>
            <div class="stat-card success" style="border-left:3px solid #22c55e;">
                <div class="stat-value" style="color:#22c55e;">${totalUploaded}</div>
                <div class="stat-label">\u5DF2\u4E0A\u4F20</div>
            </div>
        </div>
        <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
            <span class="status-badge" style="background:#1a3a35;color:#4ade80;">D\u5217\u5E8F\u5217\u53F7</span>
            ${typeCount[3] > 0 ? `<span class="status-badge type-3">\u770B\u8FC7 ${typeCount[3]}${uploadedCount[3] > 0 ? ' \u2713' + uploadedCount[3] : ''}</span>` : ''}
            ${typeCount[2] > 0 ? `<span class="status-badge type-2">\u5728\u770B ${typeCount[2]}${uploadedCount[2] > 0 ? ' \u2713' + uploadedCount[2] : ''}</span>` : ''}
            ${typeCount[1] > 0 ? `<span class="status-badge type-1">\u60F3\u770B ${typeCount[1]}${uploadedCount[1] > 0 ? ' \u2713' + uploadedCount[1] : ''}</span>` : ''}
            ${typeCount[4] > 0 ? `<span class="status-badge type-4">\u641E\u7F6E ${typeCount[4]}${uploadedCount[4] > 0 ? ' \u2713' + uploadedCount[4] : ''}</span>` : ''}
            ${typeCount[5] > 0 ? `<span class="status-badge type-5">\u629B\u5F03 ${typeCount[5]}${uploadedCount[5] > 0 ? ' \u2713' + uploadedCount[5] : ''}</span>` : ''}
        </div>
    `;

    // 显示模态框
    let modalToolbar = document.getElementById("detailModalToolbar");
    let modalBody = document.getElementById("detailModalBody");
    if (modalToolbar && modalBody) {
        modalToolbar.innerHTML = toolbarHtml;
        modalBody.innerHTML = statsHtml + itemsData.map(item => item.html).join('');
        document.getElementById("detailModal").style.display = "flex";
    }
}

// ========== 单条上传功能 ==========
/**
 * 上传单行数据到 Bangumi
 */
export function uploadSingleRow(rowNum, btnElement) {
    let loadBgToken = window.loadBgToken || (typeof require !== 'undefined' ? function() { return ''; } : function() { return ''; });
    let token = loadBgToken();
    if (!token) {
        showAlert('\u8BF7\u5148\u8BBE\u7F6E Bangumi Token\uFF01');
        return;
    }

    // 禁用按钮
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.classList.add('uploading');
        btnElement.textContent = '\u4E0A\u4F20\u4E2D...';
    }

    try {
        let app = getApp();
        if (!app || !app.ActiveWorkbook) { throw new Error('\u65E0\u6CD5\u83B7\u53D6 Application'); }

        let sheetIndex = BGM.sheet.lockedIndex || parseInt(document.getElementById("sheetSelect")?.value) || 1;
        let ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);

        let headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 0;
        if (headerRow === 0) headerRow = 1;
        let colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map();

        if (!colMap.has("Bangumi_URL")) { throw new Error('\u672A\u627E\u5230 Bangumi URL \u5217'); }

        let bgmUrlCell = getCell(ws, rowNum, colMap.get("Bangumi_URL"));
        let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
        let sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : "";
        if (!sid) { throw new Error('\u65E0\u6CD5\u63D0\u53D6 Subject ID'); }

        let name = "";
        if (colMap.has("\u540D\u79F0")) {
            let nameCell = getCell(ws, rowNum, colMap.get("\u540D\u79F0"));
            name = nameCell ? trim(String(nameCell.Value() || "")) : "";
        }
        let finishedDate = "";
        if (colMap.has("\u5B8C\u64AD\u65E5")) {
            let finishedDateCell = getCell(ws, rowNum, colMap.get("\u5B8C\u64AD\u65E5"));
            finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";
        }
        let itemType = "";
        if (colMap.has("\u7C7B\u522B")) {
            let typeCell = getCell(ws, rowNum, colMap.get("\u7C7B\u522B"));
            itemType = typeCell ? trim(String(typeCell.Value() || "")) : "";
        }

        let jsonBody = "";
        if (typeof buildJsonPayload === 'function') {
            jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
        }
        if (jsonBody === "") { throw new Error('\u65E0\u6CD5\u6784\u5EFA\u8BF7\u6C42\u4F53'); }

        let result = null;
        if (typeof bgmRequestSync === 'function') {
            result = bgmRequestSync("POST", "/v0/users/" + _getUserApiPath() + "/collections/" + sid, jsonBody, token);
        }
        let statusCode = result ? result.code : 0;

        let seqCol = 4;
        let seqCell = getCell(ws, rowNum, seqCol);

        if (statusCode === 204 || statusCode === 200 || statusCode === 201 || statusCode === 202) {
            if (seqCell && seqCell.Interior) seqCell.Interior.Color = BGM_COLOR.SUCCESS;

            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('reupload');
                btnElement.textContent = '\u91CD\u65B0\u4E0A\u4F20';
                btnElement.disabled = false;
            }

            let detailItem = btnElement?.closest('.detail-item');
            if (detailItem) {
                detailItem.classList.remove('pending');
                detailItem.classList.add('uploaded');
                let existingBadge = detailItem.querySelector('.uploaded-badge');
                if (!existingBadge) {
                    let header = detailItem.querySelector('.detail-item-header');
                    if (header) {
                        let badge = document.createElement('span');
                        badge.className = 'uploaded-badge';
                        badge.textContent = '\u2713 \u5DF2\u4E0A\u4F20';
                        header.appendChild(badge);
                    }
                }
            }

            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name: name || "(\u65E0\u540D\u79F0)", url: bgmUrl, sid: sid,
                    type: itemType, content: jsonBody,
                    status: "\u6210\u529F", message: "\u884C " + rowNum, count: 1
                });
            }
            updateUploadStats();
        } else {
            if (seqCell && seqCell.Interior) seqCell.Interior.Color = BGM_COLOR.FAIL;

            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('error');
                btnElement.textContent = '\u2717 \u5931\u8D25';
                btnElement.disabled = false;
            }

            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name: name || "(\u65E0\u540D\u79F0)", url: bgmUrl, sid: sid,
                    type: itemType, content: jsonBody,
                    status: "\u5931\u8D25", message: (result?.message || "HTTP " + statusCode), count: 1
                });
            }
            showToast('\u4E0A\u4F20\u5931\u8D25: ' + ((result?.message || '\u672A\u77E5\u9519\u8BEF').substring(0, 60)), "error");
        }
    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.classList.remove('uploading');
            btnElement.classList.add('error');
            btnElement.textContent = '\u2717 \u9519\u8BEF';
        }
        showToast("\u4E0A\u4F20\u51FA\u9519: " + e.message.substring(0, 60), "error");
    }
}

/**
 * 更新上传统计显示
 */
export function updateUploadStats() {
    let modalBody = document.getElementById("detailModalBody");
    if (!modalBody) return;

    let totalUploaded = detailPreviewData.totalUploaded || 0;
    let totalWithType = detailPreviewData.totalWithType || 0;
    let pendingCount = totalWithType - totalUploaded;

    let pendingCard = modalBody.querySelector('.stat-card:nth-child(2) .stat-value');
    let uploadedCard = modalBody.querySelector('.stat-card:nth-child(3) .stat-value');
    if (pendingCard) pendingCard.textContent = pendingCount;
    if (uploadedCard) uploadedCard.textContent = totalUploaded;
}

// ========== 过滤详细预览项目（按类型）==========
/**
 * 按类型过滤预览项目
 */
export function filterDetailItems(filterType) {
    detailPreviewData.currentFilter = filterType;

    // 更新按钮状态
    let buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (filterType === 'all' && btn.classList.contains('all')) {
            btn.classList.add('active');
        } else if (btn.classList.contains('type-' + filterType)) {
            btn.classList.add('active');
        }
    });

    let modalBody = document.getElementById("detailModalBody");
    if (!modalBody) return;

    let totalWithType = detailPreviewData.totalWithType || 0;
    let typeCount = detailPreviewData.typeCount || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    let filteredItems = detailPreviewData.allItems;
    if (filterType !== 'all') {
        filteredItems = filteredItems.filter(item => item.type === parseInt(filterType));
    }

    let totalCard = modalBody.querySelector('.stat-card:first-child .stat-value');
    let uploadCard = modalBody.querySelector('.stat-card:nth-child(2) .stat-value');
    let validCard = modalBody.querySelector('.stat-card.success .stat-value');
    if (totalCard) totalCard.textContent = detailPreviewData.allItems.length;
    if (uploadCard) uploadCard.textContent = filterType === 'all' ? totalWithType : (typeCount[filterType] || 0);
    if (validCard) validCard.textContent = detailPreviewData.totalValid || 0;

    // 移除并重新添加
    let allItems = modalBody.querySelectorAll('.detail-item');
    allItems.forEach(item => item.remove());

    let tempDiv = document.createElement('div');
    filteredItems.forEach(item => {
        tempDiv.innerHTML = item.html;
        modalBody.appendChild(tempDiv.firstElementChild);
    });
}

// ========== 显示/关闭详情模态框 ==========
export function showDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) modal.style.display = "flex";
}

export function closeDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) modal.style.display = "none";
}

// ========== 查看同步记录详情 ==========
export function viewSyncRecordDetail(sid) {
    if (typeof getAllSyncRecords !== 'function') {
        showAlert('\u540C\u6B65\u8BB0\u5F55\u529F\u80FD\u4E0D\u53EF\u7528\uFF01');
        return;
    }
    let records = getAllSyncRecords();
    let record = records.find(r => String(r.sid) === String(sid));
    if (!record) {
        showAlert('\u672A\u627E\u5230\u8BE5\u540C\u6B65\u8BB0\u5F55');
        return;
    }
    let content = record.content || "";
    let formattedContent = content;
    try { formattedContent = JSON.stringify(JSON.parse(content), null, 2); } catch (e) {}

    let detail = `\u540C\u6B65\u8BB0\u5F55\u8BE6\u60C5\n\n\u540D\u79F0: ${record.name || ""}\nSID: ${record.sid || ""}\nURL: ${record.url || ""}\n\u65F6\u95F4: ${record.time || ""}\n\u72B6\u6001: ${record.status || ""}\n\u540C\u6B65\u6B21\u6570: ${record.count || ""}\n\u5907\u6CE8: ${record.message || ""}\n\n\u540C\u6B65\u5185\u5BB9:\n${formattedContent}`;
    showAlert(detail, '\u540C\u6B65\u8BB0\u5F55\u8BE6\u60C5');
}

// ========== 兼容旧接口 ==========
export function buildPreviewPayload(ws, row, colMap) {
    if (typeof buildJsonPayload === 'function') {
        return buildJsonPayload(ws, row, colMap);
    }
    return "{}";
}

export function updateDetailCount(count) {
    let countEl = document.getElementById("detailCount");
    if (countEl) countEl.textContent = count + ' \u6761';
}

// ========== 挂载到 window ==========
window.previewSyncContent = previewSyncContent;
window.uploadSingleRow = uploadSingleRow;
window.updateUploadStats = updateUploadStats;
window.filterDetailItems = filterDetailItems;
window.showDetailModal = showDetailModal;
window.closeDetailModal = closeDetailModal;
window.viewSyncRecordDetail = viewSyncRecordDetail;
window.buildPreviewPayload = buildPreviewPayload;
window.updateDetailCount = updateDetailCount;
window.detailPreviewData = detailPreviewData;

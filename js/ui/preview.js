/**
 * 详细预览页面
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */

import { getApp, bgmLog, BGM, LOG_LEVELS, BGM_COLOR } from '../util.js';
import { getCellValue, getCell, trim, _getUserApiPath } from '../util.js';
import { showAlert, showToast } from './dialog.js';
import { escapeHtml } from '../util.js';

// ========== 依赖函数可用性检测（运行时可能由其他模块挂载到 window） ==========
const hasFunc = {
    findHeaderRow: () => typeof window.findHeaderRow === 'function',
    getColumnMap: () => typeof window.getColumnMap === 'function',
    getSequentialRowsBySeqCol: () => typeof getSequentialRowsBySeqCol === 'function',
    extractSubjectId: () => typeof extractSubjectId === 'function',
    mapWatchStatus: () => typeof mapWatchStatus === 'function',
    buildJsonPayload: () => typeof buildJsonPayload === 'function',
    bgmRequestSync: () => typeof bgmRequestSync === 'function',
    addSyncRecord: () => typeof addSyncRecord === 'function',
    addTagsFromStr: () => typeof window.addTagsFromStr === 'function',
    loadBgToken: () => typeof window.loadBgToken === 'function' ? window.loadBgToken : null,
    getAllSyncRecords: () => typeof getAllSyncRecords === 'function',
};

// ========== 状态存储（保持对外兼容） ==========
let detailPreviewData = {
    allItems: [],
    currentFilter: 'all',
    totalWithType: 0,
    totalValid: 0,
    totalUploaded: 0,
    typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
};

/** 获取当前详情数据（只读副本） */
function getDetailPreviewData() {
    return { ...detailPreviewData };
}

// ========== 辅助函数 ==========

/**
 * 根据单元格颜色判断是否已上传
 */
function isUploadedByColor(seqCell) {
    if (!seqCell || !seqCell.Interior) return false;
    const color = seqCell.Interior.Color;
    return (
        color === BGM_COLOR.SUCCESS ||
        color === BGM_COLOR.LIGHT_GREEN ||
        color === BGM_COLOR.DARK_GREEN ||
        color === BGM_COLOR.UPLOADED_ALT   // 替换魔术数字 5292178
    );
}

/**
 * 从工作表读取单行所需全部数据（用于预览和上传）
 * @returns {object} 行数据对象，包含 row, name, sid, bgmUrl, status, rate, tagsRaw, finishedDate, typeNum, isUploaded 等
 */
function getRowData(ws, rowNum, colMap, headerRow, seqCol = 4) {
    const data = {
        row: rowNum,
        name: '',
        bgmUrl: '',
        sid: '',
        status: '',
        rate: '',
        tagsRaw: '',
        finishedDate: '',
        typeNum: 0,
        isUploaded: false,
        urlCell: null
    };

    // 读取各列
    const readCol = (field, mapKey) => {
        if (colMap.has(mapKey)) {
            const cell = getCell(ws, rowNum, colMap.get(mapKey));
            const value = cell ? trim(String(cell.Value || '')) : '';
            if (field === 'bgmUrl') data.urlCell = cell;
            return value;
        }
        return '';
    };

    data.bgmUrl = readCol('bgmUrl', 'Bangumi_URL');
    data.name = readCol('name', '名称');
    data.status = readCol('status', '是否看完');
    data.rate = readCol('rate', '打分');
    data.tagsRaw = readCol('tagsRaw', '标签/分级');
    data.finishedDate = readCol('finishedDate', '完播日');

    // 提取 SID
    if (data.bgmUrl && hasFunc.extractSubjectId()) {
        data.sid = extractSubjectId(data.bgmUrl);
    }

    // 判断类型
    if (data.sid && hasFunc.mapWatchStatus()) {
        data.typeNum = mapWatchStatus(data.status, data.finishedDate);
    }

    // 检测是否已上传
    const seqCell = getCell(ws, rowNum, seqCol);
    data.isUploaded = isUploadedByColor(seqCell);

    return data;
}

/**
 * 生成单个条目的 HTML（在 detailModal 中显示）
 */
function renderDetailItemHtml(rowData, colMap, ws) {
    const typeNames = ['', '想看', '在看', '看过', '搁置', '抛弃'];
    const typeName = typeNames[rowData.typeNum] || '未知';

    // 标签处理
    const tagSet = new Set();
    if (hasFunc.addTagsFromStr()) {
        window.addTagsFromStr(tagSet, rowData.tagsRaw);
    }
    const tags = Array.from(tagSet);
    const tagsHtml = tags.length > 0
        ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>`
        : '<div class="detail-value">-</div>';

    // JSON 请求体
    let jsonBody = '';
    if (rowData.sid && hasFunc.buildJsonPayload()) {
        jsonBody = buildJsonPayload(ws, rowData.row, colMap, rowData.finishedDate);
    }
    const urlDisplay = rowData.bgmUrl.length > 60 ? rowData.bgmUrl.substring(0, 60) + '...' : rowData.bgmUrl;

    return `
        <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${rowData.typeNum}" data-row="${rowData.row}" data-sid="${rowData.sid}">
            <div class="detail-item-header">
                <div class="detail-item-title">
                    <span class="detail-item-row">行 ${rowData.row}</span>
                    <span class="detail-item-name">${escapeHtml(rowData.name) || '(无名称)'}</span>
                </div>
                ${rowData.isUploaded ?
                    `<button class="upload-single-btn reupload" onclick="window.uploadSingleRow(${rowData.row}, this)">重新上传</button>` :
                    `<button class="upload-single-btn" onclick="window.uploadSingleRow(${rowData.row}, this)">上传</button>`
                }
                ${rowData.isUploaded ? '<span class="uploaded-badge">✓ 已上传</span>' : ''}
            </div>
            <div class="detail-item-body">
                <div class="detail-row">
                    <span class="detail-label">Bangumi URL</span>
                    <span class="detail-value url">${escapeHtml(urlDisplay) || '(空)'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Subject ID</span>
                    <span class="detail-value sid ${rowData.sid ? 'valid' : ''}">${rowData.sid || '✘ 无法提取'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">观看状态</span>
                    <span class="detail-value">${typeName} (type=${rowData.typeNum})</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">完播日</span>
                    <span class="detail-value">${(!rowData.finishedDate || rowData.finishedDate === 'null') ? '(空白)' : escapeHtml(rowData.finishedDate)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">评分</span>
                    <span class="detail-value" style="color:#f39c12;font-weight:600;">${rowData.rate && rowData.rate !== 'true' && rowData.rate !== 'True' ? '⭐ ' + rowData.rate : '(空)'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">标签</span>
                    ${tagsHtml}
                </div>
                ${rowData.sid ? `
                <div class="detail-row" style="flex-direction:column;gap:6px;">
                    <span class="detail-label" style="min-width:auto;">将发送的请求</span>
                    <div class="detail-value" style="color:#27ae60;font-weight:500;">
                        POST /v0/users/{userId}/collections/${rowData.sid}
                    </div>
                    <div class="detail-value json">${escapeHtml(jsonBody)}</div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// ========== 公有函数 ==========

export function previewSyncContent() {
    // 等待依赖就绪
    if (!hasFunc.findHeaderRow() || !hasFunc.getColumnMap()) {
        setTimeout(previewSyncContent, 500);
        return;
    }
    
    const select = document.getElementById("sheetSelect");
    const endRowInput = document.getElementById("endRow");
    const startRowInput = document.getElementById("startRow");

    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;
    const userEndRow = parseInt(endRowInput?.value) || 0;
    const selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    const app = getApp();
    if (!app?.ActiveWorkbook) {
        showAlert('无法获取 WPS Application 对象！');
        return;
    }

    const wb = app.ActiveWorkbook;
    let ws;
    try {
        ws = wb.Worksheets.Item(sheetIndex);
    } catch (e) {
        showAlert('无法获取工作表！');
        return;
    }

    const headerRow = findHeaderRow(ws) || 1;
    const dataStartRow = headerRow + 1;
    const colMap = getColumnMap(ws, headerRow);

    // 获取数据范围
    let lastRow = 1;
    try {
        const lastCell = getCell(ws, ws.Rows.Count, 1);
        lastRow = lastCell.End(-4162).Row;
    } catch (e) {}

    const actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;
    let rowsToPreview = [];

    if (selectMode === 'auto') {
        if (hasFunc.getSequentialRowsBySeqCol()) {
            const seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
           rowsToPreview = (seqResult && seqResult.validRows) || [];
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
        showAlert('没有数据可预览！');
        return;
    }

    // 重置统计数据
    detailPreviewData = {
        allItems: [],
        currentFilter: 'all',
        totalWithType: 0,
        totalValid: 0,
        totalUploaded: 0,
        typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };

    const allValidRows = [];

    // 遍历行，收集数据
    for (const rowNum of rowsToPreview) {
        const rowData = getRowData(ws, rowNum, colMap, headerRow, 4);
        if (!rowData.sid || rowData.typeNum === 0) continue;

        detailPreviewData.totalValid++;
        detailPreviewData.typeCount[rowData.typeNum]++;
        detailPreviewData.totalWithType++;
        if (rowData.isUploaded) {
            detailPreviewData.totalUploaded++;
            detailPreviewData.uploadedCount[rowData.typeNum]++;
        }
        allValidRows.push(rowData);
    }

    // 生成条目 HTML
    const itemsData = allValidRows.map(rowData => ({
        html: renderDetailItemHtml(rowData, colMap, ws),
        type: rowData.typeNum
    }));
    detailPreviewData.allItems = itemsData;

    // 构建过滤工具栏
    const toolbarHtml = buildFilterToolbar();
    const statsHtml = buildStatsHtml(rowsToPreview.length);

    // 显示模态框
    const modalToolbar = document.getElementById("detailModalToolbar");
    const modalBody = document.getElementById("detailModalBody");
    if (modalToolbar && modalBody) {
        modalToolbar.innerHTML = toolbarHtml;
        modalBody.innerHTML = statsHtml + '<div id="detailItemsContainer">' + itemsData.map(item => item.html).join('') + '</div>';
        document.getElementById("detailModal").style.display = "flex";
    }
}

function buildFilterToolbar() {
    const d = detailPreviewData;
    let html = `<button class="filter-btn all active" onclick="window.filterDetailItems('all')">全部 (${d.totalWithType})</button>`;
    const addBtn = (type, label) => {
        if (d.typeCount[type] > 0) {
            html += `<button class="filter-btn type-${type}" onclick="window.filterDetailItems(${type})">${label} (${d.typeCount[type]})</button>`;
        }
    };
    addBtn(3, '看过');
    addBtn(2, '在追');
    addBtn(1, '想看');
    addBtn(4, '搁置');
    addBtn(5, '抛弃');
    return html;
}

function buildStatsHtml(totalRows) {
    const d = detailPreviewData;
    const pending = d.totalWithType - d.totalUploaded;
    return `
        <div class="detail-stats">
            <div class="stat-card">
                <div class="stat-value">${totalRows}</div>
                <div class="stat-label">总行数</div>
            </div>
            <div class="stat-card" style="border-left:3px solid #f59e0b;">
                <div class="stat-value" style="color:#f59e0b;">${pending}</div>
                <div class="stat-label">待上传</div>
            </div>
            <div class="stat-card success" style="border-left:3px solid #22c55e;">
                <div class="stat-value" style="color:#22c55e;">${d.totalUploaded}</div>
                <div class="stat-label">已上传</div>
            </div>
        </div>
        <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
            <span class="status-badge" style="background:#1a3a35;color:#4ade80;">D列序列号</span>
            ${createTypeBadges()}
        </div>
    `;
}

function createTypeBadges() {
    const d = detailPreviewData;
    const labels = { 3: '看过', 2: '在看', 1: '想看', 4: '搁置', 5: '抛弃' };
    let badges = '';
    for (const type in labels) {
        const count = d.typeCount[type] || 0;
        if (count > 0) {
            const uploaded = d.uploadedCount[type] || 0;
            badges += `<span class="status-badge type-${type}">${labels[type]} ${count}${uploaded > 0 ? ' ✓' + uploaded : ''}</span>`;
        }
    }
    return badges;
}

export function uploadSingleRow(rowNum, btnElement) {
    const loadBgToken = hasFunc.loadBgToken();
    const token = loadBgToken ? loadBgToken() : '';
    if (!token) {
        showAlert('请先设置 Bangumi Token！');
        return;
    }

    if (btnElement) {
        btnElement.disabled = true;
        btnElement.classList.add('uploading');
        btnElement.textContent = '上传中...';
    }

    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) throw new Error('无法获取 Application');

        const sheetIndex = BGM.sheet.lockedIndex || parseInt(document.getElementById("sheetSelect")?.value) || 1;
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);

        const headerRow = hasFunc.findHeaderRow() ? findHeaderRow(ws) || 1 : 1;
        const colMap = hasFunc.getColumnMap() ? getColumnMap(ws, headerRow) : new Map();
        if (!colMap.has('Bangumi_URL')) throw new Error('未找到 Bangumi URL 列');

        const rowData = getRowData(ws, rowNum, colMap, headerRow, 4);
        if (!rowData.sid) throw new Error('无法提取 Subject ID');

        if (!hasFunc.buildJsonPayload()) throw new Error('缺少 buildJsonPayload 函数');
        const jsonBody = buildJsonPayload(ws, rowNum, colMap, rowData.finishedDate);
        if (!jsonBody) throw new Error('无法构建请求体');

        let result = null;
        if (hasFunc.bgmRequestSync()) {
            result = bgmRequestSync("POST", `/v0/users/${_getUserApiPath()}/collections/${rowData.sid}`, jsonBody, token);
        }
        const statusCode = result ? result.code : 0;
        const seqCell = getCell(ws, rowNum, 4);

        if ([200, 201, 202, 204].includes(statusCode)) {
            if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.SUCCESS;

            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('reupload');
                btnElement.textContent = '重新上传';
                btnElement.disabled = false;
            }

            // 更新详情卡片样式
            const detailItem = btnElement?.closest('.detail-item');
            if (detailItem) {
                detailItem.classList.remove('pending');
                detailItem.classList.add('uploaded');
                if (!detailItem.querySelector('.uploaded-badge')) {
                    const header = detailItem.querySelector('.detail-item-header');
                    if (header) {
                        const badge = document.createElement('span');
                        badge.className = 'uploaded-badge';
                        badge.textContent = '✓ 已上传';
                        header.appendChild(badge);
                    }
                }
            }

            if (hasFunc.addSyncRecord()) {
                addSyncRecord({
                    name: rowData.name || '(无名称)',
                    url: rowData.bgmUrl,
                    sid: rowData.sid,
                    type: '',
                    content: jsonBody,
                    status: '成功',
                    message: '行 ' + rowNum,
                    count: 1
                });
            }

            updateUploadStats();
        } else {
            if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.FAIL;

            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('error');
                btnElement.textContent = '✗ 失败';
                btnElement.disabled = false;
            }

            if (hasFunc.addSyncRecord()) {
                addSyncRecord({
                    name: rowData.name || '(无名称)',
                    url: rowData.bgmUrl,
                    sid: rowData.sid,
                    type: '',
                    content: jsonBody,
                    status: '失败',
                    message: result?.message || 'HTTP ' + statusCode,
                    count: 1
                });
            }
            showToast('上传失败: ' + ((result?.message || '未知错误').substring(0, 60)), 'error');
        }
    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.classList.remove('uploading');
            btnElement.classList.add('error');
            btnElement.textContent = '✗ 错误';
        }
        showToast('上传出错: ' + e.message.substring(0, 60), 'error');
    }
}

export function updateUploadStats() {
    const modalBody = document.getElementById("detailModalBody");
    if (!modalBody) return;

    const d = detailPreviewData;
    const pending = d.totalWithType - d.totalUploaded;

    const cards = modalBody.querySelectorAll('.stat-card .stat-value');
    if (cards.length >= 3) {
        cards[1].textContent = pending;   // 待上传
        cards[2].textContent = d.totalUploaded; // 已上传
    }
}

export function filterDetailItems(filterType) {
    detailPreviewData.currentFilter = filterType;

    // 更新按钮 active 状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (filterType === 'all' && btn.classList.contains('all')) {
            btn.classList.add('active');
        } else if (btn.classList.contains('type-' + filterType)) {
            btn.classList.add('active');
        }
    });

    const container = document.getElementById("detailItemsContainer");
    if (!container) return;

    let visibleCount = 0;
    container.querySelectorAll('.detail-item').forEach(item => {
        const match = filterType === 'all' || item.dataset.type === String(filterType);
        item.style.display = match ? '' : 'none';
        if (match) visibleCount++;
    });

    // 更新顶部统计
    const modalBody = document.getElementById("detailModalBody");
    const statCards = modalBody?.querySelectorAll('.stat-card .stat-value');
    if (!statCards || statCards.length < 3) return;

    const d = detailPreviewData;
    if (filterType === 'all') {
        statCards[0].textContent = d.totalWithType; // 保持真实总数
        statCards[1].textContent = d.totalWithType - d.totalUploaded;
        statCards[2].textContent = d.totalUploaded;
    } else {
        const typeNum = parseInt(filterType);
        const typeTotal = d.typeCount[typeNum] || 0;
        const typeUploaded = d.uploadedCount[typeNum] || 0;
        statCards[0].textContent = visibleCount;
        statCards[1].textContent = typeTotal - typeUploaded;
        statCards[2].textContent = typeUploaded;
    }
}

export function showDetailModal() {
    const modal = document.getElementById("detailModal");
    if (modal) modal.style.display = "flex";
}

export function closeDetailModal() {
    const modal = document.getElementById("detailModal");
    if (modal) modal.style.display = "none";
}

export function viewSyncRecordDetail(sid) {
    if (!hasFunc.getAllSyncRecords()) {
        showAlert('同步记录功能不可用！');
        return;
    }
    const records = getAllSyncRecords();
    const record = records.find(r => String(r.sid) === String(sid));
    if (!record) {
        showAlert('未找到该同步记录');
        return;
    }
    let content = record.content || "";
    try { content = JSON.stringify(JSON.parse(content), null, 2); } catch (e) {}
    const detail = `同步记录详情\n\n名称: ${record.name || ""}\nSID: ${record.sid || ""}\nURL: ${record.url || ""}\n时间: ${record.time || ""}\n状态: ${record.status || ""}\n同步次数: ${record.count || ""}\n备注: ${record.message || ""}\n\n同步内容:\n${content}`;
    showAlert(detail, '同步记录详情');
}

// ========== 兼容旧接口 ==========
export function buildPreviewPayload(ws, row, colMap) {
    if (hasFunc.buildJsonPayload()) {
        return buildJsonPayload(ws, row, colMap);
    }
    return "{}";
}

export function updateDetailCount(count) {
    const countEl = document.getElementById("detailCount");
    if (countEl) countEl.textContent = count + ' 条';
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
window.detailPreviewData = detailPreviewData;   // 保持引用兼容


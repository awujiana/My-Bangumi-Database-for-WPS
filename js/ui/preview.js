// ========== UI 预览模块 ==========
// 功能：数据预览、同步记录预览、详情模态框
// 依赖：bangumi.js, syncRecord.js

// ========== 详细预览数据存储 ==========
let detailPreviewData = [];

// ========== 详细预览同步内容 ==========
/**
 * 预览同步内容
 * @description 显示将要同步的数据预览，包括每条记录的详细信息
 */
function previewSyncContent() {
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined') {
        setTimeout(previewSyncContent, 500);
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    // 优先使用锁定的工作表，否则使用选择器的值
    let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        showAlertDialog("错误", "无法获取 WPS Application 对象！");
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws = wb.Worksheets(sheetIndex);
    if (!ws) {
        showAlertDialog("错误", "无法获取工作表！");
        return;
    }

    // 获取起始和结束行
    let startRow = parseInt(startRowInput?.value) || 2;
    let userEndRow = parseInt(endRowInput?.value) || 0;

    // 查找表头
    let headerRow = findHeaderRow(ws, startRow);
    if (headerRow === 0) {
        showAlertDialog("提示", "未找到表头行！");
        return;
    }

    // 获取列映射
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showAlertDialog("提示", "未找到【条目ID】或【Bangumi URL】列！");
        return;
    }

    // 获取结束行
    let lastRow = userEndRow > 0 ? userEndRow : getLastRow(ws);
    if (lastRow <= headerRow) {
        showAlertDialog("提示", "没有可预览的数据！");
        return;
    }

    // 清空详情数据
    detailPreviewData = [];

    // 显示详情模态框
    showDetailModal();

    // 获取预览数据
    let rows = [];
    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            // 跳过空行
            let nameVal = getCellValue(ws, i, colMap.name);
            let sidVal = getCellValue(ws, i, colMap.subjectId);
            let urlVal = getCellValue(ws, i, colMap.url);

            if (!nameVal && !sidVal && !urlVal) continue;

            // 提取 SID
            let sid = sidVal;
            if (!sid && urlVal) {
                sid = extractSubjectId(urlVal);
            }

            // 获取当前状态
            let currentStatus = "";
            if (colMap.status) {
                currentStatus = getCellValue(ws, i, colMap.status) || "";
            }

            // 获取评分
            let rate = "";
            if (colMap.rate) {
                rate = getCellValue(ws, i, colMap.rate) || "";
            }

            // 获取标签
            let tags = "";
            if (colMap.tags) {
                tags = getCellValue(ws, i, colMap.tags) || "";
            }

            rows.push({
                row: i,
                name: nameVal || "(无名称)",
                sid: sid,
                url: urlVal,
                currentStatus: currentStatus,
                rate: rate,
                tags: tags,
                // 预览构建的 JSON
                previewPayload: buildPreviewPayload(ws, i, colMap)
            });

            // 保存到详情数据
            detailPreviewData.push({
                row: i,
                name: nameVal,
                sid: sid,
                payload: buildPreviewPayload(ws, i, colMap)
            });
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.WARN, "预览第 " + i + " 行出错: " + e.message);
        }
    }

    // 渲染预览列表
    renderDetailList(rows);
    updateDetailCount(rows.length);
}

/**
 * 构建预览用的 payload（不实际调用 API）
 */
function buildPreviewPayload(ws, row, colMap) {
    if (typeof buildJsonPayload === 'function') {
        return buildJsonPayload(ws, row, colMap);
    }
    return "{}";
}

/**
 * 过滤预览项目
 * @param {string} filterText - 过滤文本
 */
function filterDetailItems(filterText) {
    let items = document.querySelectorAll(".detail-item");
    filterText = filterText.toLowerCase();

    items.forEach(item => {
        let text = item.textContent.toLowerCase();
        item.style.display = text.includes(filterText) ? "block" : "none";
    });
}

/**
 * 更新详情计数
 * @param {number} count - 显示的数量
 */
function updateDetailCount(count) {
    let countEl = document.getElementById("detailCount");
    if (countEl) {
        countEl.textContent = "共 " + count + " 条";
    }
}

/**
 * 显示详情模态框
 */
function showDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "flex";
    }
}

/**
 * 关闭详情模态框
 */
function closeDetailModal() {
    let modal = document.getElementById("detailModal");
    if (modal) {
        modal.style.display = "none";
    }
}

/**
 * 渲染详情列表
 * @param {Array} items - 数据项数组
 */
function renderDetailList(items) {
    let container = document.getElementById("detailList");
    if (!container) return;

    container.innerHTML = "";

    items.forEach((item, index) => {
        let div = document.createElement("div");
        div.className = "detail-item";
        div.innerHTML = `
            <div class="detail-row">
                <span class="detail-label">行 ${item.row}</span>
                <span class="detail-name">${escapeHtml(item.name)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">SID:</span>
                <span class="detail-sid">${item.sid || "(无法提取)"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">当前状态:</span>
                <span class="detail-status">${item.currentStatus || "(无)"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">评分:</span>
                <span class="detail-rate">${item.rate || "(无)"}</span>
            </div>
            <div class="detail-preview">
                <pre>${escapeHtml(item.previewPayload)}</pre>
            </div>
        `;
        container.appendChild(div);
    });
}

/**
 * HTML 转义
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return "";
    let div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ========== 查看同步记录详情 ==========
/**
 * 查看同步记录详情
 * @param {number} rowIndex - 行索引
 */
function viewSyncRecordDetail(rowIndex) {
    if (typeof getAllSyncRecords !== 'function') {
        showAlertDialog("提示", "同步记录功能不可用");
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
        状态: ${record.status}
        备注: ${record.comment}
    `;

    showAlertDialog("同步记录详情", detail);
}
